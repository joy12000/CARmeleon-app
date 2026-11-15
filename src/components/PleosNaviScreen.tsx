import React, { useEffect, useState } from 'react';
import {
  Bluetooth,
  Compass,
  FileText,
  Grid,
  Lock,
  MapPin,
  MessageSquare,
  Mic,
  MicOff,
  Moon,
  Music,
  Navigation,
  Pause,
  Phone,
  Play,
  Radio,
  RotateCcw,
  Route,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Snowflake,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import type { MeetingStop } from './FullVehicleCockpit';
import type { ActiveDetour, VoiceDetourCandidate, VoiceTonePreset } from '../utils/voiceFlow';
import { KotlinAgentWave } from './KotlinAgentWave';

export interface SavedPleosRoute {
  id: string;
  title: string;
  destName: string;
  summary: string;
  etaMins: string;
  distance: string;
  stopIndex: number;
  waypointCount: number;
  isTravel?: boolean;
  roadLabels?: [string, string];
  stopsSequence?: Array<{ stopIndex: number; name: string }>;
}

const DEFAULT_SAVED_ROUTES: SavedPleosRoute[] = [
  {
    id: 'saved-yangjae',
    title: '카멜레온 미팅 (오전 제휴)',
    destName: '현대자동차 양재 본사',
    summary: '양재 본사 → 남양연구소 → 집',
    etaMins: '12분',
    distance: '6.4km',
    stopIndex: 0,
    waypointCount: 2,
    roadLabels: ['양재대로', '헌릉로'],
    stopsSequence: [
      { stopIndex: 0, name: '현대자동차 양재 본사' },
      { stopIndex: 1, name: '현대자동차 남양기술연구소' },
      { stopIndex: 2, name: '집' },
    ],
  },
  {
    id: 'saved-suwon-trip',
    title: '수원여행',
    destName: '수원화성',
    summary: '수원화성 → 수원왕갈비통닭거리 → 집',
    etaMins: '38분',
    distance: '31km',
    stopIndex: 3,
    waypointCount: 2,
    isTravel: true,
    roadLabels: ['정조로', '수원천로'],
    stopsSequence: [
      { stopIndex: 3, name: '수원화성' },
      { stopIndex: 4, name: '수원왕갈비통닭거리' },
      { stopIndex: 2, name: '집' },
    ],
  },
  {
    id: 'saved-namyang',
    title: '남양 R&D 기술 검증',
    destName: '현대자동차 남양기술연구소',
    summary: '남양기술연구소 → 집',
    etaMins: '42분',
    distance: '38km',
    stopIndex: 1,
    waypointCount: 1,
    roadLabels: ['남양로', '현대연구소로'],
    stopsSequence: [
      { stopIndex: 1, name: '현대자동차 남양기술연구소' },
      { stopIndex: 2, name: '집' },
    ],
  },
  {
    id: 'saved-home',
    title: '퇴근길 + 장보기 · 충전',
    destName: '집',
    summary: '아파트 마트 → 세탁물 → 지하 충전',
    etaMins: '25분',
    distance: '16km',
    stopIndex: 2,
    waypointCount: 0,
    roadLabels: ['남부순환로', '중앙로'],
  },
];

export interface PleosNaviScreenProps {
  currentStop: MeetingStop;
  isSpeaking: boolean;
  edgeGlowMode: 'voice' | 'briefing' | 'battery' | null;
  batteryLevel: number;
  lastAnswer: string | null;
  hidePill?: boolean;
  isDrivingStarted?: boolean;
  onStartJourney?: () => void;
  onSelectSavedRoute?: (route: SavedPleosRoute) => void;
  onSelectStopIndex?: (stopIndex: number, routeTitle?: string) => void;
  // 음성 인식 · 호출어("카멜레온~") · 경유/재탑승 상태
  isListening?: boolean;
  isThinking?: boolean;
  aiStatus?: {
    checked: boolean;
    modelConfigured: boolean;
    placesConfigured: boolean;
    ttsConfigured?: boolean;
  };
  voicePreset?: VoiceTonePreset;
  onChangeVoicePreset?: (preset: VoiceTonePreset) => void;
  wakeWordActive?: boolean;
  liveTranscript?: string;
  voiceHint?: string | null;
  pendingDetour?: VoiceDetourCandidate | null;
  activeDetour?: ActiveDetour | null;
  resumedFromDetour?: {
    placeName: string;
    address: string;
    originalStopName: string;
  } | null;
  onToggleMic?: () => void;
  onToggleWakeWord?: () => void;
  onSubmitVoiceText?: (text: string) => void;
  onConfirmDetour?: () => void;
  onCancelDetour?: () => void;
  onParkAtDetour?: () => void;
  onReboardResume?: () => void;
  onTriggerVoice?: () => void;
  onTriggerBatteryAlert?: () => void;
  onTriggerBriefing?: () => void;
  onStopAudio?: () => void;
  onClearResponse?: () => void;
}

/**
 * 실제 Pleos Connect v2 에뮬레이터 3분할 화면(Driving View | Pleos Navi | CARmeleon)을
 * 실물과 동일한 시각 비율·아이오닉5 그래픽·안전벨트 힌트·경로 로딩·물결 전용(1번 레이아웃)으로 재현합니다.
 */
export const PleosNaviScreen: React.FC<PleosNaviScreenProps> = ({
  currentStop,
  isSpeaking,
  edgeGlowMode,
  batteryLevel,
  lastAnswer: _lastAnswer,
  hidePill: _hidePill = false,
  isDrivingStarted = false,
  onStartJourney,
  onSelectSavedRoute,
  onSelectStopIndex,
  isListening = false,
  isThinking = false,
  aiStatus,
  voicePreset = 'cute',
  onChangeVoicePreset,
  wakeWordActive = false,
  liveTranscript = '',
  voiceHint = null,
  pendingDetour = null,
  activeDetour = null,
  resumedFromDetour = null,
  onToggleMic,
  onToggleWakeWord,
  onSubmitVoiceText,
  onConfirmDetour,
  onCancelDetour,
  onParkAtDetour,
  onReboardResume,
  onTriggerVoice,
  onTriggerBatteryAlert,
  onTriggerBriefing,
  onStopAudio,
  onClearResponse,
}) => {
  const [carmeleonDark, setCarmeleonDark] = useState(false);
  const [naviMuted, setNaviMuted] = useState(false);
  const [localStarted, setLocalStarted] = useState(isDrivingStarted);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [leftTemp, setLeftTemp] = useState<string>('꺼짐');
  const [rightTemp, setRightTemp] = useState<string>('꺼짐');
  const [guideEnded, setGuideEnded] = useState(false);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<SavedPleosRoute>(DEFAULT_SAVED_ROUTES[0]);
  const [demoDrawerOpen, setDemoDrawerOpen] = useState(false);

  // 외부 상태(함께 출발하기 · 경유지 변경 · 경유지 출발 재개)와 동기화
  useEffect(() => {
    if ((isDrivingStarted || activeDetour !== null || resumedFromDetour !== null) && !localStarted) {
      setLocalStarted(true);
      setGuideEnded(false);
    }
  }, [isDrivingStarted, activeDetour, resumedFromDetour, localStarted]);

  // "경로 부르기"에서 경로 선택 시: Pleos 내비로 목적지·경유지 전송 -> 안내 시작 & 물결 전용 전환
  const handleSelectAndStartRoute = (route: SavedPleosRoute) => {
    setSelectedRoute(route);
    setRoutePickerOpen(false);
    setGuideEnded(false);
    setRoutingLoading(true);
    setLocalStarted(true);
    if (onSelectSavedRoute) {
      onSelectSavedRoute(route);
    } else {
      onStartJourney?.();
    }
    setTimeout(() => {
      setRoutingLoading(false);
    }, 650);
  };

  // 기본 출발(또는 기어 클릭) 시 현재 선택된 경로로 안내 시작
  const handleStartInPleos = () => {
    handleSelectAndStartRoute(selectedRoute);
  };

  // 경유지 도착(PARKED_AT_DETOUR) 또는 안내 시작 전에는 P단 0 km/h
  const isDrivingGear =
    localStarted && !guideEnded && activeDetour?.phase !== 'PARKED_AT_DETOUR';

  const rangeKm = Math.round((batteryLevel / 100) * 500);
  const arrivalBattery = Math.max(12, batteryLevel - 8);
  const isTravelStop =
    currentStop.category.startsWith('여행') || Boolean(selectedRoute.isTravel);
  const routeSequence = selectedRoute.stopsSequence || [];
  const currentSeqIdx = routeSequence.findIndex(
    (s) => s.name === currentStop.name
  );
  const nextRouteStop =
    currentSeqIdx >= 0 && currentSeqIdx < routeSequence.length - 1
      ? routeSequence[currentSeqIdx + 1]
      : null;
  const roadLabelTop = selectedRoute.roadLabels?.[0] || '양재대로';
  const roadLabelBottom = selectedRoute.roadLabels?.[1] || '헌릉로';
  const activeStopTitle = activeDetour
    ? activeDetour.candidate.placeName
    : currentStop.name;
  const activeTbtRoad = activeDetour
    ? activeDetour.candidate.address
    : resumedFromDetour
    ? `${resumedFromDetour.placeName} 출발`
    : currentStop.address.split(' ').slice(-2).join(' ') || currentStop.name;
  const activeEtaTime = activeDetour ? '잠시 후' : currentStop.time;
  const activeEtaMins = activeDetour
    ? `${activeDetour.candidate.extraMinutes}분`
    : selectedRoute.etaMins;
  const activeEtaDist = activeDetour
    ? activeDetour.candidate.distanceText.replace(' 전방', '')
    : selectedRoute.distance;

  const carPoint =
    activeDetour?.phase === 'PARKED_AT_DETOUR'
      ? { x: 156, y: 184, angle: 0, label: `정차 · ${activeDetour.candidate.placeName}` }
      : activeDetour?.phase === 'TO_DETOUR'
      ? { x: 156, y: 268, angle: 0, label: '이동 중' }
      : resumedFromDetour
      ? { x: 156, y: 184, angle: 90, label: null as string | null }
      : { x: 278, y: 355, angle: 0, label: null as string | null };

  const statusPillText = isListening
    ? '듣는 중'
    : routingLoading
    ? '경로 연결 중'
    : pendingDetour
    ? '경로 확인 중'
    : activeDetour?.phase === 'PARKED_AT_DETOUR'
    ? '도착 · 정차 중'
    : activeDetour
    ? '경유지 안내 중'
    : resumedFromDetour
    ? '경유 후 원래 목적지 재안내'
    : edgeGlowMode === 'battery'
    ? '배터리·충전 안내'
    : edgeGlowMode === 'briefing'
    ? '500m 안건 브리핑'
    : isSpeaking
    ? '말하는 중'
    : wakeWordActive
    ? '호출 대기'
    : localStarted
    ? '동행 중'
    : '출발 대기';

  const cycleTemp = (current: string) => {
    if (current === '꺼짐') return '22.0°';
    if (current === '22.0°') return '23.5°';
    return '꺼짐';
  };

  const handleGearToggle = () => {
    if (activeDetour?.phase === 'TO_DETOUR' && onParkAtDetour) {
      onParkAtDetour();
      return;
    }
    if (activeDetour?.phase === 'PARKED_AT_DETOUR' && onReboardResume) {
      onReboardResume();
      return;
    }
    if (!localStarted || guideEnded) {
      handleStartInPleos();
    } else {
      setGuideEnded(true);
    }
  };

  const hasInteractiveCard =
    pendingDetour !== null ||
    activeDetour !== null ||
    resumedFromDetour !== null;

  return (
    <div className="relative w-full h-full min-w-0 min-h-0 bg-[#f4f5f7] text-slate-900 flex flex-col overflow-hidden select-none font-sans">
      {/* 1. 상단 Pleos 순정 화이트 상태 바 (에뮬레이터 실물과 동일) */}
      <div className="h-7 px-3.5 bg-white border-b border-slate-200/80 flex items-center justify-between text-[11px] text-slate-700 shrink-0 z-10 min-w-0">
        <div className="flex items-center gap-4 shrink-0">
          <Lock size={13} className="text-slate-700" />
          <Search size={13} className="text-slate-700" />
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium text-slate-700 shrink-0">
          <span className="w-5 h-5 rounded-full border border-violet-300 bg-violet-50 text-violet-600 flex items-center justify-center text-[10px] font-bold">
            운
          </span>
          <Bluetooth size={13} className="text-slate-700" />
          <Wifi size={13} className="text-slate-700" />
          <span className="font-semibold text-slate-900 tabular-nums">12:49 오후</span>
        </div>
      </div>

      {/* 2. 메인 3분할 인포테인먼트 영역: [좌측 Driving View] | [가운데 Pleos Navi] | [⋮] | [우측 CARmeleon] */}
      <div className="flex-1 min-h-0 min-w-0 flex relative overflow-x-auto overflow-y-hidden">
        {/* 2-A. 좌측 Pleos Driving View (~26%) */}
        <div className="w-[26%] min-w-[148px] max-w-[300px] min-h-0 overflow-y-auto overflow-x-hidden bg-[#f5f6f8] border-r border-slate-200/90 flex flex-col justify-between px-2.5 sm:px-3 py-2 shrink-0">
          {/* 상단 배터리 · 속도 · P R N D */}
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-1.5 pt-0.5">
                <div className="w-7 h-3 rounded-[3px] border border-slate-400 bg-slate-200 p-[1.5px] flex items-center">
                  <div
                    className={`h-full rounded-[1.5px] transition-all ${
                      batteryLevel <= 25 ? 'bg-amber-500' : 'bg-slate-800'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(12, batteryLevel))}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-slate-800 tabular-nums">
                  {rangeKm} km
                </span>
              </div>

              <div className="text-center leading-tight">
                <span
                  className={`text-[20px] font-bold tabular-nums ${
                    isDrivingGear ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {isDrivingGear ? 62 : 0}
                </span>
                <span className="text-[10px] text-slate-400 ml-0.5">km/h</span>
              </div>

              <button
                onClick={handleGearToggle}
                className="flex items-center gap-1 text-[10px] font-bold px-1 py-0.5 rounded hover:bg-slate-200/70 transition-colors"
                title="기어 P / D 전환 (재탑승 테스트)"
              >
                {(['P', 'R', 'N', 'D'] as const).map((g) => {
                  const active = isDrivingGear ? g === 'D' : g === 'P';
                  return (
                    <span
                      key={g}
                      className={
                        active
                          ? 'bg-slate-900 text-white px-1 py-[1px] rounded-[3px]'
                          : 'text-slate-300'
                      }
                    >
                      {g}
                    </span>
                  );
                })}
              </button>
            </div>

            {/* 안전벨트 안내 (정차 P 상태일 때 에뮬레이터와 동일하게 표시) */}
            <div className="mt-2 h-11 flex flex-col items-center justify-center">
              {!isDrivingGear ? (
                <div className="flex flex-col items-center gap-0.5 animate-fade-in">
                  <div className="flex items-center gap-1 text-blue-600">
                    <span className="w-5 h-2 rounded-xs bg-slate-300 border border-slate-400 inline-block" />
                    <span className="text-[11px] font-black">→</span>
                    <span className="w-4 h-3 rounded-xs bg-blue-500 border border-blue-600 inline-block" />
                  </div>
                  <span className="text-[10px] font-medium text-slate-500">
                    {activeDetour?.phase === 'PARKED_AT_DETOUR'
                      ? '정차 중 · 클릭하여 재탑승(D)'
                      : '안전 벨트를 매세요.'}
                  </span>
                </div>
              ) : (
                <div className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>주행 D · 전방 ADAS 활성</span>
                </div>
              )}
            </div>
          </div>

          {/* 아이오닉 5 3/4 각도 차량 그래픽 */}
          <div className="relative flex-1 min-h-[76px] flex items-center justify-center my-0.5">
            <svg
              viewBox="0 0 240 165"
              className="w-full max-w-[205px] max-h-[168px] h-auto"
              aria-label="Pleos IONIQ 5 차량 그래픽"
            >
              {/* 바닥 그림자 */}
              <ellipse cx="122" cy="138" rx="86" ry="18" fill="#cbd5e1" opacity="0.65" />
              {/* 차체 하단 범퍼/스커트 */}
              <path
                d="M 42 108 L 54 128 C 82 136, 140 135, 198 118 L 208 98 L 198 86 L 154 58 L 96 56 L 52 78 Z"
                fill="url(#ioniqBody)"
                stroke="#94a3b8"
                strokeWidth="1.2"
              />
              {/* 후드 & 측면 음영 */}
              <path
                d="M 44 92 L 96 86 L 116 112 L 50 116 Z"
                fill="#f8fafc"
                opacity="0.9"
              />
              {/* 검정 파노라마 루프 & 유리창 */}
              <path
                d="M 88 76 L 118 58 L 166 60 L 182 80 L 128 86 Z"
                fill="#1e293b"
              />
              <path
                d="M 86 78 L 116 61 L 126 83 Z"
                fill="#334155"
              />
              {/* 측면 캐릭터 라인 */}
              <path
                d="M 118 104 L 194 94"
                stroke="#cbd5e1"
                strokeWidth="2"
                strokeLinecap="round"
              />
              {/* 앞 픽셀 헤드램프 */}
              <rect x="46" y="102" width="16" height="5" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.7" />
              <rect x="86" y="105" width="18" height="5" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.7" />
              {/* 앞/뒤 알로이 휠 */}
              <ellipse cx="116" cy="122" rx="14" ry="16" fill="#1e293b" />
              <ellipse cx="116" cy="122" rx="8" ry="10" fill="#cbd5e1" />
              <ellipse cx="186" cy="108" rx="11" ry="13" fill="#1e293b" />
              <ellipse cx="186" cy="108" rx="6" ry="8" fill="#cbd5e1" />
              <defs>
                <linearGradient id="ioniqBody" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="55%" stopColor="#e2e8f0" />
                  <stop offset="100%" stopColor="#cbd5e1" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* 차량 하단 4개 제어 아이콘 + 미디어 위젯 */}
          <div className="space-y-1.5 shrink-0">
            <div className="grid grid-cols-4 gap-1 text-slate-700">
              {['프렁크', '트렁크', '충전구⚡', '창문↓'].map((label) => (
                <button
                  key={label}
                  className="h-7 rounded-lg hover:bg-white/90 border border-transparent hover:border-slate-200 flex items-center justify-center text-[9px] font-semibold text-slate-600 transition-colors whitespace-nowrap"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-slate-200/80 px-2 py-1.5 flex items-center justify-between gap-1.5 shadow-2xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                  <Music size={12} className="text-slate-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-slate-700 truncate">
                    {isAudioPlaying ? 'Carmeleon Audio' : '재생 중인 항목 없음'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-slate-600 shrink-0">
                <SkipBack size={11} className="text-slate-400" />
                <button
                  onClick={() => setIsAudioPlaying((p) => !p)}
                  className="w-5 h-5 rounded-full hover:bg-slate-100 flex items-center justify-center"
                  title="재생/일시정지"
                >
                  {isAudioPlaying ? <Pause size={11} /> : <Play size={11} />}
                </button>
                <SkipForward size={11} className="text-slate-400" />
              </div>
            </div>
          </div>
        </div>

        {/* 2-B. 가운데 Pleos 순정 내비게이션 (~41%) */}
        <div className="flex-1 min-w-[180px] min-h-0 relative bg-[#edf1f7] overflow-hidden flex flex-col">
          {/* 밝은 Pleos 벡터 지도 캔버스 */}
          <svg
            viewBox="0 0 560 440"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <rect width="560" height="440" fill="#eef2f7" />
            <path d="M 0 36 Q 160 72, 340 28 T 560 54 L 560 0 L 0 0 Z" fill="#cbe2f9" />
            <rect x="42" y="128" width="92" height="58" rx="10" fill="#dcfce7" opacity="0.65" />
            <rect x="372" y="210" width="110" height="82" rx="12" fill="#dcfce7" opacity="0.6" />
            <rect x="172" y="92" width="66" height="44" rx="6" fill="#e2e8f0" />
            <rect x="268" y="96" width="76" height="46" rx="6" fill="#e2e8f0" />
            <rect x="176" y="176" width="72" height="54" rx="6" fill="#e2e8f0" />
            <rect x="272" y="294" width="84" height="50" rx="6" fill="#e2e8f0" />
            <path
              d="M 0 154 L 560 154 M 0 268 L 560 268 M 156 0 L 156 440 M 356 0 L 356 440"
              stroke="#ffffff"
              strokeWidth="12"
            />
            <path
              d="M 48 440 L 156 268 L 356 154 L 510 40"
              stroke="#cbd5e1"
              strokeWidth="8"
              fill="none"
            />

            {/* 1) 일반 안내 / 경유지 출발 재안내 경로선 */}
            {localStarted && !routingLoading && !guideEnded && (
              <>
                {resumedFromDetour && !activeDetour && !pendingDetour ? (
                  <>
                    {/* 잠깐 들렸던 경유지까지의 지난 궤적(회색 점선) */}
                    <path
                      d="M 278 395 L 278 268 L 156 268 L 156 184"
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="6 8"
                      opacity="0.7"
                    />
                    {/* 경유지(156, 184)부터 원래 목적지(415, 112)까지 새로 안내하는 파란 경로선 */}
                    <path
                      d="M 156 184 L 156 154 L 356 154 L 415 112"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M 156 184 L 156 154 L 356 154 L 415 112"
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                ) : (
                  <>
                    <path
                      d={
                        activeDetour
                          ? 'M 156 184 L 156 154 L 356 154 L 415 112'
                          : 'M 278 395 L 278 268 L 356 268 L 356 154 L 415 112'
                      }
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={activeDetour ? 0.65 : 1}
                    />
                    <path
                      d={
                        activeDetour
                          ? 'M 156 184 L 156 154 L 356 154 L 415 112'
                          : 'M 278 395 L 278 268 L 356 268 L 356 154 L 415 112'
                      }
                      fill="none"
                      stroke={activeDetour ? '#64748b' : '#2563eb'}
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={activeDetour ? '8 8' : undefined}
                    />
                  </>
                )}
              </>
            )}

            {/* 2) 경유지 탐색 / 경유지 안내 중 경로선 */}
            {(pendingDetour || activeDetour) && !guideEnded && (
              <path
                d="M 278 395 L 278 268 L 156 268 L 156 184"
                fill="none"
                stroke={activeDetour ? '#059669' : '#f59e0b'}
                strokeWidth="9"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={pendingDetour && !activeDetour ? '9 8' : undefined}
              />
            )}

            <text x="178" y="148" fill="#64748b" fontSize="11" fontWeight="600">
              {roadLabelTop}
            </text>
            <text x="366" y="258" fill="#64748b" fontSize="11" fontWeight="600">
              {roadLabelBottom}
            </text>

            {/* 3) 원래 목적지 핀 (SVG 좌표 415, 112 — 라벨은 왼쪽으로 살짝 당겨 화면 잘림 방지) */}
            {((localStarted && !routingLoading) || pendingDetour || activeDetour || resumedFromDetour) &&
              !guideEnded && (
                <g transform="translate(415, 112)" opacity={activeDetour ? 0.72 : 1}>
                  <g transform="translate(-26, -24)">
                    <rect
                      x="-64"
                      y="-13"
                      width="128"
                      height="20"
                      rx="10"
                      fill="#0f172a"
                      fillOpacity="0.9"
                    />
                    <text
                      x="0"
                      y="0.5"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9.5"
                      fontWeight="700"
                    >
                      {activeDetour ? `대기 · ${currentStop.name}` : currentStop.name}
                    </text>
                  </g>
                  <circle r="11" fill="#f43f5e" stroke="#ffffff" strokeWidth="2.5" />
                  <circle r="3.5" fill="#ffffff" />
                </g>
              )}

            {/* 4) 잠깐 들린 경유지 핀 (SVG 좌표 156, 184 — 라벨은 오른쪽으로 살짝 당겨 잘림 방지) */}
            {(pendingDetour || activeDetour || resumedFromDetour) && !guideEnded && (
              <g transform="translate(156, 184)">
                <g transform="translate(36, -25)">
                  <rect
                    x="-68"
                    y="-13"
                    width="136"
                    height="20"
                    rx="10"
                    fill={
                      activeDetour
                        ? '#059669'
                        : resumedFromDetour
                        ? '#2563eb'
                        : '#f59e0b'
                    }
                  />
                  <text
                    x="0"
                    y="0.5"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9.5"
                    fontWeight="700"
                  >
                    {resumedFromDetour && !activeDetour
                      ? `출발 · ${resumedFromDetour.placeName}`
                      : (activeDetour?.candidate || pendingDetour)?.placeName}
                  </text>
                </g>
                <circle
                  r="10"
                  fill={
                    activeDetour
                      ? '#059669'
                      : resumedFromDetour
                      ? '#2563eb'
                      : '#f59e0b'
                  }
                  stroke="#ffffff"
                  strokeWidth="2.5"
                />
                <circle r="3" fill="#ffffff" />
              </g>
            )}

            {/* 5) 내 차 현재 위치 커서 (경유 중 이동 -> 들린 장소 정차 -> 그 위치에서 원래 목적지로 재출발) */}
            <g
              style={{
                transform: `translate(${carPoint.x}px, ${carPoint.y}px)`,
                transition: 'transform 0.9s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <circle r="18" fill="#3b82f6" fillOpacity="0.22" />
              <g transform={`rotate(${carPoint.angle})`}>
                <circle r="11" fill="#2563eb" stroke="#ffffff" strokeWidth="2.5" />
                <polygon points="0,-6 4.5,5 0,2.5 -4.5,5" fill="#ffffff" />
              </g>
              {carPoint.label && (
                <g transform="translate(36, 26)">
                  <rect
                    x="-70"
                    y="-10"
                    width="140"
                    height="19"
                    rx="9.5"
                    fill="#1d4ed8"
                    stroke="#ffffff"
                    strokeWidth="1.2"
                  />
                  <text
                    x="0"
                    y="2.5"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9"
                    fontWeight="700"
                  >
                    {carPoint.label}
                  </text>
                </g>
              )}
            </g>
          </svg>

          {/* 상단 카드 영역 */}
          <div className="relative z-10 p-3 flex items-start justify-between gap-2 min-w-0">
            {/* Case A: 경로 탐색 중 카드 (에뮬레이터 사진의 '집 / 경유지 포함 / 스피너' 재현) */}
            {routingLoading ? (
              <div className="bg-white rounded-xl shadow-lg border border-slate-200/90 w-[min(210px,calc(100%-3.5rem))] overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {currentStop.name}
                  </span>
                  <X size={13} className="text-slate-400 shrink-0" />
                </div>
                <div className="px-3 py-1.5 border-b border-slate-100 text-[10px] text-slate-500">
                  {selectedRoute.waypointCount > 0
                    ? `경유지 ${selectedRoute.waypointCount}개 포함`
                    : '직행 경로 탐색 중'}
                </div>
                <div className="h-16 flex items-center justify-center">
                  <div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
                </div>
              </div>
            ) : localStarted && !guideEnded ? (
              /* Case B: 실제 길안내 TBT 턴바이턴 */
              <div className="flex flex-col gap-1 max-w-[min(230px,calc(100%-3.5rem))] min-w-0">
                <div
                  className={`text-white rounded-2xl px-3 py-2.5 shadow-lg flex items-center gap-2.5 border border-white/10 ${
                    activeDetour ? 'bg-emerald-950/95' : 'bg-[#181b22]/95'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                    <Navigation
                      size={20}
                      className={`text-sky-300 ${activeDetour ? '-rotate-45' : 'rotate-45'}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-extrabold leading-tight tabular-nums">
                      {activeDetour ? '150m' : '80m'}
                    </div>
                    <div className="text-[11px] text-slate-300 truncate">
                      {activeDetour
                        ? `${activeDetour.candidate.placeName} 방면`
                        : `${activeTbtRoad} 방면`}
                    </div>
                  </div>
                </div>
                <div className="self-start bg-[#181b22]/85 text-slate-200 text-[10px] font-semibold px-2.5 py-1 rounded-xl shadow flex items-center gap-1.5">
                  <span className="text-sky-300">↳</span>
                  <span>
                    {activeDetour
                      ? `도착 후 여기서 ${currentStop.name} 자동 재출발`
                      : resumedFromDetour
                      ? `들린 위치(${resumedFromDetour.placeName})에서 재안내 중`
                      : '390m 다음 우회전'}
                  </span>
                </div>
              </div>
            ) : (
              /* Case C: 안내 시작 전 대기 배지 */
              <div className="bg-white/95 backdrop-blur-md rounded-xl px-3 py-2 shadow-sm border border-slate-200/90 text-[11px] font-semibold text-slate-700">
                Pleos 내비 · 목적지 수신 대기 중
              </div>
            )}

            {/* 우상단 2D 나침반 (실물 Pleos 내비와 동일하게 2D 나침반만 배치) */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <button
                onClick={handleStartInPleos}
                className="px-2.5 py-1.5 rounded-xl bg-white/95 hover:bg-white text-slate-700 border border-slate-200/90 shadow-sm text-[11px] font-bold flex items-center gap-1"
                title="2D 지도 방향"
              >
                <span>2D</span>
                <Compass size={12} className="text-blue-600" />
              </button>
            </div>
          </div>

          {/* 하단 화이트 경로 요약 카드 */}
          <div className="mt-auto relative z-10 p-3 flex items-end justify-between gap-2">
            {localStarted && !routingLoading && !guideEnded ? (
              <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-lg p-2.5 w-[235px] max-w-[78%]">
                <div className="flex items-baseline justify-between gap-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {activeEtaTime}
                    </span>
                    <span
                      className={`text-[11px] font-bold ${
                        activeDetour ? 'text-emerald-600' : 'text-blue-600'
                      }`}
                    >
                      {activeEtaMins}
                    </span>
                    <span className="text-[10px] text-slate-400">{activeEtaDist}</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 tabular-nums">
                    도착 {arrivalBattery}%
                  </span>
                </div>
                <div className="text-[11px] font-bold text-slate-800 truncate mt-0.5">
                  {activeStopTitle}
                </div>
                {activeDetour && (
                  <div className="text-[10px] text-emerald-700 font-semibold truncate">
                    다음 목적지: {activeDetour.originalStopName}
                  </div>
                )}
                {!activeDetour && resumedFromDetour && (
                  <div className="text-[10px] text-blue-700 font-semibold truncate">
                    출발: {resumedFromDetour.placeName} → {resumedFromDetour.originalStopName}
                  </div>
                )}
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden flex my-2">
                  <div className="w-[45%] bg-emerald-500" />
                  <div className="w-[30%] bg-amber-400" />
                  <div className="w-[25%] bg-emerald-500" />
                </div>
                {nextRouteStop && !activeDetour && !resumedFromDetour && (
                  <button
                    type="button"
                    onClick={() =>
                      onSelectStopIndex?.(nextRouteStop.stopIndex, selectedRoute.title)
                    }
                    className="w-full mb-1.5 px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-between transition-colors"
                    title="다음 코스로 바로 이동 시뮬레이션"
                  >
                    <span className="truncate">다음: {nextRouteStop.name}</span>
                    <span className="shrink-0 ml-1">이동 →</span>
                  </button>
                )}
                <div className="flex items-center justify-between gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                    <Search size={10} />
                    {activeDetour?.phase === 'PARKED_AT_DETOUR'
                      ? '경유지 정차 중'
                      : activeDetour
                      ? '경유지 안내 중'
                      : resumedFromDetour
                      ? '원래 목적지 재안내 중'
                      : '경로 안내 중'}
                  </span>
                  <button
                    onClick={() => setGuideEnded(true)}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold transition-colors"
                  >
                    안내 종료
                  </button>
                </div>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setNaviMuted((m) => !m)}
                className="w-8 h-8 rounded-full bg-white/95 hover:bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-700"
                title={naviMuted ? '내비 음성 켜기' : '내비 음성 음소거'}
              >
                {naviMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <div className="w-8 h-8 rounded-full bg-white/95 border border-slate-200 shadow-sm flex items-center justify-center text-slate-600">
                <Settings size={14} />
              </div>
            </div>
          </div>
        </div>

        {/* 2-C. Pleos 창 분할 핸들 (⋮) */}
        <div
          className="w-3 bg-[#f0f2f5] border-x border-slate-200/90 flex items-center justify-center shrink-0"
          title="Pleos Dual View 창 비율 핸들"
        >
          <div className="flex flex-col gap-1">
            <span className="w-1 h-1 rounded-full bg-slate-400" />
            <span className="w-1 h-1 rounded-full bg-slate-400" />
            <span className="w-1 h-1 rounded-full bg-slate-400" />
          </div>
        </div>

        {/* 2-D. 우측 CARmeleon 앱 (실제 Kotlin/Android 차량용 앱 CarmeleonApp + AgentWave 1:1 구현) */}
        <div
          className={`w-[33%] min-w-[190px] max-w-[380px] min-h-0 flex flex-col justify-between shrink-0 transition-colors relative overflow-hidden ${
            carmeleonDark ? 'bg-[#27282C] text-[#F2F3F5]' : 'bg-[#F5F5F5] text-[#191C20]'
          }`}
        >
          {/* 상단 AppBar (CarmeleonTheme surface #FFFFFF / #202124) */}
          <div
            className={`h-[52px] px-4 flex items-center justify-between gap-2 shrink-0 ${
              carmeleonDark ? 'bg-[#202124]' : 'bg-white'
            }`}
          >
            <span className="text-[16px] font-semibold tracking-tight shrink-0">
              carmeleon
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {onToggleWakeWord && (
                <button
                  onClick={onToggleWakeWord}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-1 border transition-colors ${
                    wakeWordActive
                      ? 'bg-[#285FD4]/15 text-[#285FD4] border-[#285FD4]/40'
                      : carmeleonDark
                      ? 'bg-[#35373D] text-[#B0B3BB] border-[#3C3F45]'
                      : 'bg-[#F0F1F3] text-[#646970] border-[#E4E5E7] hover:text-[#191C20]'
                  }`}
                  title='마이크를 누르지 않아도 "카멜레온~"으로 호출할 수 있습니다'
                >
                  <Radio
                    size={10}
                    className={wakeWordActive ? 'animate-pulse text-[#285FD4]' : ''}
                  />
                  <span>{wakeWordActive ? '카멜레온~ 대기' : '호출 꺼짐'}</span>
                </button>
              )}
              <button
                onClick={() => setCarmeleonDark((d) => !d)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  carmeleonDark
                    ? 'hover:bg-[#35373D] text-[#F2F3F5]'
                    : 'hover:bg-[#F0F1F3] text-[#191C20]'
                }`}
                title={carmeleonDark ? '주간 화면' : '야간 화면'}
              >
                {carmeleonDark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>

          {/* 중앙 CompanionPanel: 웨이브는 항상 정중앙(50%) 고정, 알림/카드는 하단 영역에만 표시 */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* 정중앙 고정 웨이브 레이어 */}
            <div
              data-testid="carmeleon-wave-anchor"
              className="absolute inset-0 flex items-center justify-center px-3.5 sm:px-5 pointer-events-none"
            >
              <KotlinAgentWave
                phase={
                  isListening
                    ? 'LISTENING'
                    : isSpeaking
                    ? 'SPEAKING'
                    : isThinking || pendingDetour || routePickerOpen
                    ? 'WAITING'
                    : 'IDLE'
                }
                dark={carmeleonDark}
                className="shrink-0"
              />
            </div>

            {/* 하단 카드·상태 오버레이 레이어 (어떤 박스가 떠도 웨이브를 밀어올리지 않음) */}
            <div className="absolute inset-x-0 bottom-0 z-10 max-h-[42%] overflow-y-auto overflow-x-hidden px-3.5 sm:px-5 pb-3 pt-1 flex flex-col items-center gap-2">
              {isThinking && !isListening && (
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#285FD4]">
                  <span className="w-2 h-2 rounded-full bg-[#285FD4] animate-ping" />
                  <span>자료·장소 확인 중...</span>
                </div>
              )}

              {/* 출발 전 상태: 실제 Kotlin CarmeleonApp과 동일한 '경로 부르기' 버튼 */}
              {(!localStarted || guideEnded) &&
                !routePickerOpen &&
                !hasInteractiveCard && (
                  <div className="w-full space-y-2 animate-fade-in">
                    <div
                      className={`text-[13px] text-center truncate ${
                        carmeleonDark ? 'text-[#B0B3BB]' : 'text-[#646970]'
                      }`}
                    >
                      {selectedRoute.title} · {selectedRoute.destName}
                    </div>
                    <button
                      onClick={() => setRoutePickerOpen(true)}
                      className="w-full min-h-[48px] px-4 rounded-lg bg-[#285FD4] hover:bg-[#2252BA] text-white text-[14px] font-medium flex items-center justify-center gap-2 transition-colors shadow-xs"
                    >
                      <Route size={18} />
                      <span>경로 부르기</span>
                    </button>
                  </div>
                )}

              {/* '경로 부르기' 또는 '경로 재선택' 시 설정된 경로 목록 카드 표시 -> 탭하면 즉시 Pleos 내비 전송! */}
              {routePickerOpen && (
                <div
                  className={`w-full rounded-xl p-3 border shadow-lg space-y-2 animate-fade-in ${
                    carmeleonDark
                      ? 'bg-[#202124] border-[#3C3F45] text-[#F2F3F5]'
                      : 'bg-white border-[#E4E5E7] text-[#191C20]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold">경로 부르기</span>
                    <button
                      onClick={() => setRoutePickerOpen(false)}
                      className={`text-[12px] font-medium ${
                        carmeleonDark ? 'text-[#B0B3BB] hover:text-white' : 'text-[#646970] hover:text-[#191C20]'
                      }`}
                    >
                      닫기
                    </button>
                  </div>
                  {DEFAULT_SAVED_ROUTES.map((route) => {
                    const isCurrent = selectedRoute.id === route.id && localStarted && !guideEnded;
                    return (
                      <button
                        key={route.id}
                        onClick={() => handleSelectAndStartRoute(route)}
                        className={`w-full text-left px-3 py-2 rounded-[10px] border transition-colors ${
                          isCurrent
                            ? 'bg-[#285FD4]/12 border-[#285FD4]/45'
                            : carmeleonDark
                            ? 'bg-[#27282C] hover:bg-[#35373D] border-[#3C3F45]'
                            : 'bg-[#F5F5F5] hover:bg-[#ECEEF2] border-[#E4E5E7]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[13px] font-medium truncate">
                              {route.title}
                            </span>
                            {route.isTravel && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 text-[9.5px] font-bold shrink-0">
                                여행 예시
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-medium text-[#285FD4] shrink-0">
                            {isCurrent ? '다시 시작' : '내비 시작'}
                          </span>
                        </div>
                        <div
                          className={`text-[11px] truncate mt-0.5 ${
                            carmeleonDark ? 'text-[#B0B3BB]' : 'text-[#646970]'
                          }`}
                        >
                          {route.summary} ({route.etaMins})
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 1) 마이크 듣는 중 카드 */}
              {isListening && (
                <div
                  className={`w-full rounded-xl px-2.5 py-2 text-[11px] border shadow-xs ${
                    carmeleonDark
                      ? 'bg-[#202124]/95 border-rose-400/40 text-slate-100'
                      : 'bg-white/95 border-rose-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold text-rose-600 mb-1">
                    <span className="flex items-center gap-1">
                      <Mic size={11} className="animate-pulse" />
                      말씀하세요 (음성 인식 중)
                    </span>
                    {onToggleMic && (
                      <button
                        onClick={onToggleMic}
                        className="text-[9px] text-slate-400 hover:text-slate-600"
                      >
                        닫기
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] font-medium min-h-[16px]">
                    {liveTranscript ? `"${liveTranscript}"` : '말씀해 주세요...'}
                  </p>
                </div>
              )}

              {/* 2) 경유지 길안내 변경 확인 카드 */}
              {pendingDetour && (
                <div
                  className={`w-full rounded-xl p-2.5 text-[11px] border shadow-sm ${
                    carmeleonDark
                      ? 'bg-slate-800/95 border-blue-400/40 text-white'
                      : 'bg-white/95 border-blue-200 text-slate-800'
                  }`}
                >
                  <div className="text-[10px] font-bold text-blue-600 mb-0.5">
                    주변 장소 탐색 완료 · {pendingDetour.distanceText} (+{pendingDetour.extraMinutes}분)
                  </div>
                  <div className="font-bold text-xs truncate">{pendingDetour.placeName}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">
                    거기로 길안내를 해드릴까요? (&ldquo;네&rdquo;라고 말하거나 선택)
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={onCancelDetour}
                      className="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold"
                    >
                      아니요
                    </button>
                    <button
                      onClick={onConfirmDetour}
                      className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold shadow-xs"
                    >
                      네, 길안내 변경
                    </button>
                  </div>
                </div>
              )}

              {/* 3) 경유 중 · 하차/재탑승 복귀 카드 */}
              {activeDetour && !pendingDetour && (
                <div
                  className={`w-full rounded-xl p-2.5 text-[11px] border shadow-sm ${
                    activeDetour.phase === 'PARKED_AT_DETOUR'
                      ? 'bg-blue-50/95 border-blue-300 text-slate-900'
                      : carmeleonDark
                      ? 'bg-[#202124]/95 border-emerald-400/40 text-slate-100'
                      : 'bg-emerald-50/95 border-emerald-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold mb-0.5">
                    <span
                      className={
                        activeDetour.phase === 'PARKED_AT_DETOUR'
                          ? 'text-blue-700'
                          : 'text-emerald-700'
                      }
                    >
                      {activeDetour.phase === 'PARKED_AT_DETOUR'
                        ? '목적지 정차 중 · 재탑승 대기'
                        : `${activeDetour.candidate.placeName} 안내 중`}
                    </span>
                  </div>
                  <div className="text-[10px] opacity-85 leading-snug">
                    {activeDetour.phase === 'PARKED_AT_DETOUR'
                      ? `들린 장소('${activeDetour.candidate.placeName}') 위치에서 잠시 뒤 '${activeDetour.originalStopName}' 안내를 자동으로 이어갑니다.`
                      : `도착·정차 후 그 위치에서 원래 목적지('${activeDetour.originalStopName}')로 자동 재안내합니다.`}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    {activeDetour.phase === 'TO_DETOUR' && onParkAtDetour && (
                      <button
                        onClick={onParkAtDetour}
                        className="flex-1 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold"
                      >
                        도착 · 하차
                      </button>
                    )}
                    {onReboardResume && (
                      <button
                        onClick={onReboardResume}
                        className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold shadow-xs"
                      >
                        재탑승 · 이어서 가기
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* 상시 호출 대기 중 실시간 마이크 입력 및 안내 피드백 */}
              {!isListening && voiceHint && (
                <div
                  className={`w-full rounded-xl px-2.5 py-1.5 text-[10.5px] font-medium text-center leading-snug border ${
                    carmeleonDark
                      ? 'bg-[#202124]/95 border-white/15 text-slate-200'
                      : 'bg-slate-50/95 border-slate-200 text-slate-700'
                  }`}
                >
                  {voiceHint}
                </div>
              )}
              {!isListening && !voiceHint && wakeWordActive && liveTranscript && (
                <div className="w-full text-center text-[10px] text-emerald-600 font-semibold truncate px-2">
                  인식됨: &ldquo;{liveTranscript}&rdquo;
                </div>
              )}
            </div>
          </div>

          {/* 하단 DualDrivingDock (실제 Kotlin 앱 #101114 / #303239 스타일과 동일, 마이크 + 경로 재선택 2버튼) */}
          <div className="h-[66px] bg-[#101114] px-2 flex items-center justify-center gap-1.5 shrink-0">
            <button
              onClick={onToggleMic || onTriggerVoice}
              className={`h-[46px] px-3 rounded-md flex items-center justify-center gap-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                isListening
                  ? 'bg-[#303239] text-white'
                  : 'text-[#BFC2C9] hover:bg-[#303239]/60 hover:text-white'
              }`}
              title="마이크를 눌러 말씀하세요"
            >
              {isListening ? <MicOff size={17} /> : <Mic size={17} />}
              <span>{isListening ? '듣는 중' : '마이크'}</span>
            </button>
            <button
              onClick={() => setRoutePickerOpen((v) => !v)}
              className={`h-[46px] px-3 rounded-md flex items-center justify-center gap-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                routePickerOpen
                  ? 'bg-[#303239] text-white'
                  : 'text-[#BFC2C9] hover:bg-[#303239]/60 hover:text-white'
              }`}
              title="저장된 다른 경로를 불러와 내비로 전송합니다"
            >
              <Route size={17} />
              <span>경로 재선택</span>
            </button>
          </div>
        </div>
      </div>

      {/* 숨겨진 시연용 간이 리모컨 (하단 Pleos 도크의 '>_' 아이콘으로 열기/닫기) */}
      {demoDrawerOpen && (
        <div className="absolute right-3 bottom-12 z-40 w-[min(320px,calc(100%-1.5rem))] rounded-2xl bg-[#131720]/95 backdrop-blur-md text-slate-100 border border-white/15 shadow-2xl p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/10">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="px-1.5 py-0.5 rounded bg-[#285FD4]/25 text-blue-300 font-mono text-[10px] font-bold">
                &gt;_
              </span>
              <span className="text-[11px] font-bold truncate">시연용 간이 제어</span>
            </div>
            <button
              type="button"
              onClick={() => setDemoDrawerOpen(false)}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="닫기"
            >
              <X size={13} />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[9.5px]">
            <span className={aiStatus?.ttsConfigured ? 'text-emerald-300 font-semibold' : 'text-amber-300'}>
              Gemini 음성: {aiStatus?.ttsConfigured ? '연결됨 (Leda)' : '미연결(브라우저 음성)'}
            </span>
            <span className={aiStatus?.modelConfigured ? 'text-emerald-300 font-semibold' : 'text-amber-300'}>
              OpenAI API: {aiStatus?.modelConfigured ? '연결됨' : '미연결(로컬)'}
            </span>
            <span className={aiStatus?.placesConfigured ? 'text-emerald-300 font-semibold' : 'text-amber-300'}>
              Kakao 장소: {aiStatus?.placesConfigured ? '연결됨' : '시연 데이터'}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-slate-400">
              {isTravelStop ? '여행 코스 브리핑 · Q&A' : '미팅 자료 요약 · Q&A'}
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setRoutePickerOpen(false);
                  onTriggerBriefing?.();
                  setDemoDrawerOpen(false);
                }}
                className="w-full px-2.5 py-2 rounded-xl bg-[#285FD4] hover:bg-[#2252BA] text-white text-[11px] font-semibold flex items-center gap-2 text-left transition-colors"
              >
                <FileText size={13} className="shrink-0" />
                <span className="truncate">
                  {isTravelStop
                    ? '가는 길 재미있는 스토리 듣기'
                    : '500m 미팅 자료 요약 음성 브리핑'}
                </span>
              </button>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setRoutePickerOpen(false);
                    onSubmitVoiceText?.(
                      currentStop.id === 'stop-suwon-hwaseong'
                        ? '수원화성 주차 어디에 하는 게 좋아?'
                        : currentStop.id === 'stop-suwon-chicken'
                        ? '왕갈비통닭 맛집이랑 웨이팅 팁 알려줘'
                        : isTravelStop
                        ? '오늘 여행 남은 코스 알려줘'
                        : '수익 배분 비율이 몇 대 몇이었지?'
                    );
                    setDemoDrawerOpen(false);
                  }}
                  className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-[10.5px] font-medium flex items-center gap-1.5 text-left transition-colors"
                >
                  <Sparkles size={11} className="text-indigo-300 shrink-0" />
                  <span className="truncate">
                    {currentStop.id === 'stop-suwon-hwaseong'
                      ? 'Q&A: 주차 어디 해?'
                      : currentStop.id === 'stop-suwon-chicken'
                      ? 'Q&A: 맛집 · 웨이팅'
                      : 'Q&A: 수익 배분'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoutePickerOpen(false);
                    onSubmitVoiceText?.(
                      isTravelStop
                        ? '재밌는 이야기 들려줘'
                        : '자료 바탕으로 미팅 장소 설명해줘'
                    );
                    setDemoDrawerOpen(false);
                  }}
                  className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-[10.5px] font-medium flex items-center gap-1.5 text-left transition-colors"
                >
                  <MapPin size={11} className="text-emerald-300 shrink-0" />
                  <span className="truncate">
                    {isTravelStop ? '재밌는 비하인드' : '자료로 장소 설명'}
                  </span>
                </button>
              </div>
              {nextRouteStop && (
                <button
                  type="button"
                  onClick={() => {
                    setRoutePickerOpen(false);
                    onSelectStopIndex?.(nextRouteStop.stopIndex, selectedRoute.title);
                    setDemoDrawerOpen(false);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-[10.5px] font-bold flex items-center justify-between transition-colors"
                >
                  <span className="truncate">다음 코스 이동: {nextRouteStop.name}</span>
                  <span className="shrink-0">→</span>
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-slate-400">경유 · 돌발 상황</div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setRoutePickerOpen(false);
                  onSubmitVoiceText?.('가까운 주유소 찾아줘');
                  setDemoDrawerOpen(false);
                }}
                className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-[10.5px] font-medium flex items-center gap-1 transition-colors"
              >
                <Navigation size={11} className="text-sky-300 shrink-0" />
                <span className="truncate">주유소 찾기</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoutePickerOpen(false);
                  onSubmitVoiceText?.('화장실 급해!!!');
                  setDemoDrawerOpen(false);
                }}
                className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-[10.5px] font-medium flex items-center gap-1 transition-colors"
              >
                <Navigation size={11} className="text-amber-300 shrink-0" />
                <span className="truncate">화장실 경유</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoutePickerOpen(false);
                  onTriggerBatteryAlert?.();
                  setDemoDrawerOpen(false);
                }}
                className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-[10.5px] font-medium flex items-center gap-1 transition-colors"
              >
                <Zap size={11} className="text-amber-400 shrink-0" />
                <span className="truncate">배터리 제안</span>
              </button>
            </div>
            {(pendingDetour || activeDetour) && (
              <div className="flex items-center gap-1.5 pt-0.5">
                {pendingDetour && onConfirmDetour && (
                  <button
                    type="button"
                    onClick={() => {
                      onConfirmDetour();
                      setDemoDrawerOpen(false);
                    }}
                    className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold"
                  >
                    경유 수락 (&ldquo;네&rdquo;)
                  </button>
                )}
                {activeDetour?.phase === 'TO_DETOUR' && onParkAtDetour && (
                  <button
                    type="button"
                    onClick={() => {
                      onParkAtDetour();
                      setDemoDrawerOpen(false);
                    }}
                    className="flex-1 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[10.5px] font-semibold"
                  >
                    도착 · 하차
                  </button>
                )}
                {activeDetour && onReboardResume && (
                  <button
                    type="button"
                    onClick={() => {
                      onReboardResume();
                      setDemoDrawerOpen(false);
                    }}
                    className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10.5px] font-bold"
                  >
                    재탑승 · 복귀
                  </button>
                )}
              </div>
            )}
          </div>

          {onChangeVoicePreset && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-slate-400">카멜레온 목소리 톤</div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { id: 'cute', label: '귀여운 톤' },
                  { id: 'bubbly', label: '발랄 하이톤' },
                  { id: 'calm', label: '차분한 톤' },
                ] as const).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeVoicePreset(item.id)}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
                      voicePreset === item.id
                        ? 'bg-[#285FD4] text-white'
                        : 'bg-white/10 hover:bg-white/15 text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-1 border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                (onToggleMic || onTriggerVoice)?.();
                setDemoDrawerOpen(false);
              }}
              className="flex-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-[10.5px] font-medium flex items-center justify-center gap-1"
            >
              <Mic size={11} />
              <span>마이크</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onStopAudio?.();
                setDemoDrawerOpen(false);
              }}
              className="flex-1 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[10.5px] font-medium flex items-center justify-center gap-1"
            >
              <VolumeX size={11} />
              <span>음성 정지</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setRoutePickerOpen(false);
                onClearResponse?.();
                if (!onClearResponse) onStopAudio?.();
                setDemoDrawerOpen(false);
              }}
              className="flex-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 text-[10.5px] font-medium flex items-center justify-center gap-1"
            >
              <RotateCcw size={11} />
              <span>물결만 보기</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. 하단 Pleos OS 다크 시스템 도크 바 (에뮬레이터 하단 실물과 동일) */}
      <div className="h-11 px-2 sm:px-3 bg-[#0d1016] border-t border-slate-800 flex items-center justify-between gap-2 text-white shrink-0 z-10 overflow-x-auto overflow-y-hidden min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setLeftTemp((t) => cycleTemp(t))}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-200 hover:text-white px-1.5 py-1 rounded hover:bg-white/5"
            title="운전석 공조"
          >
            <span className="text-slate-400">∨</span>
            <Snowflake size={11} className="text-sky-400" />
            <span className="min-w-[28px] text-center">{leftTemp}</span>
            <span className="text-slate-400">∧</span>
          </button>
          <span className="hidden sm:inline text-[10px] text-slate-400">열선</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-slate-300 shrink-0">
            <Navigation size={13} className="rotate-90" />
          </div>
          {/* 활성 Pleos 내비 앱 */}
          <div className="relative flex flex-col items-center shrink-0">
            <div className="w-7 h-7 rounded-lg bg-slate-800 border border-white/25 flex items-center justify-center shadow-sm">
              <Navigation size={13} className="text-amber-300 fill-amber-300" />
            </div>
            <span className="w-4 h-[2px] rounded-full bg-white mt-0.5" />
          </div>
          <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-slate-300 shrink-0">
            <Phone size={13} />
          </div>
          <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-slate-300 shrink-0">
            <Grid size={13} />
          </div>
          {/* 활성 CARmeleon 앱 (레인보우 카멜레온 아이콘 스타일) */}
          <div className="relative flex flex-col items-center shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 via-emerald-400 to-violet-500 flex items-center justify-center shadow-sm">
              <MessageSquare size={13} className="text-white" />
            </div>
            <span className="w-4 h-[2px] rounded-full bg-white mt-0.5" />
          </div>
          {/* FormFactor Console (숨겨진 시연용 간이 리모컨 토글) */}
          <button
            type="button"
            onClick={() => setDemoDrawerOpen((v) => !v)}
            className={`w-7 h-7 rounded-lg border flex items-center justify-center text-[10px] font-mono shrink-0 transition-colors ${
              demoDrawerOpen
                ? 'bg-[#285FD4]/30 border-blue-400/60 text-white'
                : 'bg-white/5 border-white/15 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
            title="FormFactor Console"
            aria-label="FormFactor Console"
          >
            &gt;_
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <span className="hidden sm:inline text-[10px] text-emerald-400">내기</span>
          <button
            onClick={() => setRightTemp((t) => cycleTemp(t))}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-200 hover:text-white px-1.5 py-1 rounded hover:bg-white/5"
            title="동승석 공조"
          >
            <span className="text-slate-400">∨</span>
            <span className="min-w-[28px] text-center">{rightTemp}</span>
            <span className="text-slate-400">∧</span>
          </button>
        </div>
      </div>
    </div>
  );
};
