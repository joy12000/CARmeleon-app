import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Navigation, Compass, Layers, Plus, Minus, MapPin, Zap, Search, Volume2 } from 'lucide-react';
import { RouteStop } from '../types';

interface HyundaiRealNaviMapProps {
  currentStop: RouteStop;
  nextStop?: RouteStop;
  currentStopIndex: number;
  totalStops: number;
  onArrivalNext: () => void;
  autoAlert: string | null;
}

// 대한민국 주요 거점 실제 GPS 좌표 (위도, 경도)
const PANGYO_STATION: [number, number] = [37.3948, 127.1119];
const PANGYO_TECHNO: [number, number] = [37.4013, 127.1086];
const GANGNAM_STATION: [number, number] = [37.4981, 127.0276];
const COEX_CENTER: [number, number] = [37.5118, 127.0592];

// 실제 도로를 따르는 고정밀 주행 경로 좌표 목록
const REAL_ROUTE_COORDS: [number, number][] = [
  [37.3948, 127.1119], // 판교역
  [37.3980, 127.1115], // 판교역 북측
  [37.4013, 127.1086], // 판교 테크노밸리 사거리
  [37.4100, 127.1050], // 금토천교
  [37.4250, 127.0980], // 분당내곡간 진입로
  [37.4420, 127.0850], // 내곡터널
  [37.4650, 127.0600], // 구룡터널 사거리
  [37.4820, 127.0390], // 양재IC 방면
  [37.4981, 127.0276], // 강남역 사거리
  [37.5050, 127.0450], // 선릉역 방면
  [37.5118, 127.0592]  // 코엑스
];

