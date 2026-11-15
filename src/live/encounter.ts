import { meters, positionOnRoad, type Position } from './journey';
import type { RoadRoute } from '../components/phone/roadDirections';

export type Encounter = { kind: 'roadside' | 'destination'; name: string; coordinate: Position };
export type EncounterEvidence = {
  kind: Encounter['kind']; name: string; position: Position; coordinate: Position;
  distanceMeters: number; alongMeters: number; headingDegrees: number;
  side: 'left' | 'right' | 'ahead'; progress: number; passageProgress: number;
  visibility: 'NOT_OBSERVED';
};
export type EncounterInput = { progress: number; road?: RoadRoute | null; position?: Position | null };
export type EncounterCheck = { status: 'unverified' | 'far' | 'approaching' | 'passed'; evidence?: EncounterEvidence };
const angle = (degrees: number) => ((degrees + 540) % 360) - 180;
function bearing(a: Position, b: Position) {
  return (Math.atan2((b.longitude - a.longitude) * Math.cos(a.latitude * Math.PI / 180), b.latitude - a.latitude) * 180 / Math.PI + 360) % 360;
}
export function encounterRange(encounter: Encounter) { return encounter.kind === 'roadside' ? 250 : 200; }

/** Coordinates and the matched road establish proximity/direction, never an unobstructed view. */
export function checkEncounter(cue: { anchor: number; encounter?: Encounter }, input: EncounterInput): EncounterCheck {
  const { road, position, progress } = input, place = cue.encounter;
  if (!place || !road || !position || !Number.isFinite(progress)) return { status: 'unverified' };
  const expected = positionOnRoad(road, progress);
  if (!expected || meters(expected, position) > 50) return { status: 'unverified' };
  const segments = road.lines.flatMap(line => line.slice(1).map((b, i) => ({ a: line[i], b, length: meters(line[i], b) }))).filter(s => s.length > .1);
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (length < 1) return { status: 'unverified' };
  let remaining = progress * length, current = segments[segments.length - 1];
  for (const segment of segments) { if (remaining <= segment.length) { current = segment; break; } remaining -= segment.length; }
  const alongMeters = (cue.anchor - progress) * length;
  if (alongMeters <= 0) return { status: 'passed' };
  const distance = meters(position, place.coordinate), heading = bearing(current.a, current.b);
  const relative = angle(bearing(position, place.coordinate) - heading);
  const lateral = Math.abs(Math.sin(relative * Math.PI / 180) * distance);
  // Turns can put an upcoming place behind the present heading. Wait rather than invent a side.
  const evidence: EncounterEvidence = { kind: place.kind, name: place.name, position: { ...position }, coordinate: place.coordinate,
    distanceMeters: Math.round(distance), alongMeters: Math.round(alongMeters), headingDegrees: Math.round(heading),
    side: lateral < 20 || Math.abs(relative) < 25 ? 'ahead' : relative > 0 ? 'right' : 'left', progress, passageProgress: cue.anchor, visibility: 'NOT_OBSERVED' };
  const limit = encounterRange(place);
  return { status: distance <= limit && alongMeters <= limit && Math.abs(relative) <= 105 ? 'approaching' : 'far', evidence };
}
export function encounterIntroduction(evidence: EncounterEvidence) {
  if (evidence.kind === 'destination') return '곧 도착할 ' + evidence.name + ' 이야기예요. ';
  const direction = evidence.side === 'right' ? '오른편 가까이에 ' : evidence.side === 'left' ? '왼편 가까이에 ' : '조금 앞에 ';
  const last = evidence.name.charCodeAt(evidence.name.length - 1);
  const particle = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '이' : '가';
  return direction + evidence.name + particle + ' 있어요. ';
}
