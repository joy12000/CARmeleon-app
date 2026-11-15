import { z } from "zod";

const Coordinate = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
const Input = z.object({ points: z.array(Coordinate).min(2).max(32) }).strict();
type Coordinate = z.infer<typeof Coordinate>;
export type RoadRoute = {
  provider: "KAKAO_DIRECTIONS";
  kind: "DRIVING_ESTIMATE";
  distanceMeters: number;
  durationSeconds: number;
  calculatedAt: string;
  lines: Coordinate[][];
};
export class DirectionsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const Summary = z.object({
  distance: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
});
const Section = z.object({
  roads: z
    .array(
      z.object({ vertexes: z.array(z.number().finite()).min(4).max(240000) }),
    )
    .min(1)
    .max(20000),
});
const ProviderResponse = z.object({
  routes: z
    .array(
      z.object({
        result_code: z.number(),
        summary: Summary.optional(),
        sections: z.array(Section).max(31).optional(),
      }),
    )
    .min(1)
    .max(3),
});

export class KakaoDirections {
  private cache = new Map<string, { expires: number; route: RoadRoute }>();
  private pending = new Map<string, Promise<RoadRoute>>();
  private recentRequests: number[] = [];
  constructor(
    private apiKey?: string,
    private http: typeof fetch = fetch,
    private clock = Date.now,
  ) {}
  async route(raw: unknown): Promise<RoadRoute> {
    const parsed = Input.safeParse(raw);
    if (!parsed.success)
      throw new DirectionsError(
        400,
        "DIRECTIONS_INPUT",
        "좌표가 확인된 방문지 2~32곳이 필요해요.",
      );
    if (!this.apiKey)
      throw new DirectionsError(
        503,
        "DIRECTIONS_NOT_CONFIGURED",
        "길찾기 서버 연결이 아직 준비되지 않았어요.",
      );
    const key = JSON.stringify(parsed.data.points);
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.clock()) return cached.route;
    if (this.pending.has(key)) return this.pending.get(key)!;
    this.recentRequests = this.recentRequests.filter(
      (at) => at > this.clock() - 60000,
    );
    if (this.recentRequests.length >= 30 || this.pending.size >= 4)
      throw new DirectionsError(
        429,
        "DIRECTIONS_RATE_LIMIT",
        "경로를 여러 개 확인 중이에요. 잠시 후 다시 시도해 주세요.",
      );
    this.recentRequests.push(this.clock());
    const work = this.request(parsed.data.points)
      .then((route) => {
        if (this.cache.size >= 100)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { route, expires: this.clock() + 60000 });
        return route;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  private async request(points: Coordinate[]): Promise<RoadRoute> {
    const multiple = points.length > 7;
    const url = new URL(
      multiple
        ? "https://apis-navi.kakaomobility.com/v1/waypoints/directions"
        : "https://apis-navi.kakaomobility.com/v1/directions",
    );
    const timeout = AbortSignal.timeout(12000);
    const xy = (point: Coordinate) => `${point.longitude},${point.latitude}`;
    const position = (point: Coordinate) => ({
      x: point.longitude,
      y: point.latitude,
    });
    let body: string | undefined;
    if (multiple)
      body = JSON.stringify({
        origin: position(points[0]),
        destination: position(points.at(-1)!),
        waypoints: points.slice(1, -1).map(position),
        priority: "RECOMMEND",
        summary: false,
        road_details: false,
      });
    else {
      url.searchParams.set("origin", xy(points[0]));
      url.searchParams.set("destination", xy(points.at(-1)!));
      if (points.length > 2)
        url.searchParams.set(
          "waypoints",
          points.slice(1, -1).map(xy).join("|"),
        );
      url.searchParams.set("summary", "false");
      url.searchParams.set("alternatives", "false");
      url.searchParams.set("road_details", "false");
      url.searchParams.set("priority", "RECOMMEND");
    }
    let response: Response;
    try {
      response = await this.http(url, {
        method: multiple ? "POST" : "GET",
        headers: {
          Authorization: `KakaoAK ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: timeout,
        redirect: "error",
      });
    } catch {
      throw new DirectionsError(
        503,
        timeout.aborted ? "DIRECTIONS_TIMEOUT" : "DIRECTIONS_UNAVAILABLE",
        "도로 경로를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
    if (!response.ok)
      throw new DirectionsError(
        503,
        response.status === 429 ? "DIRECTIONS_QUOTA" : "DIRECTIONS_REJECTED",
        "카카오 길찾기를 사용할 수 없어요. 서버 키·사용 권한·이용량을 확인해 주세요.",
      );
    let document: unknown;
    try {
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 6 * 1024 * 1024) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      document = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new DirectionsError(
        502,
        "DIRECTIONS_RESPONSE",
        "도로 경로 응답을 확인하지 못했어요.",
      );
    }
    const parsed = ProviderResponse.safeParse(document);
    if (!parsed.success)
      throw new DirectionsError(
        502,
        "DIRECTIONS_RESPONSE",
        "도로 경로 응답을 확인하지 못했어요.",
      );
    const route = parsed.data.routes[0];
    if (route.result_code !== 0)
      throw new DirectionsError(
        422,
        "DIRECTIONS_NO_ROUTE",
        "선택한 방문지를 잇는 자동차 경로를 찾지 못했어요.",
      );
    if (!route.summary || route.sections?.length !== points.length - 1)
      throw new DirectionsError(
        502,
        "DIRECTIONS_INCOMPLETE",
        "일부 방문지의 도로 경로를 확인하지 못했어요.",
      );
    const lines: Coordinate[][] = [];
    let count = 0;
    for (const section of route.sections) {
      let line: Coordinate[] = [];
      for (const road of section.roads) {
        if (road.vertexes.length % 2)
          throw new DirectionsError(
            502,
            "DIRECTIONS_GEOMETRY",
            "경로 좌표 형식이 올바르지 않아요.",
          );
        const vertices: Coordinate[] = [];
        for (let index = 0; index < road.vertexes.length; index += 2) {
          const value = Coordinate.safeParse({
            longitude: road.vertexes[index],
            latitude: road.vertexes[index + 1],
          });
          if (!value.success || ++count > 120000)
            throw new DirectionsError(
              502,
              "DIRECTIONS_GEOMETRY",
              "경로 좌표 형식이 올바르지 않아요.",
            );
          vertices.push(value.data);
        }
        const end = line.at(-1);
        const start = vertices[0];
        if (
          end &&
          end.latitude === start.latitude &&
          end.longitude === start.longitude
        ) {
          for (let i = 1; i < vertices.length; i++) line.push(vertices[i]);
        } else {
          if (line.length) lines.push(line);
          line = vertices;
        }
      }
      if (line.length) lines.push(line);
    }
    return {
      provider: "KAKAO_DIRECTIONS",
      kind: "DRIVING_ESTIMATE",
      ...{
        distanceMeters: route.summary.distance,
        durationSeconds: route.summary.duration,
      },
      calculatedAt: new Date(this.clock()).toISOString(),
      lines,
    };
  }
}
