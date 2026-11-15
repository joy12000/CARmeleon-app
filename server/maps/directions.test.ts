import { test, expect } from "bun:test";
import { KakaoDirections, DirectionsError } from "./directions";
const points = [
  { latitude: 37.5, longitude: 127 },
  { latitude: 37.51, longitude: 127.01 },
];
const payload = () => ({
  routes: [
    {
      result_code: 0,
      summary: { distance: 1700, duration: 230 },
      sections: [
        {
          roads: [
            { vertexes: [127, 37.5, 127.001, 37.503] },
            { vertexes: [127.001, 37.503, 127.01, 37.51] },
          ],
        },
      ],
    },
  ],
});
const fetcher = (data: unknown) => async () => Response.json(data);
test("official endpoint, header-only key, geometry axes, cache and inflight dedup", async () => {
  let calls = 0;
  const service = new KakaoDirections("private-test-key", async (url, init) => {
    calls++;
    expect(
      String(url).startsWith(
        "https://apis-navi.kakaomobility.com/v1/directions?",
      ),
    ).toBe(true);
    expect(String(url)).not.toContain("private-test-key");
    expect(init?.headers).toEqual({
      Authorization: "KakaoAK private-test-key",
      "Content-Type": "application/json",
    });
    expect(new URL(String(url)).searchParams.get("origin")).toBe("127,37.5");
    return Response.json(payload());
  });
  const [a, b] = await Promise.all([
    service.route({ points }),
    service.route({ points }),
  ]);
  expect(calls).toBe(1);
  expect(a).toEqual(b);
  expect(a.lines).toEqual([
    [points[0], { latitude: 37.503, longitude: 127.001 }, points[1]],
  ]);
  expect(a.kind).toBe("DRIVING_ESTIMATE");
  expect(JSON.stringify(a)).not.toContain("private-test-key");
  await service.route({ points });
  expect(calls).toBe(1);
});
test("order is significant and more than five waypoints use official POST", async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    latitude: 37.5 + i * 0.001,
    longitude: 127 + i * 0.001,
  }));
  const service = new KakaoDirections("test", async (url, init) => {
    expect(String(url)).toBe(
      "https://apis-navi.kakaomobility.com/v1/waypoints/directions",
    );
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.origin).toEqual({ x: 127, y: 37.5 });
    expect(body.waypoints.length).toBe(6);
    return Response.json({
      routes: [
        {
          result_code: 0,
          summary: { distance: 1000, duration: 100 },
          sections: many
            .slice(1)
            .map((p, i) => ({
              roads: [
                {
                  vertexes: [
                    many[i].longitude,
                    many[i].latitude,
                    p.longitude,
                    p.latitude,
                  ],
                },
              ],
            })),
        },
      ],
    });
  });
  expect((await service.route({ points: many })).lines.length).toBe(7);
});
test("rejects missing credentials, malformed input and over limit before network", async () => {
  let calls = 0;
  const http = async () => {
    calls++;
    return Response.json(payload());
  };
  await expect(
    new KakaoDirections(undefined, http).route({ points }),
  ).rejects.toMatchObject({ code: "DIRECTIONS_NOT_CONFIGURED" });
  for (const invalid of [
    { points: [points[0]] },
    { points: [{ latitude: 91, longitude: 127 }, points[1]] },
    { points: Array(33).fill(points[0]) },
    { points, endpoint: "http://localhost" },
  ])
    await expect(
      new KakaoDirections("test", http).route(invalid),
    ).rejects.toBeInstanceOf(DirectionsError);
  expect(calls).toBe(0);
});
test("no route, partial route and malformed geometry never become straight-line success", async () => {
  const bad = [
    { routes: [{ result_code: 104 }] },
    {
      routes: [
        { result_code: 0, summary: { distance: 1, duration: 1 }, sections: [] },
      ],
    },
    {
      routes: [
        {
          result_code: 0,
          summary: { distance: 1, duration: 1 },
          sections: [{ roads: [{ vertexes: [127, 37.5, 128, 37.6, 129] }] }],
        },
      ],
    },
    {
      routes: [
        {
          result_code: 0,
          summary: { distance: 1, duration: 1 },
          sections: [{ roads: [{ vertexes: [127, 37.5, 128, 99] }] }],
        },
      ],
    },
  ];
  for (const data of bad)
    await expect(
      new KakaoDirections("test", fetcher(data)).route({ points }),
    ).rejects.toBeInstanceOf(DirectionsError);
});
test("disconnected road geometry remains disconnected", async () => {
  const data = payload();
  data.routes[0].sections[0].roads[1].vertexes = [
    127.008, 37.508, 127.01, 37.51,
  ];
  expect(
    (await new KakaoDirections("test", fetcher(data)).route({ points })).lines
      .length,
  ).toBe(2);
});
test("provider rejection and errors omit private provider payload", async () => {
  for (const status of [401, 403, 429, 500]) {
    const service = new KakaoDirections("secret", async () =>
      Response.json({ msg: "secret and private data" }, { status }),
    );
    await expect(service.route({ points })).rejects.toMatchObject({
      status: 503,
    });
  }
  await expect(
    new KakaoDirections("secret", async () => {
      throw new Error("private upstream URL");
    }).route({ points }),
  ).rejects.toMatchObject({ code: "DIRECTIONS_UNAVAILABLE" });
});
test("cache expires and failed requests are retryable", async () => {
  let now = 100000,
    calls = 0;
  const service = new KakaoDirections(
    "test",
    async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 429 });
      return Response.json(payload());
    },
    () => now,
  );
  await expect(service.route({ points })).rejects.toMatchObject({
    code: "DIRECTIONS_QUOTA",
  });
  await service.route({ points });
  now += 59000;
  await service.route({ points });
  expect(calls).toBe(2);
  now += 2000;
  await service.route({ points });
  expect(calls).toBe(3);
});
