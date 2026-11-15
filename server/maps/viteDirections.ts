import type { Plugin } from "vite";
import { DirectionsError, KakaoDirections } from "./directions";

/** Local preview bridge. The private REST key stays in Vite's server process. */
export function localDirectionsPlugin(apiKey?: string): Plugin {
  const directions = new KakaoDirections(apiKey);
  return {
    name: "carmeleon-local-directions",
    configureServer(server) {
      server.middlewares.use(
        "/api/maps/directions",
        async (request, response) => {
          const send = (status: number, data: unknown) => {
            response.writeHead(status, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            response.end(JSON.stringify(data));
          };
          try {
            const host = request.headers.host ?? "";
            const url = new URL(`http://${host}`);
            const origin = request.headers.origin;
            if (
              !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
              (origin && origin !== url.origin) ||
              request.headers["sec-fetch-site"] === "cross-site"
            )
              return send(403, {
                error: {
                  code: "DIRECTIONS_ORIGIN",
                  message: "로컬 준비 화면에서만 사용할 수 있어요.",
                },
              });
            if (request.method !== "POST")
              return send(405, {
                error: {
                  code: "METHOD_NOT_ALLOWED",
                  message: "POST 요청이 필요해요.",
                },
              });
            if (
              !request.headers["content-type"]?.startsWith("application/json")
            )
              return send(415, {
                error: {
                  code: "JSON_REQUIRED",
                  message: "JSON 요청이 필요해요.",
                },
              });
            let text = "";
            for await (const chunk of request) {
              text += chunk.toString();
              if (text.length > 16384)
                return send(413, {
                  error: {
                    code: "REQUEST_SIZE",
                    message: "경로 요청이 너무 커요.",
                  },
                });
            }
            return send(200, await directions.route(JSON.parse(text)));
          } catch (error) {
            if (error instanceof DirectionsError)
              return send(error.status, {
                error: { code: error.code, message: error.message },
              });
            return send(400, {
              error: {
                code: "DIRECTIONS_REQUEST",
                message: "경로 요청을 확인해 주세요.",
              },
            });
          }
        },
      );
    },
  };
}
