import { z } from 'zod';
export const AgentTopic = z.enum(['sightseeing', 'meal', 'coffee', 'charging', 'briefing', 'visit_check']);
const Coordinate = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) });
export const AgentInput = z.object({
  event: z.enum(['departure', 'context_changed', 'answer', 'arrival']),
  routeId: z.string().max(100), revision: z.number().int().positive(), targetId: z.string().max(100),
  situation: z.enum(['travel', 'work', 'daily']), goal: z.string().max(300),
  routeTitle: z.string().max(300), position: Coordinate, ahead: Coordinate,
  target: z.object({ id: z.string().max(100), name: z.string().max(300), coordinate: Coordinate, memo: z.string().max(1500).optional(), time: z.string().max(100).optional() }),
  upcoming: z.array(z.object({ id: z.string().max(100), name: z.string().max(300), time: z.string().max(100).optional() })).max(8),
  notes: z.array(z.object({ id: z.string().max(100), text: z.string().max(500) })).max(12),
  materials: z.array(z.object({ id: z.string().max(100), name: z.string().max(250), text: z.string().max(8000) })).max(3),
  conversation: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1000) })).max(8),
  world: z.object({ time: z.string().max(50), elapsedSeconds: z.number().nonnegative(), remainingSeconds: z.number().nonnegative().nullable(), progress: z.number().min(0).max(1) }).optional(),
  handledTopics: z.array(AgentTopic).max(30),
  activeTask: z.object({ id: z.string().max(100), goal: z.string().max(240), question: z.string().max(300), topic: AgentTopic }).optional(),
}).strict();
export const AgentPlan = z.object({
  outcome: z.enum(['wait', 'suggest_stop', 'ask', 'brief', 'complete']),
  topic: AgentTopic, goal: z.string().max(240), reason: z.string().max(400),
  speech: z.string().max(300), placeId: z.string().max(100).optional(),
  sourceIds: z.array(z.string().max(100)).max(6),
}).strict();
export type AgentObservation = z.infer<typeof AgentInput>;
export type AgentDecision = z.infer<typeof AgentPlan>;
export type AgentPlace = { id: string; name: string; coordinate: z.infer<typeof Coordinate>; address?: string; source: { url: string } };
export type AgentComparison = { placeId: string; extraSeconds: number; distanceMeters: number };
export type AgentResult = { plan: AgentDecision; places: AgentPlace[]; comparisons: AgentComparison[]; sources: { id: string; title: string; url?: string }[]; trace: { tools: string[]; rounds: number } };
