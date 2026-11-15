import { z } from 'zod';
import { ActionRecord, ApiError, GuidanceInput, GuidanceSnapshot, MemoryInput, MemoryNote, NarrativePlan, OperationId, PathChangeSet, PathDocument, PathInput, PreparedUtterance, ProposalInput, id, now, requireValue } from './models';
import { Records, Store } from './store';

export class Domain {
  constructor(readonly store: Store) {}
  async paths(accountId: string) {
    return this.store.write(accountId, async r => {
      let list = await r.list<PathDocument>('path');
      if (process.env.NODE_ENV !== 'test' && !list.some(p => p.title.includes('카멜레온 미팅'))) {
        const meetingPath: PathDocument = {
          id: id('path'),
          accountId,
          revision: 1,
          title: '카멜레온 미팅',
          mode: 'BUSINESS',
          stops: [
            { id: 'stop-yangjae', name: '현대자동차 양재 본사', coordinate: { latitude: 37.4697, longitude: 127.0402 }, address: '서울특별시 서초구 헌릉로 12', purpose: '서비스 제휴 미팅 (8,900원 구독 및 7:3 배분)', dwellMinutes: 60, materialIds: [], memoryIds: [] },
            { id: 'stop-namyang', name: '현대자동차 남양기술연구소', coordinate: { latitude: 37.1995, longitude: 126.8315 }, address: '경기도 화성시 남양읍 현대연구소로 150', purpose: 'Pleos R&D 음성인식 기술검증 (94.2% 시험)', dwellMinutes: 90, materialIds: [], memoryIds: [] },
            { id: 'stop-home', name: '집', coordinate: { latitude: 37.4981, longitude: 126.8569 }, address: '서울특별시 구로구 중앙로12길 12', purpose: '퇴근 및 충전/세탁물 수령', dwellMinutes: 0, materialIds: [], memoryIds: [] }
          ],
          updatedAt: now()
        };
        await r.put('path', meetingPath.id, meetingPath);
        await r.put('path-history', `${meetingPath.id}:1`, meetingPath);
        list = [meetingPath, ...list];
      }
      return list;
    });
  }
  async path(accountId: string, pathId: string) { return this.store.read(accountId, async r => requireValue(await r.get<PathDocument>('path', pathId))); }
  async createPath(accountId: string, body: unknown) {
    const input = PathInput.parse(body);
    return this.store.write(accountId, async r => {
      const pathId = input.id ?? id('path');
      if (await r.get('path', pathId)) throw new ApiError(409, 'PATH_EXISTS', '이미 저장된 경로예요.');
      await this.validateReferences(r, input.stops);
      const path: PathDocument = { ...input, id: pathId, accountId, revision: 1, updatedAt: now() };
      await r.put('path', pathId, path);
      await r.put('path-history', `${pathId}:1`, path);
      return path;
    });
  }
  async savePath(accountId: string, pathId: string, body: unknown) {
    const fields = z.object({ baseRevision: z.number().int().positive(), operationId: OperationId }).parse(body);
    const input = PathInput.parse(body);
    return this.store.mutate(accountId, fields.operationId, { type: 'savePath', pathId, ...input, baseRevision: fields.baseRevision }, async r => {
      const old = requireValue(await r.get<PathDocument>('path', pathId));
      this.checkRevision(old.revision, fields.baseRevision);
      await this.validateReferences(r, input.stops);
      const path = { ...old, ...input, id: pathId, revision: old.revision + 1, updatedAt: now() };
      await r.put('path', pathId, path);
      await r.put('path-history', `${pathId}:${path.revision}`, path);
      await this.invalidate(r, pathId, 'PATH_CHANGED', undefined, { previousPath: old, newPath: path });
      return path;
    });
  }
  async propose(accountId: string, pathId: string, body: unknown, turnId?: string) {
    const input = ProposalInput.parse(body);
    return this.store.mutate(accountId, input.operationId, { type: 'propose', pathId, ...input }, async r => {
      const path = requireValue(await r.get<PathDocument>('path', pathId));
      this.checkRevision(path.revision, input.baseRevision);
      await this.validateReferences(r, input.stops);
      const guidance = await r.get<GuidanceSnapshot>('guidance', pathId);
      if (input.guidanceFingerprint && input.guidanceFingerprint !== guidance?.fingerprint) throw new ApiError(409, 'GUIDANCE_CHANGED', '실제 안내 상태가 달라졌어요. 최신 경로로 다시 제안할게요.');
      const proposal: PathChangeSet = { id: id('proposal'), accountId, pathId, ...input, status: 'PENDING', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), createdAt: now(), approvalReady: !turnId, ...(turnId ? { turnId } : {}) };
      await r.put('proposal', proposal.id, proposal);
      return proposal;
    });
  }
  async proposals(accountId: string, pathId: string) {
    await this.path(accountId, pathId);
    return this.store.read(accountId, async r => (await r.list<PathChangeSet>('proposal')).filter(p => p.pathId === pathId));
  }
  async decide(accountId: string, proposalId: string, body: unknown) {
    const input = z.object({ accepted: z.boolean(), baseRevision: z.number().int().positive(), operationId: OperationId, guidanceFingerprint: z.string().optional(), source: z.enum(['BUTTON', 'VOICE', 'MANUAL']) }).parse(body);
    return this.store.mutate(accountId, input.operationId, { type: 'decide', proposalId, ...input }, async r => {
      const proposal = requireValue(await r.get<PathChangeSet>('proposal', proposalId));
      const path = requireValue(await r.get<PathDocument>('path', proposal.pathId));
      // An already accepted decision is never re-dispatched, even with another operation ID.
      if (proposal.status !== 'PENDING') throw new ApiError(409, 'DECISION_SETTLED', '이미 처리되었거나 더 이상 유효하지 않은 제안이에요.');
      if (proposal.turnId && proposal.approvalReady !== true) throw new ApiError(409, 'DECISION_NOT_READY', '변경안을 준비 중이에요. 준비가 끝난 뒤 승인해 주세요.');
      this.checkRevision(proposal.baseRevision, input.baseRevision);
      this.checkRevision(path.revision, input.baseRevision);
      if (proposal.expiresAt < now()) throw new ApiError(409, 'DECISION_EXPIRED', '제안 시간이 지나서 다시 확인해야 해요.');
      if (!input.accepted) {
        const rejected: PathChangeSet = { ...proposal, status: 'REJECTED', decisionSource: input.source };
        await r.put('proposal', proposalId, rejected);
        return { proposal: rejected };
      }
      const actual = await r.get<GuidanceSnapshot>('guidance', proposal.pathId);
      if (actual?.refreshing || actual?.status === 'UNKNOWN' && actual.confirmedFingerprint) throw new ApiError(409, 'GUIDANCE_UNCONFIRMED', '현재 안내 상태를 확인 중이에요. 확인이 끝난 뒤 적용해 주세요.');
      if (proposal.guidanceFingerprint && (actual?.fingerprint !== proposal.guidanceFingerprint || input.guidanceFingerprint !== proposal.guidanceFingerprint)) throw new ApiError(409, 'GUIDANCE_CHANGED', '실제 안내가 변경되어 이 제안을 적용할 수 없어요.');
      if (actual && ['GUIDING', 'SIMULATION'].includes(actual.status) && (!proposal.guidanceFingerprint || Date.now() - Date.parse(actual.observedAt) > 15_000)) throw new ApiError(409, 'GUIDANCE_UNCONFIRMED', '최근 실제 안내 상태를 다시 확인해 주세요.');
      const updated: PathDocument = { ...path, stops: proposal.stops, revision: path.revision + 1, updatedAt: now() };
      const action: ActionRecord = { id: id('action'), pathId: path.id, proposalId: proposal.id, status: 'REQUESTED', desiredPathRevision: updated.revision, createdAt: now(), updatedAt: now() };
      const accepted: PathChangeSet = { ...proposal, status: 'ACCEPTED', decisionSource: input.source, actionId: action.id };
      await r.put('path', path.id, updated);
      await r.put('path-history', `${path.id}:${updated.revision}`, updated);
      await this.invalidate(r, path.id, 'PATH_CHANGED', proposal.id, { previousPath: path, newPath: updated });
      await r.put('proposal', proposal.id, accepted);
      await r.put('action', action.id, action);
      return { proposal: accepted, path: updated, action };
    });
  }
  async guidance(accountId: string, pathId: string, body?: unknown) {
    if (body === undefined) return this.store.read(accountId, async r => { requireValue(await r.get('path', pathId)); return await r.get<GuidanceSnapshot>('guidance', pathId) ?? null; });
    const input = GuidanceInput.parse(body);
    if (Date.parse(input.observedAt) > Date.now() + 5000) throw new ApiError(400, 'FUTURE_OBSERVATION', '안내 관찰 시각을 확인해 주세요.');
    return this.store.write(accountId, async r => {
      requireValue(await r.get('path', pathId));
      const previous = await r.get<GuidanceSnapshot>('guidance', pathId);
      if (previous && previous.observedAt > input.observedAt) return previous;
      const confirmed = !input.refreshing && ['GUIDING', 'SIMULATION', 'IDLE'].includes(input.status);
      const lastConfirmed = previous?.confirmedFingerprint ?? (previous && !previous.refreshing && ['GUIDING', 'SIMULATION', 'IDLE'].includes(previous.status) ? previous.fingerprint : undefined);
      const snapshot: GuidanceSnapshot = { ...input, pathId, receivedAt: now(), confirmedFingerprint: confirmed ? input.fingerprint : lastConfirmed };
      await r.put('guidance', pathId, snapshot);
      if (confirmed && lastConfirmed && lastConfirmed !== input.fingerprint) await this.invalidate(r, pathId, 'GUIDANCE_CHANGED');
      return snapshot;
    });
  }
  async actions(accountId: string, pathId?: string) { return this.store.read(accountId, async r => (await r.list<ActionRecord>('action')).filter(a => !pathId || a.pathId === pathId)); }
  async reportAction(accountId: string, actionId: string, body: unknown) {
    const input = z.object({ status: z.enum(['DISPATCHED', 'GUIDING', 'SIMULATION', 'FAILED', 'UNKNOWN']), guidance: GuidanceInput.optional(), error: z.string().max(2000).optional() }).parse(body);
    return this.store.write(accountId, async r => {
      const action = requireValue(await r.get<ActionRecord>('action', actionId));
      if (['GUIDING', 'SIMULATION', 'FAILED'].includes(action.status)) {
        if (action.status === input.status) return action;
        throw new ApiError(409, 'ACTION_TERMINAL', '완료된 작업의 상태를 바꿀 수 없어요.');
      }
      if (['GUIDING', 'SIMULATION'].includes(input.status) && input.guidance?.refreshing) throw new ApiError(409, 'GUIDANCE_UNCONFIRMED', '안내 조회가 끝나기 전에는 반영 완료를 기록할 수 없어요.');
      if (input.status === 'GUIDING' && (!input.guidance || input.guidance.status !== 'GUIDING' || input.guidance.source !== 'PLEOS')) throw new ApiError(400, 'GUIDANCE_REQUIRED', '실제 Pleos 안내가 관찰된 결과가 필요해요. 시뮬레이션은 따로 보고해 주세요.');
      if (input.status === 'SIMULATION' && input.guidance?.status !== 'SIMULATION') throw new ApiError(400, 'SIMULATION_REQUIRED', '시뮬레이션 관찰 결과가 필요해요.');
      if (input.guidance && (Date.parse(input.guidance.observedAt) > Date.now() + 5000 || Date.now() - Date.parse(input.guidance.observedAt) > 15_000)) throw new ApiError(409, 'GUIDANCE_STALE', '최근에 관찰된 안내 결과가 필요해요.');
      const updated: ActionRecord = { ...action, ...input, guidance: input.guidance ? { ...input.guidance, pathId: action.pathId, receivedAt: now() } : action.guidance, updatedAt: now() };
      await r.put('action', actionId, updated);
      return updated;
    });
  }
  async memories(accountId: string, pathId?: string, stopId?: string, query = '') {
    return this.store.read(accountId, async r => {
      if (pathId) requireValue(await r.get('path', pathId));
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return (await r.list<MemoryNote>('memory')).filter(n => !n.deleted && (!n.pathId || n.pathId === pathId) && (!n.stopId || n.stopId === stopId) && words.every(w => n.text.toLowerCase().includes(w))).slice(0, 50);
    });
  }
  async createMemory(accountId: string, body: unknown, author: 'USER'|'AGENT' = 'USER') {
    const input = MemoryInput.parse(body);
    return this.store.mutate(accountId, input.operationId, { type: 'createMemory', ...input }, async r => {
      await this.validateScope(r, input.pathId, input.stopId);
      await this.validateSources(r, input.sources, input.pathId);
      const note: MemoryNote = { id: id('memory'), accountId, text: input.text, pathId: input.pathId, stopId: input.stopId, kind: input.kind, sources: input.sources, revision: 1, deleted: false, author, updatedAt: now() };
      await r.put('memory', note.id, note);
      await r.put('memory-history', `${note.id}:1`, note);
      await this.invalidate(r, note.pathId, 'MEMORY_CHANGED', undefined, { memoryId: note.id, newMemory: true });
      return note;
    });
  }
  async editMemory(accountId: string, memoryId: string, body: unknown, deleted = false, author: 'USER'|'AGENT' = 'USER') {
    const input = z.object({ text: z.string().min(1).max(8000).optional(), baseRevision: z.number().int().positive(), operationId: OperationId }).parse(body);
    return this.store.mutate(accountId, input.operationId, { type: deleted ? 'deleteMemory' : 'editMemory', memoryId, ...input }, async r => {
      const old = requireValue(await r.get<MemoryNote>('memory', memoryId));
      this.checkRevision(old.revision, input.baseRevision);
      if (old.deleted && !deleted) throw new ApiError(409, 'MEMORY_DELETED', '삭제된 메모는 복원 메뉴에서 되돌려 주세요.');
      if (!deleted && !input.text) throw new ApiError(400, 'TEXT_REQUIRED', '수정할 내용을 입력해 주세요.');
      const note = { ...old, text: input.text ?? old.text, deleted, revision: old.revision + 1, author, updatedAt: now() };
      await r.put('memory', memoryId, note);
      await r.put('memory-history', `${memoryId}:${note.revision}`, note);
      if (deleted) await this.detachReference(r, 'memoryIds', memoryId);
      await this.invalidate(r, old.pathId, 'MEMORY_CHANGED', undefined, { memoryId });
      return note;
    });
  }
  async memoryHistory(accountId: string, memoryId: string) {
    return this.store.read(accountId, async r => { requireValue(await r.get('memory', memoryId)); return (await r.list<MemoryNote>('memory-history')).filter(n => n.id === memoryId).sort((a,b) => b.revision - a.revision); });
  }
  async restoreMemory(accountId: string, memoryId: string, body: unknown) {
    const input = z.object({ revision: z.number().int().positive(), baseRevision: z.number().int().positive(), operationId: OperationId }).parse(body);
    return this.store.mutate(accountId, input.operationId, { type: 'restoreMemory', memoryId, ...input }, async r => {
      const old = requireValue(await r.get<MemoryNote>('memory', memoryId));
      const version = requireValue(await r.get<MemoryNote>('memory-history', `${memoryId}:${input.revision}`));
      this.checkRevision(old.revision, input.baseRevision);
      const note: MemoryNote = { ...version, revision: old.revision + 1, deleted: false, author: 'USER', updatedAt: now() };
      await this.validateSources(r, note.sources, note.pathId);
      await r.put('memory', memoryId, note);
      await r.put('memory-history', `${memoryId}:${note.revision}`, note);
      await this.invalidate(r, old.pathId, 'MEMORY_CHANGED', undefined, { memoryId, newMemory: true });
      return note;
    });
  }
  checkRevision(actual: number, expected: number) { if (actual !== expected) throw new ApiError(409, 'REVISION_CONFLICT', '다른 곳에서 수정됐어요. 최신 내용을 다시 불러와 주세요.'); }
  async validateScope(r: Records, pathId?: string, stopId?: string) {
    if (stopId && !pathId) throw new ApiError(400, 'PATH_REQUIRED', '방문 메모에는 경로가 필요해요.');
    if (pathId) { const path = requireValue(await r.get<PathDocument>('path', pathId)); if (stopId && !path.stops.some(s => s.id === stopId)) throw new ApiError(404, 'STOP_NOT_FOUND', '경로 안의 방문 장소를 찾을 수 없어요.'); }
  }
  async detachReference(r: Records, field: 'materialIds' | 'memoryIds', removedId: string) {
    for (const previous of await r.list<PathDocument>('path')) {
      if (!previous.stops.some(stop => stop[field].includes(removedId))) continue;
      const path = { ...previous, revision: previous.revision + 1, updatedAt: now(),
        stops: previous.stops.map(stop => ({ ...stop, [field]: stop[field].filter(id => id !== removedId) })) };
      await r.put('path', path.id, path);
      await r.put('path-history', `${path.id}:${path.revision}`, path);
      await this.invalidate(r, path.id, 'PATH_CHANGED', undefined, { previousPath: previous, newPath: path });
    }
  }
  async validateReferences(r: Records, stops: PathDocument['stops']) {
    for (const stop of stops) {
      for (const materialId of stop.materialIds ?? []) { const m = requireValue(await r.get<{ state: string }>('material', materialId)); if (m.state === 'DELETED') throw new ApiError(409, 'MATERIAL_DELETED', '삭제된 자료를 경로에 붙일 수 없어요.'); }
      for (const memoryId of stop.memoryIds ?? []) { const n = requireValue(await r.get<MemoryNote>('memory', memoryId)); if (n.deleted) throw new ApiError(409, 'MEMORY_DELETED', '삭제된 기억을 경로에 붙일 수 없어요.'); }
    }
  }
  async validateSources(r: Records, sources: z.infer<typeof MemoryInput>['sources'], pathId?: string) {
    for (const source of sources) {
      if (source.materialId) {
        const material = requireValue(await r.get<{ state: string; version: number; pathId: string }>('material', source.materialId));
        if (material.state === 'DELETED' || material.version !== source.version || (pathId && material.pathId !== pathId)) throw new ApiError(409, 'SOURCE_CHANGED', '자료 버전과 참조 범위를 다시 확인해 주세요.');
        if (source.page && !await r.get('excerpt', `${source.materialId}:${source.version}:${source.page}`)) throw new ApiError(404, 'EXCERPT_NOT_FOUND', '읽을 수 있는 페이지 근거가 없어요.');
      }
      if (source.memoryId) { const note = requireValue(await r.get<MemoryNote>('memory', source.memoryId)); if (note.deleted) throw new ApiError(409, 'SOURCE_CHANGED', '삭제된 메모는 근거로 사용할 수 없어요.'); }
    }
  }
  async invalidate(r: Records, pathId: string | undefined, reason: string, exceptProposal?: string, change?: { previousPath?: PathDocument; newPath?: PathDocument; memoryId?: string; materialId?: string; newMemory?: boolean }) {
    for (const proposal of await r.list<PathChangeSet>('proposal')) if ((!pathId || proposal.pathId === pathId) && proposal.id !== exceptProposal && proposal.status === 'PENDING') await r.put('proposal', proposal.id, { ...proposal, status: 'STALE' });
    const invalidated = new Set<string>();
    const rebased = new Set<string>();
    for (const plan of await r.list<NarrativePlan>('narrative')) {
      if (pathId && plan.pathId !== pathId) continue;
      if (change?.materialId && !plan.sourceVersions.some(v => v.startsWith(`${change.materialId}:`))) continue;
      if (change?.memoryId && !change.newMemory && !plan.memoryVersions?.some(v => v.startsWith(`${change.memoryId}:`))) continue;
      const before = change?.previousPath, after = change?.newPath;
      if (before && after && plan.status === 'READY' && before.mode === after.mode) {
        const oldIndex = before.stops.findIndex((stop, i) => before.stops[i+1] && `${stop.id}:${before.stops[i+1].id}` === plan.segmentId);
        const from = before.stops[oldIndex], to = before.stops[oldIndex+1];
        const newIndex = from ? after.stops.findIndex(s => s.id === from.id) : -1;
        // Rebase only an explicitly identified, unchanged adjacent segment. Unknown geometry is never guessed.
        if (oldIndex >= 0 && newIndex >= 0 && JSON.stringify(after.stops[newIndex]) === JSON.stringify(from) && JSON.stringify(after.stops[newIndex+1]) === JSON.stringify(to)) {
          await r.put('narrative', plan.id, { ...plan, pathRevision: after.revision });
          rebased.add(plan.id);
          continue;
        }
      }
      await r.put('narrative', plan.id, { ...plan, status: 'INVALIDATED' });
      invalidated.add(plan.id);
    }
    for (const utterance of await r.list<PreparedUtterance>('utterance')) {
      if (invalidated.has(utterance.planId) && ['PREPARED', 'SPEAKING'].includes(utterance.status)) await r.put('utterance', utterance.id, { ...utterance, status: 'INVALIDATED', reason });
      else if (rebased.has(utterance.planId) && change?.newPath) await r.put('utterance', utterance.id, { ...utterance, pathRevision: change.newPath.revision });
    }
    if (['MEMORY_CHANGED', 'MATERIAL_CHANGED', 'MATERIAL_DELETED'].includes(reason)) {
      // Old conversation text/tool outputs can contain deleted or superseded material. Drop replay history in affected scopes.
      const sessions = await r.sql.unsafe('SELECT id FROM agent_records WHERE account_id=$1 AND kind=$2', [r.accountId, 'sdk-session']);
      for (const row of sessions) { const data = await r.get<{ pathId: string }>('sdk-session', row.id); if (!pathId || data?.pathId === pathId) await r.put('sdk-session', row.id, { ...data, batches: [] }); }
    }
  }
}
