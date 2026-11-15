import { test, expect } from "bun:test";
import { Readable } from "node:stream";
import { localDirectionsPlugin } from "./viteDirections";
const handler = () => {
  let middleware: any;
  const plugin = localDirectionsPlugin();
  (plugin.configureServer as Function)({
    middlewares: {
      use: (_path: string, action: unknown) => (middleware = action),
    },
  });
  return async (
    method: string,
    headers: Record<string, string>,
    body = "{}",
  ) => {
    const request = Readable.from([body]);
    Object.assign(request, { method, headers });
    return await new Promise<any>((resolve) => {
      let status: number;
      const response = {
        writeHead: (value: number) => (status = value),
        end: (text: string) => resolve({ status, ...JSON.parse(text) }),
      };
      middleware(request, response);
    });
  };
};
test("local preview rejects foreign origins, cross-site posts and forged hosts", async () => {
  const request = handler();
  for (const headers of [
    { host: "127.0.0.1:5173", origin: "https://outside.example" },
    { host: "outside.example", origin: "http://outside.example" },
    { host: "localhost:5173", "sec-fetch-site": "cross-site" },
  ])
    expect(
      (
        await request("POST", {
          "content-type": "application/json",
          ...headers,
        })
      ).status,
    ).toBe(403);
});
test("local preview validates method, body, content type and missing private configuration", async () => {
  const request = handler(),
    headers = {
      host: "127.0.0.1:5173",
      origin: "http://127.0.0.1:5173",
      "content-type": "application/json",
    };
  expect((await request("GET", headers)).status).toBe(405);
  expect(
    (await request("POST", { ...headers, "content-type": "text/plain" }))
      .status,
  ).toBe(415);
  expect((await request("POST", headers, "{")).status).toBe(400);
  expect((await request("POST", headers, "x".repeat(17000))).status).toBe(413);
  expect(
    (
      await request(
        "POST",
        headers,
        JSON.stringify({
          points: [
            { latitude: 37.5, longitude: 127 },
            { latitude: 37.51, longitude: 127.01 },
          ],
        }),
      )
    ).error.code,
  ).toBe("DIRECTIONS_NOT_CONFIGURED");
});
