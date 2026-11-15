import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteStop } from "../../types";
import type { RoadRoute } from "./roadDirections";

export type MapPoint = {
  id: string;
  name: string;
  index: number;
  latitude: number;
  longitude: number;
};
export type MapHandle = {
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  resize(): void;
  destroy(): void;
  setRoadRoute(route: RoadRoute): void;
  setVehiclePosition?(point: { latitude: number; longitude: number }): void;
  followPosition?(point: { latitude: number; longitude: number }): void;
};
export type MapCallbacks = { ready(): void; error(): void };
export const mapProvider =
  import.meta.env.VITE_MAP_PROVIDER?.trim() ||
  (import.meta.env.VITE_KAKAO_MAP_JAVASCRIPT_KEY?.trim() ? "kakao" : "osm");
export function coordinateOf(
  stop: RouteStop,
): { latitude: number; longitude: number } | null {
  const latitude = stop.latitude ?? stop.lat;
  const longitude = stop.longitude ?? stop.lng;
  return typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}
export function mapPoints(stops: RouteStop[]): MapPoint[] {
  return stops.flatMap((stop, index) => {
    const coordinate = coordinateOf(stop);
    return coordinate
      ? [{ id: stop.id, name: stop.name, index, ...coordinate }]
      : [];
  });
}
function pin(point: MapPoint, lastIndex: number) {
  const element = document.createElement("span");
  element.className = `route-map-pin${point.index === lastIndex ? " route-map-pin-last" : ""}`;
  element.textContent = point.index < 0 ? '출발' : String(point.index + 1);
  element.title = `${point.index + 1}. ${point.name}`;
  return element;
}

