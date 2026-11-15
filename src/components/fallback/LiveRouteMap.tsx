import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Minus, Navigation, Plus } from 'lucide-react';
import { createKakaoMap, createOsmMap, mapPoints, mapProvider, type MapHandle } from '../phone/mapProviders';
import type { RouteStop, SavedRoute } from '../../types';
import type { Position } from '../../live/journey';
import { getRoadRoute, type RoadRoute } from '../phone/roadDirections';

export function LiveRouteMap({ route, position, origin, follow = false, road, preview, previewStops, previewOrigin }: { route: SavedRoute; position: Position | null; origin?: Position | null; follow?: boolean; road?: RoadRoute | null; preview?: RoadRoute; previewStops?: RouteStop[]; previewOrigin?: Position }) {
  const container = useRef<HTMLDivElement>(null), handle = useRef<MapHandle>();
  const positionRef = useRef(position); positionRef.current = position;
  const [following, setFollowing] = useState(follow);
  const followingRef = useRef(following); followingRef.current = following;
  const fullRoad = useRef<RoadRoute>();
  const previewRef = useRef(preview); previewRef.current = preview;
  const [status, setStatus] = useState('loading'), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const displayStops = preview && previewStops ? previewStops : route.stops;
  const displayOrigin = preview ? previewOrigin : origin;
  const signature = JSON.stringify([route.id, displayOrigin, displayStops.map(s => [s.id, s.latitude ?? s.lat, s.longitude ?? s.lng])]);
  useEffect(() => {
    let disposed = false; const control = new AbortController();
    let owned: MapHandle | undefined;
    setStatus('loading'); setError('');
    fullRoad.current = undefined;
    const points = displayOrigin ? [
      { id: 'browser-origin', name: '모의 출발점', index: -1, ...displayOrigin },
      ...mapPoints(displayStops),
    ] : mapPoints(displayStops);
    if (!container.current || !points.length) { setStatus('error'); setError('좌표가 있는 경로를 선택해 주세요.'); return; }
    const timeout = setTimeout(() => { if (!disposed) { setStatus('error'); setError('지도를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.'); } }, 15000);
    const callbacks = { ready: () => { if (!disposed) { clearTimeout(timeout); setStatus('ready'); } }, error: () => { if (!disposed) { clearTimeout(timeout); setStatus('error'); setError('지도 연결을 확인해 주세요.'); } } };
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (!disposed) owned?.resize(); });
    }); observer.observe(container.current);
    void (async () => {
      try {
        if (import.meta.env.VITE_NAV_MAP_RENDERER !== 'kakao') {
          try { const { createNavigationMap } = await import('./navigationMap'); owned = await createNavigationMap(container.current!, points, callbacks, () => disposed); }
          catch { if (!disposed) setError('입체 지도 연결을 확인하지 못해 기본 지도로 표시해요.'); }
        }
        if (!owned && !disposed) owned = mapProvider === 'kakao' ? await createKakaoMap(container.current!, points, displayStops.length - 1, true, callbacks, () => disposed) : createOsmMap(container.current!, points, displayStops.length - 1, true, callbacks);
        if (disposed) { owned?.destroy(); return; }
        handle.current = owned;
        if (positionRef.current) owned?.setVehiclePosition?.(positionRef.current);
        if (previewRef.current) { owned?.setRoadRoute(previewRef.current); owned?.fit(); }
        else if (points.length === route.stops.length + (origin ? 1 : 0) && points.length > 1 && points.length <= 32) {
          const road = await getRoadRoute(points, control.signal);
          if (!disposed) { fullRoad.current = road; if (!followingRef.current && !previewRef.current) owned?.setRoadRoute(road); }
        }
      } catch (error) { if (!disposed) { setError(error instanceof Error ? error.message : '지도를 불러오지 못했어요.'); if (!owned) setStatus('error'); } }
    })();
    return () => { disposed = true; clearTimeout(timeout); control.abort(); observer.disconnect(); cancelAnimationFrame(resizeFrame); owned?.destroy(); if (handle.current === owned) handle.current = undefined; };
  }, [signature, retry]);
  useEffect(() => { setFollowing(follow); }, [follow]);
  useEffect(() => { if (position) { handle.current?.setVehiclePosition?.(position); if (following && !preview) handle.current?.followPosition?.(position); } }, [position, following, status, preview]);
  useEffect(() => {
    const geometry = preview || (following ? road : fullRoad.current) || road;
    if (geometry) handle.current?.setRoadRoute(geometry);
    if (!preview && following && positionRef.current) handle.current?.followPosition?.(positionRef.current);
  }, [road, following, status, preview]);
  return <div className="browser-map" data-status={status} data-preview={!!preview}>
    <div className="browser-map-canvas" ref={container} role="region" aria-label="실제 지도와 모의 주행 경로" onPointerDown={() => setFollowing(false)} onWheel={() => setFollowing(false)} />
    {status === 'loading' && <p className="browser-map-message" role="status">지도를 불러오고 있어요</p>}
    {error && <div className="browser-map-message" role="status"><p>{error}</p><button onClick={() => setRetry(r => r + 1)}>다시 시도</button></div>}
    <div className="browser-map-controls"><button aria-label="지도 확대" onClick={() => { setFollowing(false); handle.current?.zoomIn(); }}><Plus size={20} /></button><button aria-label="지도 축소" onClick={() => { setFollowing(false); handle.current?.zoomOut(); }}><Minus size={20} /></button><button aria-label="모의 위치 따라가기" disabled={!!preview} aria-pressed={following && !preview} onClick={() => setFollowing(true)}><Navigation size={19} /></button><button aria-label="전체 경로 보기" onClick={() => { setFollowing(false); const geometry = preview || fullRoad.current; if (geometry) handle.current?.setRoadRoute(geometry); handle.current?.fit(); }}><LocateFixed size={20} /></button></div>
  </div>;
}