export const HyundaiRealNaviMap: React.FC<HyundaiRealNaviMapProps> = ({
  currentStop,
  nextStop,
  currentStopIndex,
  totalStops,
  onArrivalNext,
  autoAlert
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const carMarkerRef = useRef<L.Marker | null>(null);

  const [currentSpeed, setCurrentSpeed] = useState(64);
  const [carStepIdx, setCarStepIdx] = useState(0);

  // 1. Leaflet 지도 초기화 (현대차 ccNC 순정 다크테마 타일 맵)
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // 이미 초기화된 지도가 있다면 안전하게 정리
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Leaflet 지도 생성 (판교 중심, 줌 레벨 14)
    const map = L.map(mapContainerRef.current, {
      center: PANGYO_STATION,
      zoom: 14,
      zoomControl: false, // 커스텀 줌 버튼 사용
      attributionControl: false // 차량용 깔끔한 전체화면을 위해 기본 카피라이트 숨김
    });

    mapInstanceRef.current = map;

    // 워터마크 및 API 키 제한 없는 고화질 주간 내비 타일 (CartoDB Voyager)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c', 'd'],
      attribution: ''
    }).addTo(map);

    // 실제 도로 주행 경로선 (네온 블루 글로우)
    // 외곽 글로우 그림자 선
    L.polyline(REAL_ROUTE_COORDS, {
      color: '#0284c7',
      weight: 12,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // 중앙 메인 형광 경로선
    L.polyline(REAL_ROUTE_COORDS, {
      color: '#00f2fe',
      weight: 7,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // 출발지 마커 핀
    const startIcon = L.divIcon({
      className: 'custom-start-marker',
      html: `
        <div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#2563eb;color:#fff;font-weight:900;font-size:12px;border:3px solid #ffffff;box-shadow:0 0 16px rgba(37,99,235,0.8);">
          출
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    L.marker(PANGYO_STATION, { icon: startIcon }).addTo(map);

    // 현재 목적지 마커 핀 (초록색 깃발 핀)
    const destCoords: [number, number] = currentStopIndex === 0 
      ? PANGYO_TECHNO 
      : (currentStopIndex === 1 ? GANGNAM_STATION : COEX_CENTER);

    const destIcon = L.divIcon({
      className: 'custom-dest-marker',
      html: `
        <div style="background:#0f172a;border:2px solid #10b981;border-radius:12px;padding:4px 8px;color:#fff;font-weight:bold;font-size:11px;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.6);display:flex;align-items:center;gap:4px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;"></span>
          <span>${currentStop.name}</span>
        </div>
      `,
      iconSize: [120, 30],
      iconAnchor: [60, 35]
    });
    L.marker(destCoords, { icon: destIcon }).addTo(map);

    // 내 차 실시간 3D 내비 화살표 마커
    const carIcon = L.divIcon({
      className: 'custom-car-arrow',
      html: `
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:40px;height:40px;">
          <div style="position:absolute;width:36px;height:36px;border-radius:50%;background:rgba(0,242,254,0.3);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#00f2fe" stroke="#ffffff" stroke-width="2" style="filter:drop-shadow(0 0 8px rgba(0,242,254,0.9));transform:rotate(45deg);">
            <polygon points="12 2 19 21 12 17 5 21 12 2" />
          </svg>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
    const carMarker = L.marker(REAL_ROUTE_COORDS[0], { icon: carIcon }).addTo(map);
    carMarkerRef.current = carMarker;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [currentStop.name, currentStopIndex]);

  // 2. 실시간 주행 애니메이션 시뮬레이션
  useEffect(() => {
    const timer = setInterval(() => {
      setCarStepIdx(prev => {
        const nextIdx = (prev + 1) % REAL_ROUTE_COORDS.length;
        if (carMarkerRef.current) {
          carMarkerRef.current.setLatLng(REAL_ROUTE_COORDS[nextIdx]);
        }
        return nextIdx;
      });
      setCurrentSpeed(Math.floor(62 + Math.sin(Date.now() / 1500) * 8));
    }, 1500);

    return () => clearInterval(timer);
  }, []);

  const handleZoomIn = () => {
    mapInstanceRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapInstanceRef.current?.zoomOut();
  };

  const handleRecenter = () => {
    if (mapInstanceRef.current && carMarkerRef.current) {
      mapInstanceRef.current.setView(carMarkerRef.current.getLatLng(), 15, { animate: true });
    }
  };

  return (
    <div className="relative w-full h-full bg-[#0d131f] rounded-3xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col justify-between select-none">
      
      {/* ===================================================================== */}
      {/* 1. 배경: 실제 대한민국 실시간 다크모드 타일 지도 엔진 (Leaflet Map) */}
      {/* ===================================================================== */}
      <div 
        ref={mapContainerRef} 
        className="absolute inset-0 z-0 w-full h-full bg-[#0d131f]"
        style={{ width: '100%', height: '100%' }}
      />

      {/* ===================================================================== */}
      {/* 2. 상단 ccNC 순정 검색창 및 TBT 턴바이턴 대형 가이던스 패널 */}
      {/* ===================================================================== */}
      <div className="relative z-10 p-4 space-y-3 pointer-events-none">
        
        {/* 상단 순정 내비 헤더 바 */}
        <div className="flex items-center justify-between gap-3 pointer-events-auto">
          {/* 순정 검색창 UI */}
          <div className="flex-1 max-w-md bg-slate-950/85 backdrop-blur-md rounded-2xl px-4 py-2.5 border border-slate-700/80 shadow-xl flex items-center gap-2.5 text-xs text-slate-300">
            <Search className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="font-bold text-white truncate">{currentStop.name} ({currentStop.address})</span>
            <span className="ml-auto text-[10px] bg-cyan-500/20 text-cyan-300 font-bold px-2 py-0.5 rounded-md shrink-0">
              ccNC 내비 탐색중
            </span>
          </div>

          {/* 우측 상단 나침반 & 속도계 */}
          <div className="flex items-center gap-2.5">
            {/* 최고속도 80 원형 표지판 */}
            <div className="w-11 h-11 rounded-full bg-white border-4 border-red-500 flex items-center justify-center text-slate-950 font-black text-sm shadow-md">
              80
            </div>

            {/* 현재 시속 게이지 */}
            <div className="px-3.5 py-1.5 rounded-2xl bg-slate-950/90 backdrop-blur-md border border-slate-700 text-center shadow-lg">
              <div className="text-xl font-black text-white leading-none">
                {currentSpeed}
              </div>
              <span className="text-[9px] font-bold text-slate-400">km/h</span>
            </div>

            {/* 줌 & 뷰 조절 버튼 */}
            <div className="flex items-center gap-1 bg-slate-950/90 backdrop-blur-md p-1 rounded-xl border border-slate-700">
              <button 
                onClick={handleZoomIn}
                className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center justify-center text-sm font-bold"
                title="확대"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button 
                onClick={handleZoomOut}
                className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center justify-center text-sm font-bold"
                title="축소"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button 
                onClick={handleRecenter}
                className="w-8 h-8 rounded-lg hover:bg-slate-800 text-cyan-400 flex items-center justify-center"
                title="내 차 위치로 이동"
              >
                <Compass className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 좌측 TBT 대형 턴바이턴 카드 */}
        <div className="bg-slate-950/90 backdrop-blur-md rounded-2xl p-4 border border-cyan-500/40 shadow-2xl flex items-center gap-4 max-w-sm pointer-events-auto">
          {/* 회전 화살표 */}
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/40 shrink-0">
            <Navigation className="w-8 h-8 rotate-45 text-white" />
          </div>

          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-black text-cyan-400">300m 앞</span>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-bold">
                우회전
              </span>
            </div>
            <h2 className="text-base font-black text-white truncate">
              {currentStop.name} 방면
            </h2>
            <p className="text-[11px] text-slate-400 font-medium truncate">
              {currentStop.address || '판교역로 방면 직진 후 진입'}
            </p>
          </div>
        </div>

      </div>

      {/* 중간 알림 배너 */}
      {autoAlert && (
        <div className="relative z-10 mx-4 p-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-cyan-600 text-slate-950 font-black text-xs flex items-center justify-between shadow-2xl animate-bounce">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span>{autoAlert}</span>
          </div>
          <span className="text-[10px] bg-slate-950/20 px-2.5 py-1 rounded-lg font-black">
            ccNC 순정 내비 동기화
          </span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. 하단 ccNC 순정 내비게이션 상태 독(Dock) 바 */}
      {/* ===================================================================== */}
      <div className="relative z-10 p-4">
        <div className="bg-slate-950/95 backdrop-blur-xl rounded-2xl p-3.5 border border-slate-800 shadow-2xl flex items-center justify-between gap-3">
          
          {/* 남은 거리 및 소요 시간 */}
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-slate-400 font-bold block text-[10px]">도착 예정</span>
              <span className="text-base font-black text-white">오후 6:45</span>
            </div>
            <div className="h-7 w-px bg-slate-800"></div>
            <div>
              <span className="text-slate-400 font-bold block text-[10px]">남은 거리</span>
              <span className="text-base font-black text-cyan-400">4.2 km</span>
            </div>
            <div className="h-7 w-px bg-slate-800"></div>
            <div>
              <span className="text-slate-400 font-bold block text-[10px]">소요 시간</span>
              <span className="text-base font-black text-emerald-400">약 8분</span>
            </div>
            <div className="h-7 w-px bg-slate-800"></div>
            <div className="hidden sm:block">
              <span className="text-slate-400 font-bold block text-[10px]">도착 시 배터리</span>
              <span className="text-xs font-black text-slate-200">81% 잔여</span>
            </div>
          </div>

          {/* 현재 장소 도착 시뮬레이션 버튼 */}
          <button
            onClick={onArrivalNext}
            className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/25 transition-all active:scale-95 shrink-0"
            title="현재 목적지에 도착했을 때 다음 목적지로 내비 경로 자동 전환"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>📍 도착 완료 시뮬레이션 ({currentStopIndex + 1}/{totalStops})</span>
          </button>
        </div>
      </div>

    </div>
  );
};
