import { z } from 'zod';

export const Coordinate = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
export const SourceRef = z.object({
  materialId: z.string().max(100).optional(), version: z.number().int().positive().optional(), page: z.number().int().positive().optional(),
  url: z.string().url().max(2000).optional(), text: z.string().max(4000).optional(), memoryId: z.string().optional(),
});
export const PathStop = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(180), coordinate: Coordinate,
  purpose: z.string().max(1000).optional(), appointmentAt: z.string().datetime({ offset: true }).optional(),
  address: z.string().max(500).optional(), memo: z.string().max(8000).optional(), poiId: z.string().max(100).optional(),
  timeZone: z.string().max(100).optional(), dwellMinutes: z.number().int().min(0).max(1440).optional(),
  materialIds: z.array(z.string()).max(100).default([]), memoryIds: z.array(z.string()).max(100).default([]),
}).superRefine((s, c) => {
  if (s.appointmentAt && !s.timeZone) c.addIssue({ code: 'custom', path: ['timeZone'], message: 'Appointment requires timeZone' });
  if (s.timeZone) try { new Intl.DateTimeFormat('en', { timeZone: s.timeZone }).format(); } catch { c.addIssue({ code: 'custom', path: ['timeZone'], message: 'Invalid IANA time zone' }); }
});
export const PathInput = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(), title: z.string().min(1).max(200),
  mode: z.enum(['TRAVEL', 'BUSINESS', 'DAILY']), stops: z.array(PathStop).min(1).max(100),
}).superRefine((p, c) => {
  if (new Set(p.stops.map(s => s.id)).size !== p.stops.length) c.addIssue({ code: 'custom', message: 'Stop IDs must be unique' });
});
export const Stops = z.array(PathStop).min(1).max(100).refine(s => new Set(s.map(x => x.id)).size === s.length, 'Stop IDs must be unique');
export const OperationId = z.string().min(8).max(160);
export const ProposalInput = z.object({ baseRevision: z.number().int().positive(), stops: Stops, reason: z.string().min(1).max(1200), guidanceFingerprint: z.string().max(300).optional(), operationId: OperationId });
export const MemoryInput = z.object({ text: z.string().min(1).max(8000), pathId: z.string().optional(), stopId: z.string().optional(), kind: z.enum(['USER_FACT', 'AI_INFERENCE']).default('USER_FACT'), sources: z.array(SourceRef).max(30).default([]), operationId: OperationId });
export const GuidanceInput = z.object({ routeId: z.string().max(300).optional(), fingerprint: z.string().min(1).max(300), status: z.enum(['UNKNOWN', 'ROUTING', 'GUIDING', 'SIMULATION', 'IDLE']), refreshing: z.boolean().optional(), observedAt: z.string().datetime({ offset: true }), stops: z.array(PathStop).max(3).optional(), source: z.enum(['PLEOS', 'PREVIEW', 'EXTERNAL_ESTIMATE']) }).superRefine((s, c) => {
  if (s.status === 'GUIDING' && s.source !== 'PLEOS') c.addIssue({ code: 'custom', path: ['source'], message: 'GUIDING requires observed Pleos source' });
});
export const TurnInput = z.object({ turnId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), pathId: z.string().min(1).max(100), text: z.string().min(1).max(12000), deviceId: z.string().optional(), location: Coordinate.optional(), guidanceFingerprint: z.string().max(300).optional(), resumeDecisionId: z.string().optional(), referencedPointId: z.string().max(100).optional() });

export type Coordinate = z.infer<typeof Coordinate>;
export type SourceRef = z.infer<typeof SourceRef>;
export type PathStop = z.infer<typeof PathStop>;
export type PathDocument = { id: string; accountId: string; revision: number; title: string; mode: 'TRAVEL'|'BUSINESS'|'DAILY'; stops: PathStop[]; updatedAt: string };
export type GuidanceSnapshot = z.infer<typeof GuidanceInput> & { pathId: string; receivedAt: string; confirmedFingerprint?: string };
export type PathChangeSet = { id: string; accountId: string; pathId: string; baseRevision: number; stops: PathStop[]; reason: string; guidanceFingerprint?: string; status: 'PENDING'|'ACCEPTED'|'REJECTED'|'STALE'|'EXPIRED'; expiresAt: string; createdAt: string; decisionSource?: 'BUTTON'|'VOICE'|'MANUAL'; actionId?: string; turnId?: string; approvalReady?: boolean };
export type ActionRecord = { id: string; pathId: string; proposalId: string; status: 'REQUESTED'|'DISPATCHED'|'GUIDING'|'SIMULATION'|'FAILED'|'UNKNOWN'; desiredPathRevision: number; createdAt: string; updatedAt: string; guidance?: GuidanceSnapshot; error?: string };
export type MemoryNote = { id: string; accountId: string; pathId?: string; stopId?: string; text: string; kind: 'USER_FACT'|'AI_INFERENCE'; sources: SourceRef[]; revision: number; deleted: boolean; updatedAt: string; author: 'USER'|'AGENT' };
export type MaterialOriginal = { id: string; accountId: string; pathId: string; stopId?: string; name: string; mimeType: string; size: number; sha256: string; version: number; revision: number; objectKey: string; state: 'PROCESSING'|'READY'|'PARTIAL'|'FAILED'|'UNSUPPORTED'|'DELETED'; error?: string; pageCount?: number; createdAt: string; updatedAt: string };
export type MaterialExcerpt = { id: string; materialId: string; pathId: string; stopId?: string; version: number; page: number; text: string };
export type TurnRecord = z.infer<typeof TurnInput> & { accountId: string; status: 'RUNNING'|'COMPLETED'|'WAITING_APPROVAL'|'CANCELLED'|'FAILED'|'INTERRUPTED'; startedAt: string; updatedAt: string; generatedText?: string; sdkState?: string; decisionId?: string; usage?: unknown; error?: string };
export type PreparedUtterance = { id: string; pathId: string; pathRevision: number; planId: string; pointId: string; text: string; sources: SourceRef[]; coordinate: Coordinate; headingDegrees?: number; routeId: string; guidanceFingerprint: string; expiresAt: string; status: 'PREPARED'|'SPEAKING'|'COMPLETED'|'INTERRUPTED'|'SKIPPED'|'INVALIDATED'; reason?: string; createdAt: string };
export type NarrativePlan = { id: string; pathId: string; pathRevision: number; segmentId: string; routeId: string; guidanceFingerprint: string; pointIds: string[]; cacheKey: string; coverage: 'LIMITED'; status: 'READY'|'INVALIDATED'; createdAt: string; expiresAt: string; sourceVersions: string[]; memoryVersions?: string[]; usage?: unknown };
export type Account = { id: string; email: string };
export type AuthContext = { account: Account; deviceId: string; tokenHash: string };
export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const requireValue = <T>(value: T | undefined | null, message = '항목을 찾을 수 없어요.'): T => {
  if (value == null) throw new ApiError(404, 'NOT_FOUND', message);
  return value;
};
