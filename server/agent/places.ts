import { z } from 'zod';
import { ApiError, Coordinate, now } from './models';
import type { Config } from './config';

export type VerifiedPlace = {
  id: string; name: string; coordinate: Coordinate; address?: string; category?: string; phone?: string;
  distanceMeters?: number; source: { provider: 'KAKAO_LOCAL'; url: string; fetchedAt: string };
};
export type PlacesResult = {
  status: 'READY'|'UNSUPPORTED'; provider: 'KAKAO_LOCAL'; query: string; center: Coordinate; radiusMeters: number;
  places: VerifiedPlace[]; fetchedAt?: string; distanceKind: 'CENTER_DISTANCE'; reason?: string;
};
export interface PlacesProvider {
  search(query: string, center: Coordinate, signal?: AbortSignal): Promise<PlacesResult>;
}
export type HttpFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
const Search = z.object({ query: z.string().trim().min(1).max(120), center: Coordinate });
const NumericCoordinate = z.string().trim().min(1).transform(Number).pipe(z.number().finite());
const Document = z.object({
  id: z.string().regex(/^\d{1,30}$/), place_name: z.string().min(1).max(300), x: NumericCoordinate, y: NumericCoordinate,
  place_url: z.string().url(), road_address_name: z.string().max(500).optional(), address_name: z.string().max(500).optional(),
  category_name: z.string().max(500).optional(), phone: z.string().max(100).optional(), distance: z.string().max(30).optional(),
});

/** Fixed official endpoint; the caller/model cannot supply a URL, API key or arbitrary search coordinates. */
export class KakaoLocalPlaces implements PlacesProvider {
  constructor(private config: Pick<Config, 'kakaoLocalRestApiKey'>, private http: HttpFetcher = fetch, private radiusMeters = 5000) {
    if (!Number.isInteger(radiusMeters) || radiusMeters < 0 || radiusMeters > 20000) throw new Error('Kakao radius must be within 0..20000 meters');
  }
  async search(query: string, center: Coordinate, signal?: AbortSignal, scope: 'nearby' | 'name' = 'nearby'): Promise<PlacesResult> {
    const input = Search.parse({ query, center });
    const base = { provider: 'KAKAO_LOCAL' as const, query: input.query, center: input.center, radiusMeters: scope === 'name' ? 0 : this.radiusMeters, distanceKind: 'CENTER_DISTANCE' as const };
    if (!this.config.kakaoLocalRestApiKey) return { ...base, status: 'UNSUPPORTED', places: [], reason: '서버의 Kakao Local REST API 키가 설정되지 않았어요. 실제 검색을 하지 않았으며 장소·좌표를 만들지 않아요.' };
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.searchParams.set('query', input.query);
    url.searchParams.set('x', String(input.center.longitude));
    url.searchParams.set('y', String(input.center.latitude));
    if (scope === 'nearby') url.searchParams.set('radius', String(this.radiusMeters));
    url.searchParams.set('sort', scope === 'name' ? 'accuracy' : 'distance');
    url.searchParams.set('size', '5');
    url.searchParams.set('page', '1');
    const timeout = AbortSignal.timeout(6000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try { response = await this.http(url, { method: 'GET', headers: { Authorization: `KakaoAK ${this.config.kakaoLocalRestApiKey}`, Accept: 'application/json' }, signal: combined, redirect: 'error' }); }
    catch {
      if (signal?.aborted) throw new ApiError(499, 'PLACES_CANCELLED', '장소 검색을 중단했어요.');
      throw new ApiError(503, timeout.aborted ? 'PLACES_TIMEOUT' : 'PLACES_UNAVAILABLE', '장소 검색 연결에 실패했어요. 확인하지 못한 후보를 대신 만들지 않아요.');
    }
    if (!response.ok) throw new ApiError(503, response.status === 429 ? 'PLACES_QUOTA_REACHED' : 'PLACES_PROVIDER_REJECTED', '장소 검색 공급자가 요청을 처리하지 못했어요. 서버 키·사용 권한·할당량을 확인해 주세요.');
    let raw: unknown;
    try {
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error('oversized response');
      raw = JSON.parse(text);
    } catch { throw new ApiError(502, 'PLACES_INVALID_RESPONSE', '장소 검색 결과 형식을 확인하지 못했어요.'); }
    const result = z.object({ documents: z.array(z.unknown()).max(15) }).safeParse(raw);
    if (!result.success) throw new ApiError(502, 'PLACES_INVALID_RESPONSE', '장소 검색 결과 형식을 확인하지 못했어요.');
    const fetchedAt = now();
    const seen = new Set<string>();
    const places: VerifiedPlace[] = [];
    for (const document of result.data.documents) {
      const parsed = Document.safeParse(document);
      if (!parsed.success) continue;
      const d = parsed.data;
      const coordinate = Coordinate.safeParse({ latitude: d.y, longitude: d.x });
      const source = new URL(d.place_url);
      if (!coordinate.success || !['http:', 'https:'].includes(source.protocol) || source.hostname !== 'place.map.kakao.com' || source.port || source.pathname !== `/${d.id}` || source.username || source.password || seen.has(d.id)) continue;
      const distanceMeters = d.distance?.trim() ? Number(d.distance) : undefined;
      if (distanceMeters !== undefined && (!Number.isFinite(distanceMeters) || distanceMeters < 0)) continue;
      seen.add(d.id);
      // Official examples use http links; HTTPS retains the same Kakao place resource.
      source.protocol = 'https:';
      places.push({ id: `kakao:${d.id}`, name: d.place_name, coordinate: coordinate.data, address: d.road_address_name || d.address_name || undefined, category: d.category_name || undefined, phone: d.phone || undefined, distanceMeters, source: { provider: 'KAKAO_LOCAL', url: source.toString(), fetchedAt } });
    }
    if (result.data.documents.length && !places.length) throw new ApiError(502, 'PLACES_INVALID_RESPONSE', '확인 가능한 좌표와 출처가 있는 장소 결과가 없어요.');
    return { ...base, fetchedAt, status: 'READY', places };
  }
}
