import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, MapPin, Minus, Plus } from "lucide-react";
import type { SavedRoute } from "../../types";
import {
  createKakaoMap,
  createOsmMap,
  mapPoints,
  mapProvider,
} from "./mapProviders";
import type { MapHandle } from "./mapProviders";
import { getRoadRoute, type RoadRoute } from "./roadDirections";

export function RouteLocationMap({
  route,
  interactive = false,
}: {
  route: SavedRoute;
  interactive?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle>();
  const points = useMemo(() => mapPoints(route.stops), [route.stops]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [retry, setRetry] = useState(0);
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeRetry, setRouteRetry] = useState(0);
  const routeSignature = JSON.stringify([
    route.id,
    route.stops.map((stop) => stop.id),
    points.map((point) => [point.id, point.latitude, point.longitude]),
  ]);
  const [resolvedSignature, setResolvedSignature] = useState("");
  const routeCurrent = resolvedSignature === routeSignature;
  useEffect(() => {
    if (!container.current || !points.length) return;
    let disposed = false;
    let owned: MapHandle | undefined;
    const routing = new AbortController();
    setStatus("loading");
    setRoadRoute(null);
    setRouteError("");
    setRouteLoading(false);
    setResolvedSignature(routeSignature);
    const callbacks = {
      ready: () => {
        clearTimeout(timeout);
        if (!disposed) setStatus("ready");
      },
      error: () => {
        clearTimeout(timeout);
        if (!disposed) setStatus("error");
      },
    };
    const timeout = setTimeout(callbacks.error, 15000);
    const observer = new ResizeObserver(() => handle.current?.resize());
    observer.observe(container.current);
    const setup = async () => {
      try {
        const created =
          mapProvider === "kakao"
            ? await createKakaoMap(
                container.current!,
                points,
                route.stops.length - 1,
                interactive,
                callbacks,
                () => disposed,
              )
            : createOsmMap(
                container.current!,
                points,
                route.stops.length - 1,
                interactive,
                callbacks,
              );
        if (disposed) {
          created?.destroy();
          return;
        }
        owned = created;
        handle.current = created;
        if (
          mapProvider === "kakao" &&
          points.length === route.stops.length &&
          points.length >= 2 &&
          points.length <= 32
        ) {
          setRouteLoading(true);
          try {
            const calculated = await getRoadRoute(points, routing.signal);
            if (!disposed) {
              created?.setRoadRoute(calculated);
              setRoadRoute(calculated);
            }
          } catch (error) {
            if (!disposed)
              setRouteError(
                error instanceof Error
                  ? error.message
                  : "도로 경로를 가져오지 못했어요.",
              );
          } finally {
            if (!disposed) setRouteLoading(false);
          }
        }
      } catch {
        callbacks.error();
      }
    };
    void setup();
    return () => {
      disposed = true;
      routing.abort();
      clearTimeout(timeout);
      observer.disconnect();
      owned?.destroy();
      if (handle.current === owned) handle.current = undefined;
    };
  }, [
    points,
    route.stops.length,
    interactive,
    retry,
    routeRetry,
    routeSignature,
  ]);
  if (!points.length)
    return (
      <div className="route-map-empty">
        <MapPin size={22} />
        <p>방문지의 위치를 확인해 주세요.</p>
        <span>좌표가 있는 장소를 추가하면 실제 지도가 표시돼요.</span>
      </div>
    );
  return (
    <div
      className={`route-real-map${interactive ? " route-real-map-interactive" : ""}`}
      data-provider={mapProvider}
      data-status={status}
      data-road-status={
        routeCurrent && roadRoute
          ? "ready"
          : routeLoading
            ? "loading"
            : routeError
              ? "error"
              : "none"
      }
      data-road-vertices={
        routeCurrent && roadRoute
          ? roadRoute.lines.reduce((sum, line) => sum + line.length, 0)
          : 0
      }
    >
      <div
        className="route-map-frame"
        ref={container}
        role="region"
        aria-label={
          routeCurrent && roadRoute
            ? "저장된 방문지를 잇는 카카오 자동차 경로 지도"
            : "저장된 방문지 지도. 도로 경로 계산 전입니다."
        }
      />
      {status === "loading" && (
        <span className="route-map-loading" role="status">
          지도 불러오는 중
        </span>
      )}
      {status === "error" && (
        <div className="route-map-error" role="status">
          <p>
            {mapProvider === "kakao"
              ? "카카오맵 키와 등록 도메인을 확인해 주세요."
              : "지도 연결을 확인해 주세요."}
          </p>
          <button
            className="secondary-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {interactive && (
        <div className="route-map-controls" aria-label="지도 조작">
          <button
            className="icon-button"
            aria-label="지도 확대"
            onClick={() => handle.current?.zoomIn()}
          >
            <Plus size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="지도 축소"
            onClick={() => handle.current?.zoomOut()}
          >
            <Minus size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="모든 방문지 보기"
            onClick={() => handle.current?.fit()}
          >
            <LocateFixed size={20} />
          </button>
        </div>
      )}
      {routeCurrent && roadRoute && (
        <div className="road-route-summary">
          <strong>
            {Math.max(1, Math.ceil(roadRoute.durationSeconds / 60))}분
          </strong>
          <span>{(roadRoute.distanceMeters / 1000).toFixed(1)} km</span>
          <span>카카오 자동차 경로</span>
        </div>
      )}
      {routeLoading && (
        <div className="road-route-status" role="status">
          도로 경로 계산 중
        </div>
      )}
      {routeError && (
        <div className="road-route-status" role="status">
          <span>{routeError}</span>
          <button
            className="text-button"
            onClick={() => setRouteRetry((value) => value + 1)}
          >
            다시 계산
          </button>
        </div>
      )}
      {points.length > 32 && (
        <p className="map-missing-places">
          도로 경로는 방문지 32곳까지 미리 볼 수 있어요.
        </p>
      )}
      {points.length < route.stops.length && (
        <p className="map-missing-places">
          위치 미확인 {route.stops.length - points.length}곳은 지도에서
          제외했어요.
        </p>
      )}
    </div>
  );
}
