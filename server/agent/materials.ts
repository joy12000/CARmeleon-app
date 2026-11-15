import { S3Client } from 'bun';
import { mkdir, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { ApiError, MaterialExcerpt, MaterialOriginal, OperationId, id, now, requireValue } from './models';
import { bytesHash } from './store';
import type { Config } from './config';
import type { Domain } from './domain';

export class PrivateObjects {
  readonly remote?: S3Client;
  readonly root: string;
  constructor(config: Config) { this.root = resolve(config.dataDir, 'objects'); this.remote = config.s3 ? new S3Client(config.s3) : undefined; }
  private path(key: string) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/\d+-[a-f0-9]{64}$/.test(key)) throw new ApiError(400, 'INVALID_OBJECT_KEY', '자료 경로가 올바르지 않아요.');
    const target = resolve(this.root, ...key.split('/'));
    if (!target.startsWith(this.root + sep)) throw new ApiError(400, 'INVALID_OBJECT_KEY', '자료 경로가 올바르지 않아요.');
    return target;
  }
  async put(key: string, bytes: Uint8Array, type: string) {
    if (this.remote) { await this.remote.file(key).write(bytes, { type }); return; }
    const target = this.path(key);
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
    await Bun.write(target, bytes, { mode: 0o600 });
  }
  async get(key: string) { return new Uint8Array(await (this.remote ? this.remote.file(key).arrayBuffer() : Bun.file(this.path(key)).arrayBuffer())); }
  async delete(key: string) { if (this.remote) await this.remote.file(key).delete(); else await unlink(this.path(key)).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

type Job = { id: string; accountId: string; materialId: string; version: number; status: 'PENDING'|'RUNNING'|'COMPLETED'|'FAILED'; updatedAt: string };
export class Materials {
  readonly objects: PrivateObjects;
  private active = new Set<string>();
  constructor(readonly domain: Domain, readonly config: Config) { this.objects = new PrivateObjects(config); }
  async list(accountId: string, pathId?: string) {
    if (pathId) await this.domain.path(accountId, pathId);
    return this.domain.store.read(accountId, async r => (await r.list<MaterialOriginal>('material')).filter(m => m.state !== 'DELETED' && (!pathId || m.pathId === pathId)).map(publicMaterial));
  }
  async metadata(accountId: string, materialId: string) {
    return this.domain.store.read(accountId, async r => { const m = requireValue(await r.get<MaterialOriginal>('material', materialId)); if (m.state === 'DELETED') throw new ApiError(404, 'NOT_FOUND', '자료가 삭제됐어요.'); return m; });
  }
  async upload(accountId: string, form: FormData) {
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(400, 'FILE_REQUIRED', '파일을 선택해 주세요.');
    if (file.size <= 0 || file.size > this.config.maxUploadBytes) throw new ApiError(413, 'FILE_SIZE', '자료는 비어 있지 않은 20MB 이하 파일이어야 해요.');
    const pathId = z.string().min(1).max(100).parse(form.get('pathId'));
    const stopId = z.string().max(100).optional().parse(form.get('stopId') ?? undefined);
    const replacing = z.string().max(100).optional().parse(form.get('materialId') ?? undefined);
    const baseRevision = replacing ? z.coerce.number().int().positive().parse(form.get('baseRevision')) : undefined;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = detectType(bytes, file.type);
    const materialId = replacing ?? id('material');
    const hash = bytesHash(bytes);
    // Serialize metadata/version assignment before upload. A failed object upload is reported, never READY.
    const stored = await this.domain.store.write(accountId, async r => {
      await this.domain.validateScope(r, pathId, stopId);
      const previous = replacing ? requireValue(await r.get<MaterialOriginal>('material', replacing)) : undefined;
      if (previous) {
        this.domain.checkRevision(previous.revision, baseRevision!);
        if (previous.pathId !== pathId || previous.state === 'DELETED' || previous.state === 'PROCESSING') throw new ApiError(409, 'MATERIAL_NOT_REPLACEABLE', '자료 처리가 끝난 뒤 같은 경로의 원본을 교체해 주세요.');
      }
      if (!replacing) {
        const duplicate = (await r.list<MaterialOriginal>('material')).find(m => m.pathId === pathId && m.stopId === stopId && m.sha256 === hash && m.name === file.name && !['DELETED', 'FAILED'].includes(m.state));
        if (duplicate) return { original: duplicate, reused: true };
      }
      const version = (previous?.version ?? 0) + 1;
      const original: MaterialOriginal = { id: materialId, accountId, pathId, stopId, name: file.name.replace(/[\x00-\x1f\\/]/g, '_').slice(0, 240), mimeType, size: bytes.length, sha256: hash, version, revision: (previous?.revision ?? 0) + 1, objectKey: `${accountId}/${materialId}/${version}-${hash}`, state: 'PROCESSING', createdAt: previous?.createdAt ?? now(), updatedAt: now() };
      if (previous) await r.put('material-history', `${materialId}:${previous.version}`, previous);
      await r.put('material', materialId, original);
      await r.put('material-history', `${materialId}:${version}`, original);
      await this.domain.invalidate(r, pathId, 'MATERIAL_CHANGED', undefined, { materialId });
      return { original, reused: false };
    });
    const original = stored.original;
    if (stored.reused) return publicMaterial(original);
    try { await this.objects.put(original.objectKey, bytes, mimeType); }
    catch { await this.setState(accountId, original, 'FAILED', '원본 저장에 실패했어요. 다시 업로드해 주세요.'); throw new ApiError(503, 'OBJECT_STORAGE_FAILED', '원본 저장에 실패했어요.'); }
    const job: Job = { id: id('job'), accountId, materialId, version: original.version, status: 'PENDING', updatedAt: now() };
    await this.domain.store.write(accountId, r => r.put('job', job.id, job));
    void this.extract(job).catch(() => {});
    return publicMaterial(original);
  }
  async excerpts(accountId: string, materialId: string) {
    const original = await this.metadata(accountId, materialId);
    return this.domain.store.read(accountId, async r => (await r.list<MaterialExcerpt>('excerpt')).filter(e => e.materialId === materialId && e.version === original.version).sort((a,b) => a.page - b.page));
  }
  async search(accountId: string, pathId: string, query: string, stopId?: string, limit = 6) {
    await this.domain.path(accountId, pathId);
    return this.domain.store.read(accountId, async r => {
      const materials = (await r.list<MaterialOriginal>('material')).filter(m => m.pathId === pathId && (!m.stopId || m.stopId === stopId) && ['READY', 'PARTIAL'].includes(m.state));
      const allowed = new Map(materials.map(m => [m.id, m]));
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return (await r.list<MaterialExcerpt>('excerpt')).filter(e => allowed.get(e.materialId)?.version === e.version)
        .map(e => ({ ...e, name: allowed.get(e.materialId)!.name, score: words.reduce((n,w) => n + (e.text.toLowerCase().includes(w) ? 1 : 0), 0) }))
        .filter(e => !words.length || e.score > 0).sort((a,b) => b.score - a.score).slice(0, limit)
        .map(e => ({ ...e, text: e.text.slice(0, 4000), source: { materialId: e.materialId, version: e.version, page: e.page } }));
    });
  }
  async remove(accountId: string, materialId: string, body: unknown) {
    const input = z.object({ baseRevision: z.number().int().positive(), operationId: OperationId, confirmed: z.literal(true) }).parse(body);
    const result = await this.domain.store.mutate(accountId, input.operationId, { type: 'deleteMaterial', materialId, ...input }, async r => {
      const m = requireValue(await r.get<MaterialOriginal>('material', materialId));
      this.domain.checkRevision(m.revision, input.baseRevision);
      const deleted: MaterialOriginal = { ...m, state: 'DELETED', revision: m.revision + 1, updatedAt: now() };
      const versions = (await r.list<MaterialOriginal>('material-history')).filter(v => v.id === materialId);
      for (const excerpt of await r.list<MaterialExcerpt>('excerpt')) if (excerpt.materialId === materialId) await r.remove('excerpt', excerpt.id);
      await r.put('material', materialId, deleted);
      for (const v of versions) await r.put('material-history', `${v.id}:${v.version}`, { ...v, state: 'DELETED' });
      await this.domain.detachReference(r, 'materialIds', materialId);
      await this.domain.invalidate(r, m.pathId, 'MATERIAL_DELETED', undefined, { materialId });
      return { material: deleted, keys: [...new Set([m.objectKey, ...versions.map(v => v.objectKey)])] };
    });
    // Tombstone and access revocation commit first. Failed blob deletion remains a durable cleanup job.
    for (const key of result.keys) try { await this.objects.delete(key); } catch {
      await this.domain.store.write(accountId, r => r.put('object-cleanup', key, { key, updatedAt: now(), status: 'PENDING' }));
    }
    return publicMaterial(result.material);
  }
  async extract(job: Job) {
    if (this.active.has(job.id)) return;
    this.active.add(job.id);
    try {
      const m = await this.metadata(job.accountId, job.materialId);
      if (m.version !== job.version) return;
      await this.domain.store.write(job.accountId, r => r.put('job', job.id, { ...job, status: 'RUNNING', updatedAt: now() }));
      const bytes = await this.objects.get(m.objectKey);
      let pages: string[] = [];
      let pageCount = 1;
      let partial = false;
      if (m.mimeType === 'text/plain') {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        pages = text.split('\f'); pageCount = pages.length;
      } else if (m.mimeType === 'application/pdf') {
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false, useWorkerFetch: false });
        const pdf = await task.promise;
        try {
          pageCount = pdf.numPages;
          for (let page = 1; page <= Math.min(pageCount, 100); page++) {
            const content = await (await pdf.getPage(page)).getTextContent();
            pages.push(content.items.map(item => 'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '').join(''));
          }
        } finally { await pdf.destroy(); }
      } else {
        await this.setState(job.accountId, m, 'UNSUPPORTED', '이미지 원본은 보관했어요. OCR 공급자가 아직 연결되지 않아 본문은 읽지 않았어요.');
        await this.finishJob(job, 'COMPLETED');
        return;
      }
      partial = pageCount > 100 || pages.some(p => p.length > 20000 || p.trim().length === 0);
      const excerpts = pages.slice(0, 100).map((text, i): MaterialExcerpt => ({ id: `${m.id}:${m.version}:${i+1}`, materialId: m.id, pathId: m.pathId, stopId: m.stopId, version: m.version, page: i+1, text: text.slice(0, 20000).trim() })).filter(e => e.text.length > 0);
      await this.domain.store.write(job.accountId, async r => {
        const current = requireValue(await r.get<MaterialOriginal>('material', m.id));
        if (current.version !== m.version || current.state === 'DELETED') return;
        for (const excerpt of excerpts) await r.put('excerpt', excerpt.id, excerpt);
        const state = !excerpts.length ? 'FAILED' : partial ? 'PARTIAL' : 'READY';
        const updated: MaterialOriginal = { ...current, state, pageCount, updatedAt: now(), error: state === 'FAILED' ? '추출 가능한 본문이 없어요. 스캔 문서는 OCR이 필요해요.' : partial ? '일부 페이지가 비었거나 처리 범위를 넘었어요. 읽은 페이지와 발췌만 사용할게요.' : undefined };
        await r.put('material', m.id, updated);
        await r.put('material-history', `${m.id}:${m.version}`, updated);
        await this.domain.invalidate(r, m.pathId, 'MATERIAL_CHANGED', undefined, { materialId: m.id });
      });
      await this.finishJob(job, 'COMPLETED');
    } catch {
      const material = await this.domain.store.read(job.accountId, r => r.get<MaterialOriginal>('material', job.materialId));
      if (material && material.version === job.version && material.state !== 'DELETED') await this.setState(job.accountId, material, 'FAILED', '본문 추출에 실패했어요. 원본은 별도로 보관하며, 읽지 못한 내용을 추측하지 않아요.');
      await this.finishJob(job, 'FAILED');
    } finally { this.active.delete(job.id); }
  }
  private async finishJob(job: Job, status: Job['status']) { await this.domain.store.write(job.accountId, r => r.put('job', job.id, { ...job, status, updatedAt: now() })); }
  private async setState(accountId: string, m: MaterialOriginal, state: MaterialOriginal['state'], error: string) {
    await this.domain.store.write(accountId, async r => {
      const current = await r.get<MaterialOriginal>('material', m.id);
      if (!current || current.version !== m.version || current.state === 'DELETED') return;
      await r.put('material', m.id, { ...current, state, error, updatedAt: now() });
    });
  }
  /** Resume durable extraction tasks after a server restart. Does not recreate any speech turn. */
  async recover() {
    const accounts = await this.domain.store.raw(sql => sql.unsafe('SELECT id FROM agent_accounts'));
    for (const account of accounts) {
      const jobs = await this.domain.store.read(account.id, r => r.list<Job>('job'));
      for (const job of jobs) if (['PENDING', 'RUNNING'].includes(job.status)) void this.extract(job).catch(() => {});
      const cleanup = await this.domain.store.read(account.id, r => r.list<{ key: string }>('object-cleanup'));
      for (const item of cleanup) try { await this.objects.delete(item.key); await this.domain.store.write(account.id, r => r.remove('object-cleanup', item.key)); } catch { /* keep durable pending record */ }
    }
  }
}
export const publicMaterial = ({ objectKey: _objectKey, ...m }: MaterialOriginal) => m;
function detectType(bytes: Uint8Array, claimed: string) {
  const mediaType = claimed.split(';', 1)[0].trim().toLowerCase();
  if (new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (['text/plain', 'text/markdown', 'text/csv', ''].includes(mediaType) && !bytes.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'text/plain'; } catch { /* not UTF-8 */ }
  }
  throw new ApiError(415, 'UNSUPPORTED_FILE', 'PDF, UTF-8 텍스트, PNG/JPEG/WebP 이미지만 올릴 수 있어요.');
}