/** Saved stop markers and verified provider geometry; no straight-line route fallback. */
export function createOsmMap(
  container: HTMLElement,
  points: MapPoint[],
  lastIndex: number,
  interactive: boolean,
  callbacks: MapCallbacks,
): MapHandle {
  let vehicle: L.Marker | undefined;
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true,
    dragging: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    touchZoom: true,
    boxZoom: true,
    keyboard: true,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
  });
  map.attributionControl.setPrefix(false);
  let routeGeometry: RoadRoute | undefined;
  const roadLayer = L.layerGroup().addTo(map);
  const fit = () => {
    map.fitBounds(
      L.latLngBounds(
        [...points, ...(routeGeometry?.lines.flat() ?? [])].map((point) => [
          point.latitude,
          point.longitude,
        ]),
      ),
      { padding: [38, 38], maxZoom: 15, animate: false },
    );
  };
  fit();
  let loaded = false;
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    keepBuffer: 0,
    updateWhenIdle: true,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  });
  tiles.on("tileload", () => {
    loaded = true;
    callbacks.ready();
  });
  tiles.on("load", () => {
    if (!loaded) callbacks.error();
  });
  tiles.addTo(map);
  points.forEach((point, index) => {
    const marker = L.marker([point.latitude, point.longitude], {
      icon: L.divIcon({
        html: pin(point, lastIndex),
        className: "route-map-marker",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
      title: `${point.index + 1}. ${point.name}`,
      interactive,
      keyboard: interactive,
    });
    const label = document.createElement("span");
    label.textContent = `${point.index + 1}. ${point.name}`;
    if (interactive) marker.bindPopup(label);
    marker.addTo(map);
  });
  return {
    fit,
    zoomIn: () => map.zoomIn(undefined, { animate: false }),
    zoomOut: () => map.zoomOut(undefined, { animate: false }),
    resize: () => map.invalidateSize({ animate: false, pan: false }),
    destroy: () => map.remove(),
    setVehiclePosition: (point) => {
      const coordinates: L.LatLngExpression = [point.latitude, point.longitude];
      if (vehicle) vehicle.setLatLng(coordinates);
      else vehicle = L.marker(coordinates, { icon: L.divIcon({ className: 'browser-vehicle-marker', html: '<span aria-label="모의 주행 위치">↑</span>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1000 }).addTo(map);
    },
    followPosition: (point) => map.setView([point.latitude, point.longitude], 15, { animate: false }),
    setRoadRoute: (route) => {
      routeGeometry = route;
      roadLayer.clearLayers();
      route.lines.forEach((line) => {
        const path = line.map(
          (point) => [point.latitude, point.longitude] as [number, number],
        );
        L.polyline(path, {
          color: "#fff",
          weight: 8,
          interactive: false,
        }).addTo(roadLayer);
        L.polyline(path, {
          color: "#316ee8",
          weight: 5,
          interactive: false,
        }).addTo(roadLayer);
      });
      fit();
    },
  };
}

type KakaoLatLng = object;
type KakaoMap = {
  setCenter(point: KakaoLatLng): void;
  setBounds(
    bounds: object,
    top?: number,
    right?: number,
    bottom?: number,
    left?: number,
  ): void;
  setLevel(level: number): void;
  getLevel(): number;
  relayout(): void;
  setZoomable(value: boolean): void;
};
type KakaoOverlay = { setMap(map: KakaoMap | null): void; setPosition?(position: KakaoLatLng): void };
type KakaoMaps = {
  load(callback: () => void): void;
  Map: new (container: HTMLElement, options: object) => KakaoMap;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  LatLngBounds: new () => { extend(point: KakaoLatLng): void };
  CustomOverlay: new (options: object) => KakaoOverlay;
  Polyline: new (options: object) => KakaoOverlay;
  event: {
    addListener(target: object, name: string, callback: () => void): void;
    removeListener(target: object, name: string, callback: () => void): void;
  };
};
declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}
let kakaoLoading: Promise<KakaoMaps> | undefined;
function loadKakao(): Promise<KakaoMaps> {
  if (kakaoLoading) return kakaoLoading;
  const key = import.meta.env.VITE_KAKAO_MAP_JAVASCRIPT_KEY?.trim();
  if (!key) return Promise.reject(new Error("Kakao JavaScript key is missing"));
  kakaoLoading = new Promise<KakaoMaps>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      script.remove();
      reject(new Error("Kakao SDK timeout"));
    }, 10000);
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("Kakao SDK unavailable"));
    };
    script.onload = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        clearTimeout(timeout);
        script.remove();
        reject(new Error("Kakao SDK unavailable"));
        return;
      }
      maps.load(() => {
        clearTimeout(timeout);
        resolve(maps);
      });
    };
    document.head.appendChild(script);
  }).catch((error) => {
    kakaoLoading = undefined;
    throw error;
  });
  return kakaoLoading;
}
export async function createKakaoMap(
  container: HTMLElement,
  points: MapPoint[],
  lastIndex: number,
  interactive: boolean,
  callbacks: MapCallbacks,
  isDisposed: () => boolean,
): Promise<MapHandle | undefined> {
  const sdk = await loadKakao();
  if (isDisposed()) return;
  const coordinates = points.map(
    (point) => new sdk.LatLng(point.latitude, point.longitude),
  );
  const map = new sdk.Map(container, {
    center: coordinates[0],
    level: 6,
    draggable: true,
    scrollwheel: true,
    disableDoubleClickZoom: false,
  });
  map.setZoomable(true);
  let routeGeometry: RoadRoute | undefined;
  const fit = () => {
    if (coordinates.length === 1) {
      map.setCenter(coordinates[0]);
      map.setLevel(5);
    } else {
      const bounds = new sdk.LatLngBounds();
      coordinates.forEach((coordinate) => bounds.extend(coordinate));
      routeGeometry?.lines.forEach((line) =>
        line.forEach((point) =>
          bounds.extend(new sdk.LatLng(point.latitude, point.longitude)),
        ),
      );
      map.setBounds(bounds, 38, 38, 38, 38);
    }
  };
  const onTiles = () => callbacks.ready();
  sdk.event.addListener(map, "tilesloaded", onTiles);
  fit();
  const overlays: KakaoOverlay[] = [];
  points.forEach((point, index) => {
    const element = pin(point, lastIndex);
    element.setAttribute("aria-label", `${point.index + 1}. ${point.name}`);
    overlays.push(
      new sdk.CustomOverlay({
        map,
        position: coordinates[index],
        content: element,
        xAnchor: 0.5,
        yAnchor: 0.5,
      }),
    );
  });
  const roadOverlays: KakaoOverlay[] = [];
  let vehicle: KakaoOverlay | undefined;
  return {
    fit,
    zoomIn: () => map.setLevel(Math.max(1, map.getLevel() - 1)),
    zoomOut: () => map.setLevel(Math.min(14, map.getLevel() + 1)),
    resize: () => map.relayout(),
    destroy: () => {
      sdk.event.removeListener(map, "tilesloaded", onTiles);
      [...overlays, ...roadOverlays].forEach((overlay) => overlay.setMap(null));
      vehicle?.setMap(null);
      container.replaceChildren();
    },
    setVehiclePosition: (point) => {
      const position = new sdk.LatLng(point.latitude, point.longitude);
      if (vehicle) vehicle.setPosition?.(position);
      else {
        const element = document.createElement('span');
        element.className = 'browser-vehicle-marker'; element.textContent = '↑'; element.setAttribute('aria-label', '모의 주행 위치');
        vehicle = new sdk.CustomOverlay({ map, position, content: element, xAnchor: 0.5, yAnchor: 0.5, zIndex: 10 });
      }
    },
    followPosition: (point) => { map.setLevel(4); map.setCenter(new sdk.LatLng(point.latitude, point.longitude)); },
    setRoadRoute: (route) => {
      routeGeometry = route;
      roadOverlays.splice(0).forEach((overlay) => overlay.setMap(null));
      route.lines.forEach((line) => {
        const path = line.map(
          (point) => new sdk.LatLng(point.latitude, point.longitude),
        );
        roadOverlays.push(
          new sdk.Polyline({
            map,
            path,
            strokeWeight: 9,
            strokeColor: "#fff",
            strokeOpacity: 1,
            strokeStyle: "solid",
            zIndex: 1,
          }),
          new sdk.Polyline({
            map,
            path,
            strokeWeight: 5,
            strokeColor: "#316ee8",
            strokeOpacity: 1,
            strokeStyle: "solid",
            zIndex: 2,
          }),
        );
      });
      fit();
    },
  };
}
