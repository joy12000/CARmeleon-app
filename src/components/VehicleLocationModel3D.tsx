import React, { useState, useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { getVehicleInfoByModel, getVehicleColorImage } from '../data/vehicleCatalog';

interface VehicleLocationModel3DProps {
  vehicleInfo: {
    sellname: string;
    batteryPercent: number;
    remainingRangeKm: number;
    carPlateNumber?: string;
    exteriorColor?: string;
    exteriorColorCode?: string;
  };
  coords?: {
    lat: number;
    lng: number;
  };
  locationName?: string;
  buildingName?: string;
  speedKmh?: number;
}

export const VehicleLocationModel3D: React.FC<VehicleLocationModel3DProps> = ({
  vehicleInfo,
  coords = { lat: 37.3948, lng: 127.1119 },
  locationName = '경기 성남시 분당구 판교역로 166',
  buildingName = '카카오 판교아지트',
  speedKmh = 0
}) => {
  // 마우스 패럴랙스 3D 틸트 효과
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // 주소 및 건물명 파싱 로직
  // 1. buildingName 프로퍼티가 있으면 우선 사용
  // 2. locationName에 (건물명) 형식이 있으면 건물명과 주소로 분리
  // 3. 건물이름이 없을 경우 displayBuilding은 null
  const { displayBuilding, displayAddress } = useMemo(() => {
    let bName = buildingName?.trim();
    let addr = locationName?.trim() || '경기 성남시 분당구 판교역로 166';

    if (!bName) {
      const parenMatch = addr.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (parenMatch) {
        addr = parenMatch[1].trim();
        bName = parenMatch[2].trim();
      }
    }

    return {
      displayBuilding: bName || null,
      displayAddress: addr
    };
  }, [buildingName, locationName]);

  // 마우스 이동 시 부드러운 3D 패럴랙스 각도 계산
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 10, y: -y * 8 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  // 차량 차종 및 외장 컬러에 따른 공식 3D 렌더링 이미지 실시간 매칭
  const vInfo = getVehicleInfoByModel(vehicleInfo.sellname);
  const colorOption = getVehicleColorImage(vInfo, vehicleInfo.exteriorColor || vehicleInfo.exteriorColorCode);

  return (
    <div className="w-full h-full flex flex-col justify-between p-4 md:p-5 border border-slate-200/90 min-h-0 bg-white rounded-3xl relative overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
      
      {/* ========================================================================= */}
      {/* 1. 상단: 현재 차량 위치 (지도 아이콘 옆: 건물 이름, 그 아래: 주소) */}
      {/* ========================================================================= */}
      <div className="flex items-start gap-3 pb-3 border-b border-slate-100 shrink-0 min-w-0">
        <div className="mt-0.5 w-9 h-9 rounded-xl bg-blue-50 border border-blue-200/70 text-blue-600 flex items-center justify-center shrink-0 shadow-2xs">
          <MapPin className="w-4 h-4 text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
          {displayBuilding ? (
            <>
              {/* 지도 아이콘 옆: 해당 주소의 건물 이름 */}
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-base md:text-[17px] font-black text-slate-900 tracking-tight truncate">
                  {displayBuilding}
                </h3>
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse"></span>
              </div>
              {/* 그 아래: 주소 */}
              <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                {displayAddress}
              </p>
            </>
          ) : (
            /* 건물이름이 잡히지 않을 때: 그냥 주소만 표시 */
            <p className="text-base md:text-[17px] font-black text-slate-900 tracking-tight truncate mt-0.5">
              {displayAddress}
            </p>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. 중앙: 차량 3D 모델 사진 단독 뷰포트 (화이트 스튜디오 쇼룸 모드) */}
      {/* ========================================================================= */}
      <div 
        className="w-full flex-1 min-h-[220px] md:min-h-[260px] flex items-center justify-center relative my-3 rounded-2xl overflow-hidden border border-slate-200/80 bg-gradient-to-b from-slate-50/90 via-white to-slate-100/70 shadow-inner group"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* 화이트 스튜디오 프리미엄 앰비언트 스포트라이트 */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-100/35 via-slate-50/20 to-transparent pointer-events-none" />

        <div className="relative w-full max-w-[340px] h-48 flex items-center justify-center">
          {/* 차량 바닥 프리미엄 소프트 그림자 */}
          <div className="absolute w-60 h-14 rounded-[100%] bg-slate-400/25 blur-md transform translate-y-9" />
          <div className="absolute w-44 h-8 rounded-[100%] bg-slate-900/15 blur-xs transform translate-y-9" />

          {/* 3D 차량 모델링 사진 (마우스 패럴랙스 틸트 지원) */}
          <div 
            className="relative w-full h-full flex items-center justify-center transition-transform duration-300"
            style={{
              transform: `translateY(-2px) rotateY(${tilt.x * 0.8}deg) scale(1.08)`
            }}
          >
            <img
              src={colorOption.image3D}
              alt={`${vehicleInfo.sellname} - ${colorOption.name}`}
              className="w-full h-full object-contain filter drop-shadow-[0_12px_24px_rgba(0,0,0,0.18)]"
            />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. 하단: 차량 API 실시간 고전압 배터리 SoC 및 주행 가능 거리 바 */}
      {/* ========================================================================= */}
      <div className="space-y-1.5 shrink-0 pt-2 border-t border-slate-100">
        <div className="p-3.5 rounded-2xl bg-slate-50/90 border border-slate-200/80 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-extrabold text-slate-700">
              <span className="text-emerald-500">⚡</span>
              <span>고전압 배터리 (SoC)</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="font-black text-slate-900 text-sm">{vehicleInfo.batteryPercent}%</span>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-lg border border-blue-200/80 tracking-tight">
                주행 가능 {vehicleInfo.remainingRangeKm}km
              </span>
            </div>
          </div>
          {/* 배터리 게이지 바 */}
          <div className="w-full h-2.5 bg-slate-200/80 rounded-full overflow-hidden p-0.5">
            <div 
              className="h-full bg-gradient-to-r from-teal-500 via-cyan-500 to-emerald-400 rounded-full transition-all duration-700 shadow-sm"
              style={{ width: `${Math.min(100, Math.max(10, vehicleInfo.batteryPercent))}%` }}
            />
          </div>
        </div>
      </div>

    </div>
  );
};
