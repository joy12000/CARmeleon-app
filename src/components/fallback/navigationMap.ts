import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { MapCallbacks, MapHandle, MapPoint } from '../phone/mapProviders';
import type { RoadRoute } from '../phone/roadDirections';

type Position = { latitude: number; longitude: number };
maplibregl.setWorkerUrl(workerUrl);
export function roadBearing(a: Position, b: Position) {
  const rad = Math.PI / 180, d = (b.longitude - a.longitude) * rad;
  return (Math.atan2(Math.sin(d) * Math.cos(b.latitude * rad), Math.cos(a.latitude * rad) * Math.sin(b.latitude * rad) - Math.sin(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.cos(d)) / rad + 360) % 360;
}
function nearestBearing(road: RoadRoute, position: Position) {
  let best = Infinity, bearing = 0;
  const cos = Math.cos(position.latitude * Math.PI / 180);
  for (const line of road.lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = (b.longitude - a.longitude) * cos, dy = b.latitude - a.latitude;
    const t = Math.max(0, Math.min(1, ((position.longitude - a.longitude) * cos * dx + (position.latitude - a.latitude) * dy) / (dx * dx + dy * dy || 1)));
    const distance = ((position.longitude - a.longitude) * cos - t * dx) ** 2 + (position.latitude - a.latitude - t * dy) ** 2;
    if (distance < best && dx * dx + dy * dy > 0) { best = distance; bearing = roadBearing(a, b); }
  }
  return bearing;
}
const dataFor = (road?: RoadRoute) => ({ type: 'FeatureCollection' as const, features: road ? road.lines.map(line => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: line.map(point => [point.longitude, point.latitude]) } })) : [] });

/** A pitched geographic camera, not a CSS-transformed image. Kakao still supplies the road. */
export async function createNavigationMap(container: HTMLElement, points: MapPoint[], callbacks: MapCallbacks, disposed: () => boolean): Promise<MapHandle> {
  const center = points[0], next = points[1] || center;
  const response = await fetch('https://tiles.openfreemap.org/styles/positron', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('입체 지도 스타일을 불러오지 못했어요.');
  const style: StyleSpecification = await response.json();
  if (disposed()) throw new Error('지도 연결을 종료했어요.');
  for (const layer of style.layers) {
    if (layer.id.includes('shield') && 'filter' in layer && layer.filter) layer.filter = ['all', ['has', 'ref_length'], layer.filter] as NonNullable<typeof layer.filter>;
    const textField = layer.type === 'symbol' ? layer.layout?.['text-field'] : undefined;
    if (layer.type === 'symbol' && textField && /name/.test(JSON.stringify(textField))) layer.layout = { ...layer.layout, 'text-field': ['coalesce', ['get', 'name:ko'], ['get', 'name'], ['get', 'name:latin']] };
  }
  const map = new maplibregl.Map({ container, style, center: [center.longitude, center.latitude], zoom: 15.3, pitch: 55, bearing: roadBearing(center, next), maxPitch: 65, attributionControl: { compact: true }, dragRotate: true, touchPitch: true, renderWorldCopies: false, fadeDuration: 150 });
  let road: RoadRoute | undefined, vehicle: maplibregl.Marker | undefined, vehicleElement: HTMLDivElement | undefined;
  let lastPosition: Position | undefined, heading = roadBearing(center, next);
  const markers: maplibregl.Marker[] = [];
  let removed = false;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const annotate = () => {
    if (removed) return;
    container.dataset.renderer = 'maplibre';
    container.dataset.pitch = Math.round(map.getPitch()).toString();
    container.dataset.bearing = Math.round(map.getBearing()).toString();
    container.dataset.zoom = map.getZoom().toFixed(1);
  };
  map.on('move', annotate);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('입체 지도 연결을 확인해 주세요.')), 18000);
      map.once('load', () => { clearTimeout(timeout); resolve(); });
      map.once('remove', () => { clearTimeout(timeout); reject(new Error('지도 연결을 종료했어요.')); });
    });
    if (disposed()) throw new Error('지도 연결을 종료했어요.');
    map.addSource('carmeleon-road', { type: 'geojson', data: dataFor() });
    map.addLayer({ id: 'carmeleon-road-casing', type: 'line', source: 'carmeleon-road', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 12, 'line-opacity': .95 } });
    map.addLayer({ id: 'carmeleon-road-line', type: 'line', source: 'carmeleon-road', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#286eea', 'line-width': 7 } });
    for (const point of points.filter(p => p.index >= 0)) {
      const element = document.createElement('span'); element.className = 'route-map-pin' + (point.index === points.length - 2 ? ' route-map-pin-last' : '');
      element.title = (point.index + 1) + '. ' + point.name; element.textContent = String(point.index + 1);
      markers.push(new maplibregl.Marker({ element, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([point.longitude, point.latitude]).addTo(map));
    }
    map.easeTo({ center: [center.longitude, center.latitude], zoom: 15.3, pitch: 55, bearing: heading, offset: [0, Math.min(150, container.clientHeight * .18)], duration: 0 });
    annotate(); callbacks.ready();
  } catch (error) { removed = true; map.remove(); throw error; }
  const handle: MapHandle = {
    fit: () => {
      const bounds = new maplibregl.LngLatBounds();
      [...points, ...(road?.lines.flat() || [])].forEach(p => bounds.extend([p.longitude, p.latitude]));
      map.fitBounds(bounds, { padding: { top: 120, bottom: 100, left: 55, right: 55 }, maxZoom: 16, pitch: 0, bearing: 0, duration: reduced() ? 0 : 450 });
    },
    zoomIn: () => map.zoomIn({ duration: 200 }), zoomOut: () => map.zoomOut({ duration: 200 }), resize: () => map.resize(),
    destroy: () => { if (removed) return; removed = true; vehicle?.remove(); markers.forEach(m => m.remove()); map.remove(); },
    setRoadRoute: value => { road = value; if (lastPosition) heading = nearestBearing(value, lastPosition); (map.getSource('carmeleon-road') as GeoJSONSource).setData(dataFor(value)); },
    setVehiclePosition: position => {
      if (lastPosition) {
        const delta = Math.hypot((position.latitude - lastPosition.latitude), (position.longitude - lastPosition.longitude) * Math.cos(position.latitude * Math.PI / 180));
        if (delta > .000015) heading = roadBearing(lastPosition, position);
      } else if (road) heading = nearestBearing(road, position);
      lastPosition = position;
      if (!vehicle) {
        vehicleElement = document.createElement('div'); vehicleElement.className = 'navigation-vehicle'; vehicleElement.setAttribute('aria-label', '현재 이동 위치');
        vehicleElement.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 21 21 12 17 3 21Z" fill="white"/></svg>';
        vehicle = new maplibregl.Marker({ element: vehicleElement, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([position.longitude, position.latitude]).addTo(map);
      } else vehicle.setLngLat([position.longitude, position.latitude]);
      vehicle.setRotation(heading - map.getBearing());
    },
    followPosition: position => {
      if (road && !lastPosition) heading = nearestBearing(road, position);
      const current = map.getBearing(), difference = ((heading - current + 540) % 360) - 180;
      map.easeTo({ center: [position.longitude, position.latitude], zoom: 16, pitch: 55, bearing: current + difference, offset: [0, Math.min(150, container.clientHeight * .18)], duration: reduced() ? 0 : 180 });
      vehicle?.setRotation(0);
    },
  };
  return handle;
}
