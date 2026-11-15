export type AppMode = 'business' | 'travel' | 'hybrid';

export interface RouteStop {
  id: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  poiId?: string;
  poiSubId?: string;
  type?: 'business' | 'travel';
  category?: string;
  time?: string;
  memo?: string;
  attachedFile?: string;
  attachedDocumentIds?: string[];
  aiBriefing?: {
    summaryPoints: string[];
    contextStory?: string;
    recommendedFoodOrMusic?: string;
  };
}

export interface SavedRoute {
  id: string;
  title: string; // 사용자가 등록한 이름
  date: string; // 날짜
  isBusiness?: boolean;
  isTravel?: boolean;
  isActiveInCar: boolean; // 현재 차량 연동 여부
  stops: RouteStop[]; // 장소 루트
  origin?: { latitude: number; longitude: number }; // 경로에 지정된 출발 위치
  totalDistanceKm?: number;
  totalDurationMin?: number;
}

export interface ShortcutPlace {
  id: string;
  keyword: string; // 단축어 이름 (예: "집", "회사", "헬스장")
  name: string; // 실제 장소명 (예: "판교 푸르지오", "강남 파이낸스")
  address: string;
  latitude?: number;
  longitude?: number;
  icon: 'home' | 'building' | 'dumbbell' | 'coffee' | 'star';
}

export interface DailyPlan {
  vin?: string;
  carPlateNumber: string;
  carModel: string;
  exteriorColor?: string; // 외장 컬러명 (예: '아틀라스 화이트', '사이버 그레이 메탈릭')
  exteriorColorCode?: string; // 외장 컬러 코드 (예: 'SAW', 'C5G', 'MZH')
  batteryOrFuelPercent: number;
  isEngineOn: boolean;
  isDoorLocked?: boolean; // 차량 문 잠금/열림 상태 (Vehicle SDK 연동)
  activeRoute: SavedRoute;
  savedRoutes: SavedRoute[];
  pastRoutes?: SavedRoute[]; // 과거 완료된 지난 주행 루트 목록
  shortcuts: ShortcutPlace[]; // 단축어 목록
}
