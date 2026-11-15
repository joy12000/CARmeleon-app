import type { MapPoint } from "./mapProviders";
export type RoadRoute = {
  provider: "KAKAO_DIRECTIONS";
  kind: "DRIVING_ESTIMATE";
  distanceMeters: number;
  durationSeconds: number;
  calculatedAt: string;
  lines: { latitude: number; longitude: number }[][];
};
const cache = new Map<string, { route: RoadRoute; expires: number }>();
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
function verifiedRoute(value: unknown): RoadRoute {
  const route = value as Partial<RoadRoute> | null;
  if (
    !route ||
    route.provider !== "KAKAO_DIRECTIONS" ||
    route.kind !== "DRIVING_ESTIMATE" ||
    !finite(route.distanceMeters) ||
    route.distanceMeters < 0 ||
    !finite(route.durationSeconds) ||
    route.durationSeconds < 0 ||
    typeof route.calculatedAt !== "string" ||
    !Number.isFinite(Date.parse(route.calculatedAt)) ||
    !Array.isArray(route.lines) ||
    !route.lines.length ||
    route.lines.length > 20000
  )
    throw new Error("도로 경로 응답을 확인하지 못했어요.");
  let count = 0;
  for (const line of route.lines) {
    if (!Array.isArray(line) || line.length < 2)
      throw new Error("도로 경로 좌표를 확인하지 못했어요.");
    for (const point of line)
      if (
        !point ||
        !finite(point.latitude) ||
        Math.abs(point.latitude) > 90 ||
        !finite(point.longitude) ||
        Math.abs(point.longitude) > 180 ||
        ++count > 120000
      )
        throw new Error("도로 경로 좌표를 확인하지 못했어요.");
  }
  return route as RoadRoute;
}
export async function getRoadRoute(
  points: MapPoint[],
  signal: AbortSignal,
): Promise<RoadRoute> {
  const coordinates = points.map(({ latitude, longitude }) => ({
    latitude,
    longitude,
  }));
  const key = JSON.stringify(coordinates);
  const stored = cache.get(key);
  if (stored && stored.expires > Date.now()) return stored.route;
  let response: Response;
  try { response = await fetch("/api/maps/directions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points: coordinates }),
    signal,
  }); } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("도로 연결이 잠시 끊겼어요. 연결을 확인하고 다시 계산해 주세요.");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.error?.message === "string"
        ? error.error.message
        : "도로 경로를 가져오지 못했어요.",
    );
  }
  const route = verifiedRoute(await response.json().catch(() => null));
  if (cache.size >= 40) cache.delete(cache.keys().next().value!);
  cache.set(key, { route, expires: Date.now() + 60000 });
  return route;
}
