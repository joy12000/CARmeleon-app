import React, { useState, useEffect, useRef } from 'react';
import { 
  Navigation, 
  Mic, 
  Volume2, 
  Music, 
  MapPin, 
  Sparkles, 
  ArrowRight, 
  Compass, 
  Smartphone,
  ArrowLeft,
  Radio,
  FileText,
  VolumeX,
  Play,
  RotateCcw,
  Check,
  Disc,
  Layers,
  Search,
  FolderOpen,
  Calendar
} from 'lucide-react';
import { DailyPlan, SavedRoute, RouteStop } from '../types';
import { carmeleonApi } from '../services/api';
import { getTodayDateString, mockPastRoutes, parseRouteDateKey, isPastRouteDate } from '../mockData';
import { HyundaiRealNaviMap } from './HyundaiRealNaviMap';
import { RouteOverviewNaviMap } from './RouteOverviewNaviMap';
import { VehicleLocationModel3D } from './VehicleLocationModel3D';

interface CarDashboardViewProps {
  currentPlan: DailyPlan;
  onUpdatePlan?: (newPlan: DailyPlan) => void;
  onSwitchToPhoneView: () => void;
  isStandaloneCarApp?: boolean;
}

// 브라우저 공식 한국어 음성 합성 (TTS) 헬퍼

// 호출어("카멜레온") 감지 시 즉각 반응 사운드 (Web Audio API 차임벨)
const playWakeChime = () => {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    
    // 1음 (C5: 523Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.16);

    // 2음 (G5: 784Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.frequency.setValueAtTime(783.99, now + 0.12);
    gain2.gain.setValueAtTime(0.25, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.35);
  } catch (e) {
    console.warn('Wake chime error:', e);
  }
};

let currentAudioCtx: AudioContext | null = null;
let currentBufferSource: AudioBufferSourceNode | null = null;
let currentTTSAudio: HTMLAudioElement | null = null;

// 브라우저 최초 클릭/터치 시 오디오 자동재생 권한 잠금 해제
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
      silentAudio.play().catch(() => {});
      if (currentAudioCtx && currentAudioCtx.state === 'suspended') {
        currentAudioCtx.resume().catch(() => {});
      }
    } catch (_) {}
  };
  window.addEventListener('click', unlockAudio, { once: true });
  window.addEventListener('touchstart', unlockAudio, { once: true });
}

/**
 * Web Speech API Fallback (씩씩하고 귀여운 남잼 소년 캐릭터 톤 적용)
 */
const fallbackWebSpeech = (text: string, onEnd?: () => void) => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.pitch = 1.20; // 씩씩하고 귀여운 소년(남잼) 캐릭터 피치!
      utterance.rate = 1.10; // 활기차고 경쾌한 템포
      utterance.volume = 1.0;
      utterance.onend = () => { onEnd?.(); };
      utterance.onerror = () => { onEnd?.(); };
      const voices = window.speechSynthesis.getVoices();
      const koVoice = voices.find(v => v.lang.includes('ko') || v.lang.includes('KO'));
      if (koVoice) utterance.voice = koVoice;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('WebSpeech fallback error:', e);
      onEnd?.();
    }
  } else {
    onEnd?.();
  }
};

// 모든 오디오 및 음성 합성 즉시 정지 함수 (Safety Controller & Barge-in 지원)
const stopAllAudio = () => {
  try {
    if (typeof window !== 'undefined' && (window as any).CarVoiceBridge?.stopAllAudio) {
      (window as any).CarVoiceBridge.stopAllAudio();
    } else if (typeof window !== 'undefined' && (window as any).CarVoiceBridge?.stopVoice) {
      (window as any).CarVoiceBridge.stopVoice();
    }
    if (currentBufferSource) {
      try { currentBufferSource.stop(); } catch (_) {}
      try { currentBufferSource.disconnect(); } catch (_) {}
      currentBufferSource = null;
    }
    if (currentTTSAudio) {
      try {
        currentTTSAudio.pause();
        currentTTSAudio.currentTime = 0;
      } catch (_) {}
      currentTTSAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch (_) {}
};

if (typeof window !== 'undefined') {
  (window as any).stopAllAudio = stopAllAudio;
}

/**
 * [귀여운 카멜레온 캐릭터 TTS 함수]
 * 1순위: 안드로이드 스튜디오/차량 AAOS 환경 -> 네이티브 CarVoiceBridge (네비게이션 오디오 스트림 직통 + 귀여운 고음 피치)
 * 2순위: PC 웹 브라우저 환경 -> Web Audio API 실시간 피치 시프트(1.35배 고음 = 뽀로로/피카츄 같은 귀여운 캐릭터 톤)
 * 3순위: HTML5 Audio + WebSpeech 귀여운 피치 Fallback
 */
const playKoreanTTS = async (text: string, onEnd?: () => void) => {
  if (typeof window === 'undefined') {
    onEnd?.();
    return;
  }

  const cleanText = text.replace(/[\n\r]+/g, ' ').trim().slice(0, 160);
  if (!cleanText) {
    onEnd?.();
    return;
  }

  // 1. 기존에 재생 중이던 소리 및 네이티브 음성 정지
  stopAllAudio();

  // 2. [안드로이드 스튜디오 / AAOS 차량 에뮬레이터 환경]:
  // 네이티브 CarVoiceBridge가 있으면 네이티브 카오디오 스트림으로 100% 확실하고 귀엽게 출력!
  if ((window as any).CarVoiceBridge?.speakCuteChameleon) {
    try {
      (window as any).CarVoiceBridge.speakCuteChameleon(cleanText);
      setTimeout(() => onEnd?.(), 4000);
      return;
    } catch (bridgeErr) {
      console.warn('Native CarVoiceBridge error, falling back:', bridgeErr);
    }
  }

  // 3. [PC 웹 브라우저 환경]:
  // Web Audio API를 활용하여 고음질 음성을 1.35배 고음 피치로 변환해 "귀여운 카멜레온 마스코트" 목소리로 재생
  let audioUrl = `/api/tts?text=${encodeURIComponent(cleanText)}`;
  if (window.location.hostname.includes('androidplatform.net') || window.location.protocol === 'file:') {
    audioUrl = `http://10.0.2.2:3001/api/tts?text=${encodeURIComponent(cleanText)}`;
  }

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const ctx = currentAudioCtx || new AudioContextClass();
      currentAudioCtx = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const res = await fetch(audioUrl);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        // ★ [요청 반영]: 씩씩하고 통통 튀는 ㅈㄴ귀여운 남잼(남자 소년) 캐릭터 목소리 변환!
        // 1. 피치: 1.20배 (너무 가냘픈 아기 목소리가 아닌, 개구쟁이 소년 마스코트 톤)
        source.playbackRate.value = 1.20;

        // 2. 소년 특유의 씩씩한 울림을 주는 저음 보정 (240Hz +2.5dB)
        const lowShelf = ctx.createBiquadFilter();
        lowShelf.type = 'lowshelf';
        lowShelf.frequency.value = 240;
        lowShelf.gain.value = 2.5;

        // 3. 통통 튀는 또렷한 발음을 강조하는 미드 피킹 필터 (1800Hz +3.5dB)
        const midFilter = ctx.createBiquadFilter();
        midFilter.type = 'peaking';
        midFilter.frequency.value = 1800;
        midFilter.gain.value = 3.5;

        source.connect(lowShelf);
        lowShelf.connect(midFilter);
        midFilter.connect(ctx.destination);

        currentBufferSource = source;

        source.onended = () => {
          currentBufferSource = null;
          onEnd?.();
        };

        source.start(0);
        return;
      }
    }
  } catch (webAudioErr) {
    console.warn('Web Audio cute pitch synthesis fallback:', webAudioErr);
  }

  // 4. [일반 HTML5 Audio Fallback]
  try {
    const audio = new Audio(audioUrl);
    (audio as any).preservesPitch = false;
    (audio as any).mozPreservesPitch = false;
    (audio as any).webkitPreservesPitch = false;
    audio.playbackRate = 1.20; // 씩씩한 남잼 소년 톤
    audio.volume = 1.0;
    currentTTSAudio = audio;

    let finished = false;
    const finishHandler = () => {
      if (!finished) {
        finished = true;
        currentTTSAudio = null;
        onEnd?.();
      }
    };

    audio.onended = finishHandler;
    audio.onerror = () => {
      fallbackWebSpeech(cleanText, onEnd);
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => fallbackWebSpeech(cleanText, onEnd));
    }
  } catch (err) {
    fallbackWebSpeech(cleanText, onEnd);
  }
};

export const CarDashboardView: React.FC<CarDashboardViewProps> = ({
  currentPlan,
  onUpdatePlan,
  onSwitchToPhoneView,
  isStandaloneCarApp = false
}) => {
  // 차량 앱 화면 단계:
  // Step 1 ('select'): 루트 선택 화면
  // Step 2 ('briefing'): 선택된 루트 확인 & 현대차 TTS 음성 안내 및 STT 제어
  // Step 3 ('driving'): 사이드 모드 (좌측: 현대 순정 내비게이션 / 우측: 카멜레온 3D 모션 비서)
  const [carStep, setCarStep] = useState<'select' | 'briefing' | 'driving'>('select');

  // 현재 선택된 루트
  const [selectedRoute, setSelectedRoute] = useState<SavedRoute>(currentPlan.activeRoute);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);

  // 음성(STT / TTS) 상태
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [sttInputText, setSttInputText] = useState('');
  const [driverVoiceLog, setDriverVoiceLog] = useState<string | null>(null);
  const [aiResponseText, setAiResponseText] = useState<string>('');
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [autoNaviAlert, setAutoNaviAlert] = useState<string | null>(null);
  // [요청 반영]: 항상 소지 중인 상시 STT & "카멜레온~" 호출어(Wake Word) 반응 상태
  const [isAwake, setIsAwake] = useState(false);
  const [wakeIgnoredLog, setWakeIgnoredLog] = useState<string | null>(null);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  // 마이크 실시간 감지 상태 및 청취된 단어 프리뷰
  const [micState, setMicState] = useState<'listening' | 'ready' | 'testing' | 'blocked'>('listening');
  const [liveHeardPreview, setLiveHeardPreview] = useState<string | null>(null);
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [vehicleSpeed, setVehicleSpeed] = useState<number>(64);

  // [루트 선택 화면]: 오늘 연결 날짜 기준 루트 vs 지난 루트 불러오기 탭
  const [routeViewTab, setRouteViewTab] = useState<'today' | 'history'>('today');
  const todayFormatted = getTodayDateString(0); // e.g. "11.10 (오늘)"

  // [사용자 요구사항 완벽 반영]:
  // 1) 날짜가 지난 루트는 '지난 주행 기록' 보관함으로 자동 격리
  // 2) 오늘 및 예정된 루트는 '날짜 오름차순(가까운 날짜순: 오늘 -> 내일 -> 주말...)' 순서대로 정렬하여 표시!
  const todayRoutes = React.useMemo(() => {
    const rawRoutes = currentPlan.savedRoutes || [];
    const upcoming = rawRoutes.filter(r => !isPastRouteDate(r.date));
    return [...upcoming].sort((a, b) => parseRouteDateKey(a.date) - parseRouteDateKey(b.date));
  }, [currentPlan.savedRoutes]);

  // 과거 지난 날짜의 완료/보관 루트 목록 (최근 지난 날짜 순으로 정렬)
  const pastRoutesList = React.useMemo(() => {
    const rawSaved = currentPlan.savedRoutes || [];
    const pastFromSaved = rawSaved.filter(r => isPastRouteDate(r.date));
    const rawPast = currentPlan.pastRoutes || mockPastRoutes;
    const combined = [...rawPast, ...pastFromSaved];
    const unique = combined.filter((r, idx, self) => idx === self.findIndex(t => t.id === r.id));
    return unique.sort((a, b) => parseRouteDateKey(b.date) - parseRouteDateKey(a.date));
  }, [currentPlan.savedRoutes, currentPlan.pastRoutes]);

  const handleSelectPastRoute = (pastRoute: SavedRoute) => {
    const loadedRoute: SavedRoute = {
      ...pastRoute,
      date: `${todayFormatted} (불러온 코스)`,
      isActiveInCar: true
    };
    handleSelectRoute(loadedRoute);
    const msg = `${pastRoute.title} 지난 루트를 오늘 주행 코스로 불러왔습니다.`;
    setAiResponseText(msg);
    playKoreanTTS(msg);
  };

  // Gemini 1.5 Flash AI 연동 모달 및 키 상태
  const [isGeminiModalOpen, setIsGeminiModalOpen] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [geminiSaveMsg, setGeminiSaveMsg] = useState<string | null>(null);

  // =========================================================================
  // [차량용 앱 특화 핵심 기능]: 차량 실시간 위치 기반 자율 AI 여행 가이드 (자유 주행 지원)
  // "카멜레온~ 가이드 호출해줘" -> 루트가 없어도 차량 FusedLocation을 보고 실시간 관광 해설
  // =========================================================================
  const [isAutonomousGuide, setIsAutonomousGuide] = useState<boolean>(false);
  const [autonomousSpot, setAutonomousSpot] = useState<{
    id: string;
    title: string;
    locationName: string;
    theme: string;
    speechText: string;
    trivia: string;
    recommendedBgm: string;
  } | null>(null);
  const [autonomousStep, setAutonomousStep] = useState<number>(0);
  const autonomousStepRef = useRef(0);
  autonomousStepRef.current = autonomousStep;
  const isAutonomousGuideRef = useRef(isAutonomousGuide);
  isAutonomousGuideRef.current = isAutonomousGuide;
  const currentCoordRef = useRef<{ lat: number; lng: number }>({ lat: 37.3948, lng: 127.1119 });
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number }>({ lat: 37.3948, lng: 127.1119 });
  const [currentAddress, setCurrentAddress] = useState<string>('경기 성남시 분당구 판교역로 166');
  const [currentBuilding, setCurrentBuilding] = useState<string>('카카오 판교아지트');

  // [차량 API 연동]: 차량 모델 및 실시간 배터리/도어 텔레메트리 정보
  const [vehicleInfo, setVehicleInfo] = useState<{
    sellname: string;
    modelYear: number;
    type: string;
    nickname?: string;
    carPlateNumber: string;
    batteryPercent: number;
    remainingRangeKm: number;
    doorStatus: 'LOCKED' | 'UNLOCKED';
    isEngineOn: boolean;
    exteriorColor?: string;
    exteriorColorCode?: string;
  }>({
    sellname: currentPlan.carModel || '아이오닉 5',
    modelYear: 2024,
    type: 'EV',
    nickname: '내 흰둥이',
    carPlateNumber: currentPlan.carPlateNumber || '22너 7043',
    batteryPercent: currentPlan.batteryOrFuelPercent || 85,
    remainingRangeKm: 392,
    doorStatus: currentPlan.isDoorLocked ? 'LOCKED' : 'LOCKED',
    isEngineOn: currentPlan.isEngineOn ?? true,
    exteriorColor: currentPlan.exteriorColor || '아틀라스 화이트',
    exteriorColorCode: currentPlan.exteriorColorCode || 'SAW'
  });

  useEffect(() => {
    carmeleonApi.getVehicles()
      .then(vehicles => {
        if (vehicles && vehicles.length > 0) {
          const v = vehicles.find(item => item.carPlateNumber === currentPlan.carPlateNumber) || vehicles[0];
          setVehicleInfo({
            sellname: currentPlan.carModel || v.sellname,
            modelYear: v.modelYear,
            type: v.type,
            nickname: v.nickname,
            carPlateNumber: v.carPlateNumber,
            batteryPercent: currentPlan.batteryOrFuelPercent || (v.battery?.soc ?? 85),
            remainingRangeKm: v.battery?.remainingRange ?? 392,
            doorStatus: v.doorStatus,
            isEngineOn: v.isEngineOn,
            exteriorColor: currentPlan.exteriorColor || v.exteriorColor || '아틀라스 화이트',
            exteriorColorCode: currentPlan.exteriorColorCode || v.exteriorColorCode || 'SAW'
          });
        }
      })
      .catch(err => console.warn('Vehicle info fetch fallback:', err));
  }, [currentPlan.carPlateNumber, currentPlan.carModel, currentPlan.exteriorColor, currentPlan.exteriorColorCode]);

  const awakeTimeoutRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  const routeStops = selectedRoute.stops && selectedRoute.stops.length > 0
    ? selectedRoute.stops
    : currentPlan.activeRoute.stops;

  const currentStop = routeStops[currentStopIndex] || routeStops[0];
  const nextStop = routeStops[currentStopIndex + 1];

  // =========================================================================
  // [Pleos 차량 네이티브 감지 & NaviHelper 연동 계층]:
  // 안드로이드 AAOS / Pleos Connect 환경을 감지하고, 실제 순정 내비게이션으로
  // 경로를 전송하여 분할 화면(Adjacent Window)으로 실행합니다.
  // =========================================================================
  const isNativeVehicle = typeof window !== 'undefined' && Boolean(
    (window as any).CarNaviBridge || 
    (window as any).CarVoiceBridge || 
    navigator.userAgent.includes('CARmeleon-PleosAuto')
  );

  // 주행 중 UI 모드: 실제 차량에서는 Carmeleon 전용 UI에만 집중 (순정 내비는 OS가 옆 화면에 독립 실행)
  const [drivingLayoutMode, setDrivingLayoutMode] = useState<'carmeleon_only' | 'preview_split'>('carmeleon_only');

  const triggerPleosNaviHelper = (stopIndex = 0) => {
    const targetStop = routeStopsRef.current[stopIndex] || currentStop;
    if (!targetStop) return;
    const destLat = targetStop.latitude || targetStop.lat || 37.5559;
    const destLng = targetStop.longitude || targetStop.lng || 126.9723;
    const destName = targetStop.name || '목적지';
    const waypointsJson = JSON.stringify(routeStopsRef.current.map(s => ({
      name: s.name,
      lat: s.latitude || s.lat || 37.5559,
      lng: s.longitude || s.lng || 126.9723,
      time: s.time
    })));

    const routeId = selectedRouteRef.current?.id || 'route_default';
    carmeleonApi.createNavSession(`session-${routeId}`, routeId, currentPlan.carPlateNumber).catch(() => {});

    if (typeof window !== 'undefined' && (window as any).CarNaviBridge?.startNavigation) {
      console.log('🚘 [Pleos NaviHelper 호출] 순정 내비게이션 인텐트 전송:', destName);
      try {
        (window as any).CarNaviBridge.startNavigation(destLat, destLng, destName, waypointsJson);
      } catch (err) {
        console.warn('NaviHelper startNavigation error:', err);
      }
    } else if (typeof window !== 'undefined' && (window as any).CarNaviBridge?.launchAdjacentNavi) {
      try {
        (window as any).CarNaviBridge.launchAdjacentNavi(destLat, destLng, destName);
      } catch (err) {
        console.warn('CarNaviBridge launchAdjacentNavi error:', err);
      }
    }
  };

  const triggerPleosNaviHelperWithStop = (customStop: any) => {
    if (!customStop) return;
    const destLat = customStop.latitude || 37.3942;
    const destLng = customStop.longitude || 127.1120;
    const destName = customStop.name || '목적지';
    if (typeof window !== 'undefined' && (window as any).CarNaviBridge?.startNavigation) {
      try {
        (window as any).CarNaviBridge.startNavigation(destLat, destLng, destName, '[]');
      } catch (err) {
        console.warn('NaviHelper startNavigation error:', err);
      }
    } else if (typeof window !== 'undefined' && (window as any).CarNaviBridge?.launchAdjacentNavi) {
      try {
        (window as any).CarNaviBridge.launchAdjacentNavi(destLat, destLng, destName);
      } catch (err) {
        console.warn('CarNaviBridge launchAdjacentNavi error:', err);
      }
    }
  };

  // =========================================================================
  // [차량용 특화 기능 1]: 저배터리 스마트 전기차 충전소 제안 & 재탑승 시 목적지 자동 복원
  // =========================================================================
  const [batteryAlertState, setBatteryAlertState] = useState<'idle' | 'prompting' | 'charging_nav' | 'charging_active' | 'dismissed'>('idle');
  const batteryAlertStateRef = useRef(batteryAlertState);
  batteryAlertStateRef.current = batteryAlertState;

  const [savedDestinationBeforeCharging, setSavedDestinationBeforeCharging] = useState<{
    stop: RouteStop;
    stopIndex: number;
    routeTitle: string;
  } | null>(null);
  const savedDestRef = useRef(savedDestinationBeforeCharging);
  savedDestRef.current = savedDestinationBeforeCharging;

  const [recommendedEVCharger, setRecommendedEVCharger] = useState<{
    id: string;
    name: string;
    address: string;
    distanceKm: number;
    durationMin: number;
    detail: string;
    latitude: number;
    longitude: number;
  }>({
    id: 'ev-epit-pangyo',
    name: '현대 E-pit 판교 알파돔시티 초고속 충전소',
    address: '경기 성남시 분당구 판교역로 152 지하 3층',
    distanceKm: 1.2,
    durationMin: 3,
    detail: '350kW 초고속 4기 (3기 사용 가능 · 18분 완충)',
    latitude: 37.3942,
    longitude: 127.1120
  });

  // =========================================================================
  // [차량용 특화 기능 2]: 주행 중 운전자 생리 현상(화장실 급함/휴게소) 긴급 안내
  // =========================================================================
  const [restroomAlertState, setRestroomAlertState] = useState<{
    isOpen: boolean;
    spot: {
      id: string;
      name: string;
      address: string;
      distanceKm: number;
      durationMin: number;
      detail: string;
      latitude: number;
      longitude: number;
    } | null;
  }>({
    isOpen: false,
    spot: null
  });
  const restroomAlertStateRef = useRef(restroomAlertState);
  restroomAlertStateRef.current = restroomAlertState;

  // 저배터리 감지 & 충전소 제안 트리거 함수
  const triggerLowBatteryFlow = async (customBatteryPercent = 18) => {
    setVehicleInfo(prev => ({
      ...prev,
      batteryPercent: customBatteryPercent,
      remainingRangeKm: Math.round(customBatteryPercent * 4.6)
    }));

    try {
      const poiRes = await carmeleonApi.getNearbyPOIs({
        type: 'ev_charger',
        latitude: currentCoordRef.current.lat,
        longitude: currentCoordRef.current.lng
      });
      if (poiRes.items && poiRes.items[0]) {
        setRecommendedEVCharger(poiRes.items[0]);
      }
    } catch (_) {}

    setBatteryAlertState('prompting');
    setIsAwake(true);
    isAwakeRef.current = true;

    const speech = `배터리 잔량이 ${customBatteryPercent}%로 부족합니다. 경로 상의 가장 가까운 급속 전기차 충전소로 안내해 드릴까요?`;
    setAiResponseText(speech);
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    playKoreanTTS(speech, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });
  };

  // 긍정 응답 시 충전소로 경로 전환 ("응", "네", "어", "예")
  const confirmEVChargingNav = (charger?: any) => {
    const targetCharger = charger || recommendedEVCharger;
    setSavedDestinationBeforeCharging({
      stop: currentStop,
      stopIndex: currentStopIndex,
      routeTitle: selectedRoute.title
    });

    setBatteryAlertState('charging_nav');
    playWakeChime();
    triggerPleosNaviHelperWithStop(targetCharger);

    const speech = `네! 현재 위치에서 1.2km 앞 ${targetCharger.name}으로 안내를 시작합니다. 350kW 초고속 충전기로 18분이면 80%까지 충전됩니다.`;
    setAiResponseText(speech);
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    playKoreanTTS(speech, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });
  };

  // 충전 완료 후 재탑승 시 기존 목적지 자동 연속 안내 (Seamless Resume)
  const completeChargingAndResumeDestination = () => {
    playWakeChime();
    setVehicleInfo(prev => ({
      ...prev,
      batteryPercent: 85,
      remainingRangeKm: 392
    }));

    const saved = savedDestRef.current;
    const destName = saved?.stop?.name || currentStop.name;

    setBatteryAlertState('idle');

    if (saved) {
      triggerPleosNaviHelper(saved.stopIndex);
    } else {
      triggerPleosNaviHelper(currentStopIndex);
    }

    const speech = `배터리 충전이 85% 완료되었습니다! 기존 목적지인 ${destName}으로 경로 안내를 계속해서 이어서 진행합니다.`;
    setAiResponseText(speech);
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    playKoreanTTS(speech, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });
  };

  // 충전소 제안 거부 시 ("아니", "나중에") -> 나중에 한 번 더 안내 예약
  const dismissLowBatteryPrompt = () => {
    setBatteryAlertState('dismissed');
    playWakeChime();
    const speech = '알겠습니다. 주행을 계속 진행하며, 배터리가 더 떨어지거나 15분 뒤에 다시 한번 안전하게 안내해 드릴게요.';
    setAiResponseText(speech);
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    playKoreanTTS(speech, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });

    setTimeout(() => {
      setBatteryAlertState('idle');
    }, 20000);
  };

  // 운전자 화장실 / 휴게소 요청 트리거
  const triggerRestroomFlow = async () => {
    playWakeChime();
    let targetRestroom: any = {
      id: 'rest-pangyo-ic',
      name: '판교IC 졸음쉼터 간이화장실',
      address: '경부고속도로 서울방향 판교IC 인근',
      distanceKm: 1.1,
      durationMin: 2,
      detail: '24시간 쾌적 개방 · 남녀 구분 화장실',
      latitude: 37.4080,
      longitude: 127.1065
    };

    try {
      const poiRes = await carmeleonApi.getNearbyPOIs({
        type: 'restroom',
        latitude: currentCoordRef.current.lat,
        longitude: currentCoordRef.current.lng
      });
      if (poiRes.items && poiRes.items[0]) {
        targetRestroom = poiRes.items[0];
      }
    } catch (_) {}

    setRestroomAlertState({
      isOpen: true,
      spot: targetRestroom
    });
    setIsAwake(true);
    isAwakeRef.current = true;

    const speech = `화장실이 급하시군요! 현재 주행 경로에서 가장 가까운 화장실은 1.1km 앞 ${targetRestroom.name}입니다. 순정 내비 경로에 바로 경유지로 추가해 드릴까요?`;
    setAiResponseText(speech);
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    playKoreanTTS(speech, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });
  };

  // 화장실 경유지 추가 승인 ("응", "네", "어", "예")
  const confirmRestroomWaypoint = () => {
    playWakeChime();
    const spot = restroomAlertStateRef.current.spot || {
      name: '판교IC 졸음쉼터 화장실',
      latitude: 37.4080,
      longitude: 127.1065,
      address: '경부고속도로 서울방향 판교IC 인근'
    };

    const restroomStop: RouteStop = {
      id: `restroom-${Date.now()}`,
      name: spot.name,
      address: spot.address,
      latitude: spot.latitude,
      longitude: spot.longitude,
      type: 'travel',
      time: '긴급 경유',
      memo: '운전자 긴급 화장실 이용'
    };

    const updatedStops = [restroomStop, ...routeStopsRef.current];
    const updatedRoute = { ...selectedRouteRef.current, stops: updatedStops };
    setSelectedRoute(updatedRoute);
    selectedRouteRef.current = updatedRoute;
    if (onUpdatePlan) {
      onUpdatePlan({ ...currentPlanRef.current, activeRoute: updatedRoute });
    }

    setRestroomAlertState({ isOpen: false, spot: null });
    triggerPleosNaviHelperWithStop(restroomStop);

    const speech = `${spot.name}을 첫 번째 경유지로 즉시 등록했습니다. 안전하게 운전하세요!`;
    setAiResponseText(speech);
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    playKoreanTTS(speech, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });
  };

  // =========================================================================
  // [자율 AI 가이드 핸들러]: 차량 실시간 위치 기반 관광·역사·BGM 자율 해설
  // =========================================================================
  const fetchNextAutonomousSpot = async (manual = false) => {
    const nextStep = autonomousStepRef.current + 1;
    setAutonomousStep(nextStep);
    autonomousStepRef.current = nextStep;

    try {
      const guideRes = await carmeleonApi.getAutonomousGuide({
        latitude: currentCoordRef.current.lat,
        longitude: currentCoordRef.current.lng,
        speed: vehicleSpeed,
        step: nextStep
      });

      if (guideRes?.spot) {
        setAutonomousSpot(guideRes.spot);
        if (manual || isAutonomousGuideRef.current) {
          playWakeChime();
          setIsSpeaking(true);
          isSpeakingRef.current = true;
          setAiResponseText(guideRes.spot.speechText);
          playKoreanTTS(guideRes.spot.speechText, () => {
            setIsSpeaking(false);
            isSpeakingRef.current = false;
          });
        }
      }
    } catch (err) {
      console.warn('Autonomous spot fetch error:', err);
    }
  };

  const triggerAutonomousGuide = async (enable: boolean) => {
    if (enable) {
      setIsAutonomousGuide(true);
      isAutonomousGuideRef.current = true;
      playWakeChime();
      setIsSpeaking(true);
      isSpeakingRef.current = true;
      setCarStep('driving');

      const welcomeMsg = '네! 카멜레온 실시간 자율 가이드를 시작합니다. 목적지가 없어도 차량 위치를 따라 주변의 숨은 명소와 역사 이야기를 들려드릴게요. 편안하게 운전하세요!';
      setAiResponseText(welcomeMsg);
      playKoreanTTS(welcomeMsg, () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      });

      try {
        const guideRes = await carmeleonApi.getAutonomousGuide({
          latitude: currentCoordRef.current.lat,
          longitude: currentCoordRef.current.lng,
          speed: vehicleSpeed,
          step: 0
        });
        if (guideRes?.spot) {
          setAutonomousSpot(guideRes.spot);
        }
      } catch (err) {
        console.warn('Initial autonomous guide error:', err);
      }
    } else {
      setIsAutonomousGuide(false);
      isAutonomousGuideRef.current = false;
      stopAllAudio();
      const byeMsg = '카멜레온 자율 가이드 모드를 종료합니다. 계속해서 안전 운전하세요!';
      setAiResponseText(byeMsg);
      playKoreanTTS(byeMsg, () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      });
    }
  };

  // ★ 클로저(Stale Closure) 문제를 100% 방지하는 실시간 Ref 동기화
  const carStepRef = useRef(carStep);
  carStepRef.current = carStep;

  const selectedRouteRef = useRef(selectedRoute);
  selectedRouteRef.current = selectedRoute;

  const lastSyncedAtRef = useRef<number>(Date.now());
  const lastRouteIdRef = useRef<string>(selectedRoute.id);
  lastRouteIdRef.current = selectedRoute.id;

  const routeStopsRef = useRef(routeStops);
  routeStopsRef.current = routeStops;

  const currentPlanRef = useRef(currentPlan);
  currentPlanRef.current = currentPlan;

  const isAwakeRef = useRef(isAwake);
  isAwakeRef.current = isAwake;

  const handleVoiceInputRef = useRef<(text: string) => void>(() => {});

  // Gemini API 키 초기 상태 확인
  useEffect(() => {
    const localKey = localStorage.getItem('carmeleon_gemini_api_key');
    if (localKey && localKey.length > 10) {
      setHasGeminiKey(true);
      setGeminiKeyInput(localKey);
    } else {
      fetch('/api/ai/gemini-status')
        .then(r => r.json())
        .then(d => {
          if (d.hasKey) {
            setHasGeminiKey(true);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Gemini API 키 저장 핸들러
  const handleSaveGeminiKey = async (keyToSave: string) => {
    const trimmed = keyToSave.trim();
    if (!trimmed) {
      setGeminiSaveMsg('⚠️ API 키를 입력해 주세요.');
      return;
    }
    localStorage.setItem('carmeleon_gemini_api_key', trimmed);
    setHasGeminiKey(true);
    setGeminiSaveMsg('✅ 브라우저에 저장 중...');
    try {
      await fetch('/api/ai/set-gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed })
      });
      setGeminiSaveMsg('🎉 Gemini 1.5 Flash AI 연결 완료!');
      setTimeout(() => {
        setIsGeminiModalOpen(false);
        setGeminiSaveMsg(null);
      }, 1200);
    } catch (_) {
      setGeminiSaveMsg('✅ 브라우저에 저장 완료되었습니다!');
      setTimeout(() => {
        setIsGeminiModalOpen(false);
        setGeminiSaveMsg(null);
      }, 1200);
    }
  };

  // 마이크 하드웨어 연결 및 권한 실시간 진단
  const handleTestMicrophone = async () => {
    setIsMicTesting(true);
    setLiveHeardPreview('🎤 마이크 입력 감지 중... 마이크에 "카멜레온"이라고 말해보세요!');
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicState('listening');
        setLiveHeardPreview('✅ 마이크 정상 연결 확인! 소리를 감지하고 있습니다.');
        setTimeout(() => {
          stream.getTracks().forEach(t => t.stop());
          setIsMicTesting(false);
        }, 2500);
      } else {
        setLiveHeardPreview('✅ 상시 STT 마이크가 백그라운드에서 동작 중입니다.');
        setIsMicTesting(false);
      }
    } catch (err) {
      setMicState('blocked');
      setLiveHeardPreview('⚠️ 마이크 권한이 차단되어 있습니다. 브라우저 주소창 자물쇠에서 마이크를 허용해 주세요!');
      setIsMicTesting(false);
    }
  };

  // =========================================================================
  // [AI 스마트 경로 수정 핸들러]: 운전자 음성 감지 후 백엔드 AI (Gemini 1.5 Flash) 연결
  // =========================================================================
  const handleModifyRouteRequest = async (voiceText: string) => {
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    setAiResponseText('🤖 AI가 음성 명령을 분석하여 최적의 경로를 수정하고 있습니다...');

    const currentRoute = selectedRouteRef.current;
    const currentStops = routeStopsRef.current;

    let apiUrl = '/api/ai/modify-route';
    if (typeof window !== 'undefined' && (window.location.hostname.includes('androidplatform.net') || window.location.protocol === 'file:')) {
      apiUrl = 'http://10.0.2.2:3001/api/ai/modify-route';
    }

    const localGeminiKey = localStorage.getItem('carmeleon_gemini_api_key') || '';

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localGeminiKey ? { 'X-Gemini-Key': localGeminiKey } : {})
        },
        body: JSON.stringify({
          currentRoute,
          voiceCommand: voiceText
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.modifiedRoute) {
          setSelectedRoute(data.modifiedRoute);
          selectedRouteRef.current = data.modifiedRoute;
          setCurrentStopIndex(0);
          if (onUpdatePlan) {
            onUpdatePlan({ ...currentPlanRef.current, activeRoute: data.modifiedRoute });
          }
          setAiResponseText(data.speechText);
          playKoreanTTS(data.speechText, () => {
            setIsSpeaking(false);
            isSpeakingRef.current = false;
          });
          setTimeout(() => {
            setIsSpeaking(false);
            isSpeakingRef.current = false;
          }, 6000);
          return;
        }
      }
    } catch (e) {
      console.warn('AI Modify Route backend call error, falling back locally:', e);
    }

    // 로컬 즉시 폴백 (네트워크 미연결 시에도 100% 작동)
    let updatedStops = [...currentStops];
    let replySpeech = '';

    if (voiceText.includes('먼저') || voiceText.includes('순서') || voiceText.includes('바꿔') || voiceText.includes('앞으로')) {
      if (updatedStops.length >= 2) {
        const targetName = updatedStops[1].name;
        const temp = updatedStops[0];
        updatedStops[0] = updatedStops[1];
        updatedStops[1] = temp;
        replySpeech = `네! ${targetName}을 첫 번째 경유지로 우선 변경했습니다. 이동 장소는 총 ${updatedStops.length}곳입니다. 안내를 시작할까요?`;
      }
    } else if (voiceText.includes('빼') || voiceText.includes('제외') || voiceText.includes('삭제')) {
      if (updatedStops.length > 1) {
        const removed = updatedStops.pop();
        replySpeech = `네! ${removed?.name}을 경로에서 제외했습니다. 이동 장소는 총 ${updatedStops.length}곳입니다. 안내를 시작할까요?`;
      }
    } else {
      let placeName = '수원 통닭거리 진미통닭';
      if (voiceText.includes('카페') || voiceText.includes('스타벅스')) placeName = '판교 스타벅스DT';
      else if (voiceText.includes('주유소') || voiceText.includes('충전')) placeName = '현대 E-pit 충전소';
      else if (voiceText.includes('통닭') || voiceText.includes('맛집') || voiceText.includes('수정') || voiceText.includes('추가')) placeName = '수원 통닭거리 진미통닭';
      else {
        const clean = voiceText.replace(/(카멜\s?레온|중간에|경로에|루트에|들렀다|들려|가자|추가해줘|넣어줘|수정해줘|수정요청|수정)/g, '').trim();
        if (clean) placeName = clean;
      }

      const newStop: RouteStop = {
        id: `stop-ai-${Date.now()}`,
        name: placeName,
        address: '수원시 팔달구 정조로800번길 21',
        category: '전통 맛집/명소',
        type: 'travel'
      };

      if (updatedStops.length >= 2) {
        updatedStops.splice(1, 0, newStop);
      } else {
        updatedStops.push(newStop);
      }

      replySpeech = `네! '${placeName}'을 새로운 경유지로 추가했습니다. 이동 장소는 총 ${updatedStops.length}곳입니다. 안내를 시작할까요?`;
    }

    const modified = { ...currentRoute, stops: updatedStops };
    setSelectedRoute(modified);
    selectedRouteRef.current = modified;
    setCurrentStopIndex(0);
    if (onUpdatePlan) {
      onUpdatePlan({ ...currentPlanRef.current, activeRoute: modified });
    }
    setAiResponseText(replySpeech);
    playKoreanTTS(replySpeech, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });
    setTimeout(() => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    }, 6000);
  };

  // =========================================================================
  // [운전자 실제 명령 처리 엔진]
  // =========================================================================
  const executeDriverCommand = (command: string) => {
    setIsSpeaking(true);
    isSpeakingRef.current = true;

    // 0) 자율 AI 가이드 호출 / 종료 명령 ("가이드 호출해줘", "가이드 시작해줘", "자율 가이드", "주변 가이드")
    if (command.includes('가이드') || command.includes('자율모드') || command.includes('자율 모드') || command.includes('관광') || command.includes('주변 설명')) {
      if (command.includes('꺼') || command.includes('종료') || command.includes('중지') || command.includes('그만')) {
        triggerAutonomousGuide(false);
      } else {
        triggerAutonomousGuide(true);
      }
      return;
    }

    // 1) 음악 / 노래 관련 명령
    if (command.includes('노래') || command.includes('음악') || command.includes('플레이리스트') || command.includes('틀어')) {
      setIsMusicPlaying(true);
      const reply = '운전자 플레이리스트를 연결하여 신나는 드라이브 음악을 재생합니다.';
      setAiResponseText(reply);
      playKoreanTTS(reply, () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      });
      setTimeout(() => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      }, 3000);
      return;
    }

    // 2) 주행 시작 / 네비 안내 시작 명령 (Pleos NaviHelper 실제 호출)
    if (command.includes('주행') || command.includes('출발') || command.includes('시작') || command.includes('네비')) {
      triggerPleosNaviHelper(0);
      setCarStep('driving');
      const currentFirstStop = routeStopsRef.current[0]?.name || '첫 번째 목적지';
      const reply = `현대 순정 내비게이션 주행을 시작합니다. 첫 번째 목적지인 ${currentFirstStop}으로 이동합니다.`;
      setAiResponseText(reply);
      playKoreanTTS(reply, () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      });
      setTimeout(() => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      }, 3500);
      return;
    }

    // 3) 경유지 순서 변경 ("B기업 먼저", "순서 바꿔줘")
    if (command.includes('먼저') || command.includes('바꿔') || command.includes('수정') || command.includes('앞으로')) {
      const updatedStops = [...routeStopsRef.current];
      if (updatedStops.length >= 2) {
        const targetName = updatedStops[1].name;
        const temp = updatedStops[0];
        updatedStops[0] = updatedStops[1];
        updatedStops[1] = temp;

        const updatedRoute = { ...selectedRouteRef.current, stops: updatedStops };
        setSelectedRoute(updatedRoute);
        selectedRouteRef.current = updatedRoute;
        if (onUpdatePlan) {
          onUpdatePlan({ ...currentPlanRef.current, activeRoute: updatedRoute });
        }

        const reply = `네, ${targetName}을 첫 번째 경유지로 우선 변경했습니다!`;
        setAiResponseText(reply);
        playKoreanTTS(reply, () => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
        });
        setTimeout(() => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
        }, 3500);
        return;
      }
    }

    // 4) 코스 목록 이동 명령
    if (command.includes('목록') || command.includes('루트') || command.includes('뒤로') || command.includes('고를래')) {
      setCarStep('select');
      const reply = '추천 드라이브 코스 목록 화면으로 이동합니다.';
      setAiResponseText(reply);
      playKoreanTTS(reply, () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      });
      setTimeout(() => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      }, 3000);
      return;
    }

    // 5) 기타 일반 명령
    const defaultReply = `네! '${command}' 명령을 접수했습니다. 안전한 주행을 준비할게요.`;
    setAiResponseText(defaultReply);
    playKoreanTTS(defaultReply, () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    });
    setTimeout(() => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    }, 3000);
  };

  // =========================================================================
  // [음성 명령 라우팅 엔진]: 운전자 발화 감지 및 스마트 분기
  // =========================================================================
  const handleVoiceInput = (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;

    const currentStep = carStepRef.current;
    const currentAwake = isAwakeRef.current;
    const currentStops = routeStopsRef.current;

    console.log(`🎤 [음성 입력 분석]: "${text}" (화면단계: ${currentStep}, 깨어남: ${currentAwake})`);

    // 1) 호출어 포함 여부 ("카멜레온", "카멜 레온", "카메레온", "카멜")
    const hasWakeWord = /(카멜\s?레온|카메레온|카멜)/i.test(text);

    // 1.5) [핵심]: 자율 AI 여행 가이드 호출 의도 ("가이드 호출해줘", "가이드 시작", "가이드 해줘", "자율 가이드", "주변 가이드")
    const isGuideRequest = /(가이드\s?호출|가이드\s?켜|가이드\s?시작|가이드\s?해줘|자율\s?가이드|자율\s?모드|주변\s?가이드|주변\s?설명|관광\s?안내|여행\s?가이드)/i.test(text);
    const isGuideStop = /(가이드\s?꺼|가이드\s?종료|가이드\s?중지|자율\s?가이드\s?꺼|가이드\s?그만)/i.test(text);

    if (isGuideRequest || isGuideStop) {
      setWakeIgnoredLog(null);
      setDriverVoiceLog(text);
      setLiveHeardPreview(`🧭 운전자: "${text}" (${isGuideStop ? '자율 가이드 종료' : '실시간 자율 여행 가이드 호출'})`);
      if (isGuideStop) {
        triggerAutonomousGuide(false);
      } else {
        triggerAutonomousGuide(true);
      }
      return;
    }

    // 2) 긍정 의도 ("네", "응", "어", "예", "그래", "좋아", "출발", "가자", "충전하자" 등)
    const isYesAnswer = /^(네|응|어|예|그래|좋아|출발|시작|가자|오케이|출발하자|시작하자|충전|추가|충전해줘|추가해줘|주행\s?시작)/i.test(text) || text.includes('주행 시작') || text.includes('안내 시작') || text.includes('출발');

    // 3) 부정 / 거부 의도 ("아니", "아니오", "싫어", "취소", "나중에", "됐어", "괜찮아" 등)
    const isNoAnswer = /^(아니|아니오|아뇨|싫어|취소|뒤로|다른\s?거|목록|다시\s?고를래|나중에|됐어|괜찮아)/i.test(text) || text.includes('다른 루트') || text.includes('다른 코스');

    // 4) 경로 수정 의도 (수정, 추가, 경유지 변경, 특정 장소 언급)
    const isModifyRequest = /(수정|수정요청|수정해|추가|넣어|들렀다|들려|바꿔|순서|먼저|빼|제외|통닭|카페)/i.test(text);

    // =========================================================================
    // [저배터리 충전소 제안 중 운전자 직답 처리] ("응, 네, 어, 예" vs "아니, 나중에")
    // =========================================================================
    if (batteryAlertStateRef.current === 'prompting') {
      if (isYesAnswer) {
        setDriverVoiceLog(text);
        setLiveHeardPreview(`⚡ 운전자: "${text}" (충전소 안내 승인)`);
        confirmEVChargingNav();
        return;
      }
      if (isNoAnswer) {
        setDriverVoiceLog(text);
        setLiveHeardPreview(`⏱️ 운전자: "${text}" (충전소 안내 거부 - 나중에 재안내)`);
        dismissLowBatteryPrompt();
        return;
      }
    }

    // =========================================================================
    // [화장실 / 휴게소 제안 중 운전자 직답 처리] ("응, 네, 어, 예" vs "아니, 괜찮아")
    // =========================================================================
    if (restroomAlertStateRef.current.isOpen) {
      if (isYesAnswer) {
        setDriverVoiceLog(text);
        setLiveHeardPreview(`🚾 운전자: "${text}" (화장실 경유지 등록 승인)`);
        confirmRestroomWaypoint();
        return;
      }
      if (isNoAnswer) {
        setDriverVoiceLog(text);
        setLiveHeardPreview(`🚾 운전자: "${text}" (화장실 경유지 취소)`);
        setRestroomAlertState({ isOpen: false, spot: null });
        const cancelMsg = '알겠습니다. 원래 목적지로 계속해서 안내합니다.';
        setAiResponseText(cancelMsg);
        playKoreanTTS(cancelMsg);
        return;
      }
    }

    // =========================================================================
    // [주행 중 긴급 상황 1: 화장실 / 휴게소 긴급 발화 감지]
    // =========================================================================
    const isRestroomRequest = /(화장실|휴게소|졸음쉼터|오줌|쉬\s?마려|배\s?아파|급해|화장실\s?어디|휴게소\s?어디)/i.test(text);
    if (isRestroomRequest) {
      setWakeIgnoredLog(null);
      setDriverVoiceLog(text);
      setLiveHeardPreview(`🚾 운전자: "${text}" (화장실/휴게소 긴급 요청 감지)`);
      triggerRestroomFlow();
      return;
    }

    // =========================================================================
    // [주행 중 긴급 상황 2: 전기차 충전소 발화 감지]
    // =========================================================================
    const isChargerRequest = /(충전소|전기차\s?충전|배터리\s?충전|충전소\s?어디)/i.test(text);
    if (isChargerRequest) {
      setWakeIgnoredLog(null);
      setDriverVoiceLog(text);
      setLiveHeardPreview(`⚡ 운전자: "${text}" (전기차 충전소 직접 요청)`);
      triggerLowBatteryFlow(18);
      return;
    }

    // [중요: 2단계 코스 브리핑 화면]
    // AI가 이미 "안내를 시작할까요?"라고 질문한 상태이므로 호출어 없이도 직답을 즉시 처리!
    if (currentStep === 'briefing') {
      if (isYesAnswer && !isModifyRequest) {
        setDriverVoiceLog(text);
        setLiveHeardPreview(`✅ 운전자: "${text}" (주행 시작 안내)`);
        playWakeChime();
        const currentFirstStop = currentStops[0]?.name || '첫 번째 목적지';
        const confirmMsg = `${currentFirstStop}으로 안내를 시작합니다.`;
        setAiResponseText(confirmMsg);
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        playKoreanTTS(confirmMsg, () => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          triggerPleosNaviHelper(0);
          setCarStep('driving');
        });
        setTimeout(() => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          triggerPleosNaviHelper(0);
          setCarStep('driving');
        }, 1500);
        return;
      }

      if (isNoAnswer && !isModifyRequest) {
        setDriverVoiceLog(text);
        setLiveHeardPreview(`↩️ 운전자: "${text}" (코스 재선택)`);
        playWakeChime();
        const rejectMsg = '다른 루트를 선택해주세요!';
        setAiResponseText(rejectMsg);
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        playKoreanTTS(rejectMsg, () => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          setCarStep('select');
        });
        setTimeout(() => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          setCarStep('select');
        }, 1500);
        return;
      }

      if (isModifyRequest) {
        setDriverVoiceLog(text);
        setLiveHeardPreview(`✏️ 운전자: "${text}" (AI 경로 수정 요청 접수)`);
        playWakeChime();
        setIsAwake(true);
        isAwakeRef.current = true;
        handleModifyRouteRequest(text);
        return;
      }
    }

    // [일반 상황]: 호출어가 있거나 이미 대화 상태가 켜져 있는 경우
    if (hasWakeWord || currentAwake) {
      setWakeIgnoredLog(null);
      setDriverVoiceLog(text);
      setLiveHeardPreview(`🗣️ 운전자: "${text}"`);
      playWakeChime();
      setIsAwake(true);
      isAwakeRef.current = true;

      // 15초 동안 연속 청취 유지
      if (awakeTimeoutRef.current) clearTimeout(awakeTimeoutRef.current);
      awakeTimeoutRef.current = setTimeout(() => {
        setIsAwake(false);
        isAwakeRef.current = false;
      }, 15000);

      const command = text.replace(/카멜\s?레온[아|야|이|~]?/gi, '').trim();

      // 호출어만 단독으로 부른 경우 ("카멜레온~")
      if (!command) {
        const greeting = '네! 부르셨어요? 말씀하세요, 카멜레온이 듣고 있어요.';
        setAiResponseText(greeting);
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        playKoreanTTS(greeting, () => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
        });
        setTimeout(() => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
        }, 3000);
        return;
      }

      // 수정 요청이거나 브리핑 단계인 경우 경로 수정 실행
      if (isModifyRequest || currentStep === 'briefing') {
        handleModifyRouteRequest(command || text);
        return;
      }

      executeDriverCommand(command);
    } else {
      setWakeIgnoredLog(`"${text}" (호출어 "카멜레온" 필요)`);
      setLiveHeardPreview(`들린 말: "${text}" (호출어 "카멜레온"을 먼저 불러주세요)`);
      console.log('🔇 [호출어 미포함]: "카멜레온"이 없어 무음 대기 중입니다.');
    }
  };

  // 하위 호환용
  const handleProcessDriverVoice = (spokenText: string) => {
    handleVoiceInput(spokenText);
  };

  const handleStartMicSTT = () => {
    handleVoiceInput('카멜레온');
  };

  // AI 발화 상태 ref 동기화
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // handleVoiceInputRef를 매 렌더마다 최신 함수로 갱신하여 클로저 버그 방지
  useEffect(() => {
    handleVoiceInputRef.current = handleVoiceInput;
  });

  // 안드로이드 네이티브 Pleos NaviHelper, 위치, 음성 이벤트 전역 수신
  useEffect(() => {
    (window as any).onDriverVoiceDetected = (spoken: string) => {
      console.log('🎤 [전역 수신된 운전자 음성]:', spoken);
      stopAllAudio();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      handleVoiceInputRef.current(spoken);
    };

    (window as any).onNaviStateChanged = (data: { state: string; message: string }) => {
      console.log('🧭 [Pleos Navi 상태 변경]:', data.state, data.message);
      if (data.state === 'ROUTING_COMPLETED' || data.state === 'GUIDING') {
        setAutoNaviAlert(`✅ 현대 순정 내비 경로 탐색 완료: ${data.message}`);
        carmeleonApi.updateNavSession(`session-${selectedRouteRef.current?.id}`, 'NAV_CONFIRMED').catch(() => {});
      } else if (data.state === 'FAILED') {
        setAutoNaviAlert(`⚠️ 내비 경로 탐색 실패: ${data.message}`);
        carmeleonApi.updateNavSession(`session-${selectedRouteRef.current?.id}`, 'NAV_FAILED').catch(() => {});
      }
    };

    (window as any).onVehicleLocationUpdated = (data: { latitude: number; longitude: number; speedKmh: number; locationName?: string }) => {
      if (typeof data.speedKmh === 'number') {
        setVehicleSpeed(data.speedKmh);
      }
      if (data.latitude && data.longitude) {
        currentCoordRef.current = { lat: data.latitude, lng: data.longitude };
        setCurrentCoords({ lat: data.latitude, lng: data.longitude });
        if (data.locationName) {
          setCurrentAddress(data.locationName);
        }
      }
    };

    // 브라우저 실시간 위치 권한이 있을 경우 개발 서버에서도 사용자 위치 자동 반영
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          currentCoordRef.current = newCoords;
          setCurrentCoords(newCoords);
        },
        () => {},
        { timeout: 4000 }
      );
    }

    (window as any).onRouteStarted = (data: { destName: string }) => {
      console.log('🚗 [Pleos 내비 주행 시작]:', data.destName);
      setCarStep('driving');
    };

    (window as any).onWaypointArrived = (data: { waypointIndex: number }) => {
      console.log('🏁 [Pleos 경유지 도착]:', data.waypointIndex);
      setCurrentStopIndex(data.waypointIndex);
    };

    return () => {
      delete (window as any).onDriverVoiceDetected;
      delete (window as any).onNaviStateChanged;
      delete (window as any).onVehicleLocationUpdated;
      delete (window as any).onRouteStarted;
      delete (window as any).onWaypointArrived;
    };
  }, []);

  // [자율 AI 가이드 주기적 스토리텔링 & 랜드마크 해설]:
  // 주행 중 약 28초마다 차량 실시간 위치에 맞는 새로운 랜드마크와 음악 해설 자동 발화
  useEffect(() => {
    if (!isAutonomousGuide) return;

    const timer = setInterval(() => {
      if (!isSpeakingRef.current && isAutonomousGuideRef.current) {
        fetchNextAutonomousSpot(false);
      }
    }, 28000);

    return () => clearInterval(timer);
  }, [isAutonomousGuide]);

  // =========================================================================
  // [핵심 요구사항]: 항상 STT를 소지하고 백그라운드 대기!
  // 운전자가 "카멜레온~"이라고 말하는 순간 즉각 감지하여 반응
  // Barge-in(인터럽트) 지원: 사용자가 말하면 기존 음성 출력 즉각 중단
  // =========================================================================
  useEffect(() => {
    // 실제 차량 안드로이드 환경에서는 마이크 충돌 방지를 위해 브라우저 SpeechRecognition을 비활성화하고 네이티브 브릿지 사용
    const isNativeAndroid = typeof window !== 'undefined' && Boolean((window as any).CarVoiceBridge || (window as any).CarNaviBridge);
    if (isNativeAndroid) {
      console.log('🚗 [차량 환경] 브라우저 Web Speech 비활성화: 네이티브 VoiceEngine / Pleos 브릿지 사용');
      return;
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      console.log('Web Speech API not supported in this browser, using native bridge');
      return;
    }

    let isMounted = true;
    let rec: any = null;

    const startContinuousSTT = () => {
      if (!isMounted) return;
      try {
        rec = new SpeechRec();
        rec.lang = 'ko-KR';
        rec.continuous = true;
        rec.interimResults = false;

        rec.onstart = () => {
          setIsListening(true);
          setMicState('listening');
        };

        rec.onresult = (event: any) => {
          const lastIndex = event.results.length - 1;
          const transcript = event.results[lastIndex][0].transcript.trim();
          console.log('🎤 [상시 STT 음성 인식]:', transcript);

          // Barge-in: 운전자가 카멜레온을 부르거나 명령어를 말하면 진행 중인 TTS 즉시 중단!
          const isCommand = /(카멜\s?레온|카멜|수정|추가|넣어|들러|바꿔|순서|먼저|빼|네|응|그래|출발|시작|가자|아니|취소|뒤로)/i.test(transcript);
          if (isCommand && isSpeakingRef.current) {
            console.log('⚡ [Barge-in 인터럽트]: 운전자 발화 감지되어 기존 TTS를 즉시 중단하고 명령 처리');
            stopAllAudio();
            isSpeakingRef.current = false;
            setIsSpeaking(false);
          } else if (isSpeakingRef.current) {
            // 카멜레온 자신의 말소리가 마이크에 들어간 경우 무시
            return;
          }

          handleVoiceInputRef.current(transcript);
        };

        rec.onerror = (e: any) => {
          if (e.error === 'not-allowed') {
            setMicState('blocked');
            setLiveHeardPreview('⚠️ 마이크 권한이 차단되어 있습니다.');
          } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
            console.warn('STT event error:', e.error);
          }
        };

        rec.onend = () => {
          if (isMounted) {
            setTimeout(() => {
              if (isMounted) startContinuousSTT();
            }, 300);
          } else {
            setIsListening(false);
          }
        };

        rec.start();
        recognitionRef.current = rec;
      } catch (err) {
        console.warn('Background STT initiation error:', err);
      }
    };

    startContinuousSTT();

    return () => {
      isMounted = false;
      if (rec) {
        try { rec.abort(); } catch (_) {}
      }
    };
  }, []);

  // 스마트폰에서 전송된 최신 경로 실시간 자동 수신 및 반영 (GET /api/routes/sync)
  useEffect(() => {
    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/routes/sync');
        if (res.ok) {
          const data = await res.json();
          if (data.activeRoute && isMounted) {
            const serverSyncedAt = data.syncedAt || 0;
            // 스마트폰에서 새로 전송한 시각이 우리가 마지막으로 선택/동기화한 시각보다 더 최신이고,
            // 현재 화면의 루트 ID와 다를 때만 외부 스마트폰 원격 푸시로 감지하여 전환!
            const isNewRemotePush =
              serverSyncedAt > (lastSyncedAtRef.current || 0) &&
              data.activeRoute.id !== lastRouteIdRef.current;

            if (isNewRemotePush) {
              lastSyncedAtRef.current = serverSyncedAt;
              lastRouteIdRef.current = data.activeRoute.id;
              setSelectedRoute(data.activeRoute);
              selectedRouteRef.current = data.activeRoute;
              routeStopsRef.current = data.activeRoute.stops || [];

              if (onUpdatePlan) {
                onUpdatePlan({ ...currentPlanRef.current, activeRoute: data.activeRoute });
              }

              setCurrentStopIndex(0);
              setCarStep('briefing');
              setAutoNaviAlert(`📱 스마트폰에서 [${data.activeRoute.title}] 경로가 전송되었습니다!`);
              const msg = `스마트폰에서 새로운 경로 ${data.activeRoute.title}가 전송되었습니다. 출발하시겠습니까?`;
              setAiResponseText(msg);
              setIsSpeaking(true);
              playKoreanTTS(msg);
            }
          }
        }
      } catch {
        // 네트워크 미연결 시 무시
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // =========================================================================
  // [요청 2 반영]: 루트 누르면 2번째 화면으로 이동하면서 현대차 TTS 실제 음성 출력!
  // "선택하신 (코스이름)의 경로를 안내할게요. 이동 장소는 총 (경유지수) 곳입니다. 안내를 시작할까요?"
  // 내가 누른 경로의 데이터(이름, 경유지, 지도 좌표)를 즉시 동기화하고 활성화!
  // =========================================================================
  const handleSelectRoute = async (route: SavedRoute) => {
    const now = Date.now();
    lastSyncedAtRef.current = now;
    lastRouteIdRef.current = route.id;
    setSelectedRoute(route);
    selectedRouteRef.current = route;
    routeStopsRef.current = route.stops || [];
    setCurrentStopIndex(0);
    setCarStep('briefing');
    setDriverVoiceLog(null);

    // 1) 상위 App 컴포넌트의 activeRoute도 사용자가 선택한 루트로 즉시 갱신
    if (onUpdatePlan) {
      onUpdatePlan({ ...currentPlanRef.current, activeRoute: route });
    }

    // 2) 백엔드 /api/routes/sync 에도 차량에서 선택된 루트를 즉시 동기화 (POST)
    try {
      await fetch('/api/routes/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vin: currentPlan.carPlateNumber,
          route: route
        })
      });
    } catch (e) {
      console.warn('Failed to sync selected route to backend:', e);
    }

    // 3) 음성 브리핑 출력
    const speechMessage = `${route.title}의 경로를 안내할게요. 이동 장소는 총 ${route.stops.length} 곳입니다. 안내를 시작할까요?`;
    setAiResponseText(speechMessage);
    setIsSpeaking(true);

    // 실제 스피커로 한국어 음성 출력 (TTS)
    playKoreanTTS(speechMessage, () => {
      setIsSpeaking(false);
    });

    setTimeout(() => {
      setIsSpeaking(false);
    }, 6000);
  };



  // 위치 기반 다음 장소 자동 이동 시뮬레이션
  const handleSimulateArrivalAndNext = () => {
    if (currentStopIndex < routeStops.length - 1) {
      const arrivedName = currentStop.name;
      const nextTarget = routeStops[currentStopIndex + 1];

      setAutoNaviAlert(`📍 '${arrivedName}' 주변 도착 감지!`);
      setIsSpeaking(true);
      const voiceMsg = `${arrivedName} 주변에 도착했습니다. 다음 목적지인 ${nextTarget.name}으로 순정 내비 경로를 자동 전환합니다.`;
      setAiResponseText(voiceMsg);
      playKoreanTTS(voiceMsg);

      setTimeout(() => {
        setCurrentStopIndex(prev => prev + 1);
        setIsSpeaking(false);
        setAutoNaviAlert(`✨ '${nextTarget.name}' 경로로 현대 내비게이션 자동 안내 시작!`);
        setTimeout(() => setAutoNaviAlert(null), 3000);
      }, 2500);
    } else {
      setAutoNaviAlert('🏁 모든 여정을 완주하셨습니다!');
      const finishMsg = '오늘 등록하신 모든 목적지에 성공적으로 도착했습니다. 안전운전 고생하셨습니다!';
      setAiResponseText(finishMsg);
      playKoreanTTS(finishMsg);
    }
  };

  return (
    <div className="w-full h-full bg-[#f8fafc] text-slate-900 font-sans flex flex-col justify-between overflow-hidden p-3 md:p-4 select-none">
      
      {/* ========================================================================= */}
      {/* [상단 헤더]: 투명 배경 카멜레온 로고 + CARmeleon 브랜드 (화이트톤 프리미엄) */}
      {/* ========================================================================= */}
      <header className="flex items-center justify-between pb-3 border-b border-slate-200/80 text-xs shrink-0">
        <div className="flex items-center gap-3">
          {/* 현대 카멜레온 공식 브랜드 로고 */}
          <img 
            src="/hyundai_chameleon_logo.png" 
            alt="HYUNDAI Chameleon" 
            className="h-8 md:h-9 object-contain drop-shadow-xs" 
          />
        </div>

        {carStep !== 'select' && (
          <button
            onClick={() => setCarStep('select')}
            className="text-xs text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-xl bg-white border border-slate-200/90 font-bold flex items-center gap-1.5 transition-all shadow-2xs hover:bg-slate-50 active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
            <span>목록으로</span>
          </button>
        )}
      </header>

      {/* ========================================================================= */}
      {/* [운전자가 '카멜레온~' 호출 시 즉각 반응하는 AI HUD 팝업 배너] */}
      {/* ========================================================================= */}
      {isAwake && (
        <div className="fixed top-14 inset-x-0 z-50 flex justify-center pointer-events-none animate-fadeIn">
          <div className="bg-white/95 backdrop-blur-xl border border-blue-400 px-5 py-2.5 rounded-2xl shadow-xl flex items-center gap-3 text-slate-900">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white font-bold shadow-md text-sm">
              🦎
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xs text-blue-700">"카멜레온" 호출 감지됨!</span>
                <span className="text-[9px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold animate-pulse">즉시 반응</span>
              </div>
              <p className="text-xs text-slate-800 font-semibold mt-0.5">
                {aiResponseText || '네! 부르셨어요? 말씀하세요, 카멜레온이 듣고 있어요.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1단계 시작화면: 화이트톤 세련된 현대/제네시스 ccNC 콕핏 스타일 */}
      {/* - 좌측 (5열): 차량의 현재 위치 3D 디지털 트윈 (화이트 스튜디오 쇼룸) */}
      {/* - 우측 (7열): 정갈한 화이트 카드 추천 드라이브 코스 */}
      {/* ========================================================================= */}
      {carStep === 'select' && (
        <div className="flex-1 flex flex-col min-h-0 py-2.5 animate-fadeIn h-full overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch h-full min-h-0">
            
            {/* 좌측 (5열): 차량의 현재 위치를 모델링한 3D 디지털 트윈 (실시간 위치 & 지도 연동) */}
            <div className="md:col-span-5 h-full min-h-0">
              <VehicleLocationModel3D
                vehicleInfo={vehicleInfo}
                coords={currentCoords}
                buildingName={currentBuilding}
                locationName={currentAddress}
                speedKmh={vehicleSpeed}
              />
            </div>

            {/* 우측 (7열): 루트 따라가기 헤더 + 오늘/지난 루트 탭 및 대형 카드 목록 */}
            <div className="md:col-span-7 flex flex-col justify-start h-full min-h-0 px-1 py-1 space-y-3">
              
              {/* 상단 단일 토글 버튼: [지난 루트] ↔ [등록된 루트] */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 shrink-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${routeViewTab === 'today' ? 'bg-blue-600' : 'bg-purple-600'}`}></span>
                  <span className="text-xs font-black text-slate-800 tracking-tight">
                    {routeViewTab === 'today' ? '등록된 추천 드라이브 코스' : '지난 주행 기록'}
                  </span>
                </div>

                {/* 단일 토글 버튼 */}
                <button
                  type="button"
                  onClick={() => setRouteViewTab(routeViewTab === 'today' ? 'history' : 'today')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border shadow-2xs active:scale-95 ${
                    routeViewTab === 'today'
                      ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90'
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200/80'
                  }`}
                >
                  {routeViewTab === 'today' ? (
                    <>
                      <FolderOpen className="w-3.5 h-3.5 text-purple-600" />
                      <span>지난 루트</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
                      <span>등록된 루트</span>
                    </>
                  )}
                </button>
              </div>

              {/* 1) 등록된 추천 루트 목록 (고정된 카드 크기 & 화이트톤 카드) */}
              {routeViewTab === 'today' && (
                <div className="flex-1 flex flex-col justify-start gap-3 overflow-y-auto pr-1 min-h-0">
                  {todayRoutes.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-3xl p-6 bg-white/50">
                      오늘 등록된 추천 루트가 없습니다.<br />
                      스마트폰 앱에서 새 계획 루트를 전송해 보세요!
                    </div>
                  ) : (
                    todayRoutes.map((route, idx) => {
                      const summaryPath = route.stops.map(s => s.name).join(' → ') || '경유지 없음';

                      return (
                        <button
                          key={route.id}
                          onClick={() => handleSelectRoute(route)}
                          className="w-full h-[96px] min-h-[96px] max-h-[96px] px-5 py-3 rounded-2xl border text-left transition-all flex items-center justify-between gap-4 group active:scale-[0.99] bg-white hover:bg-blue-50/30 border-slate-200/90 hover:border-blue-500/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:shadow-md shrink-0"
                        >
                          <div className="space-y-1 flex-1 min-w-0 pr-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/70 tracking-tight">
                                루트 {idx + 1}
                              </span>
                              <span className="text-xs font-bold text-blue-600 tracking-tight">{route.date}</span>
                              <span className="text-xs text-slate-300">|</span>
                              <span className="text-xs font-medium text-slate-400 tracking-tight">총 {route.stops.length}개 경유지</span>
                            </div>
                            
                            <h4 className="font-extrabold text-base md:text-[17px] text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors truncate">
                              {route.title}
                            </h4>

                            <p className="text-xs text-slate-500 font-medium tracking-tight truncate flex items-center gap-1.5">
                              <span className="text-blue-600 shrink-0">📍</span>
                              <span className="truncate">{summaryPath}</span>
                            </p>
                          </div>

                          <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-slate-100 group-hover:bg-blue-600 text-slate-600 group-hover:text-white flex items-center justify-center shrink-0 transition-all shadow-2xs group-hover:scale-105 border border-slate-200/80 group-hover:border-transparent">
                            <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {/* 2) 지난 루트 보관함 (과거 완료된 날짜의 코스 불러오기) */}
              {routeViewTab === 'history' && (
                <div className="flex-1 flex flex-col justify-start gap-3 overflow-y-auto pr-1 min-h-0 animate-fadeIn">
                  {pastRoutesList.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-3xl p-6 bg-white/50">
                      지난 주행 기록이 없습니다.
                    </div>
                  ) : (
                    pastRoutesList.map((route, idx) => {
                      const summaryPath = route.stops.map(s => s.name).join(' → ') || '경유지 없음';

                      return (
                        <button
                          key={route.id}
                          onClick={() => handleSelectPastRoute(route)}
                          className="w-full h-[96px] min-h-[96px] max-h-[96px] px-5 py-3 rounded-2xl border text-left transition-all flex items-center justify-between gap-4 group active:scale-[0.99] bg-white hover:bg-purple-50/30 border-purple-200/80 hover:border-purple-400 shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:shadow-md shrink-0"
                        >
                          <div className="space-y-1 flex-1 min-w-0 pr-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200/80 tracking-tight">
                                과거 이력 {idx + 1}
                              </span>
                              <span className="text-xs font-bold text-purple-600 tracking-tight">{route.date}</span>
                              <span className="text-xs text-slate-300">|</span>
                              <span className="text-xs font-medium text-slate-400 tracking-tight">총 {route.stops.length}개 경유지</span>
                            </div>
                            
                            <h4 className="font-extrabold text-base md:text-[17px] text-slate-900 tracking-tight group-hover:text-purple-700 transition-colors truncate">
                              {route.title}
                            </h4>

                            <p className="text-xs text-slate-500 font-medium tracking-tight truncate flex items-center gap-1.5">
                              <span className="text-purple-600 shrink-0">📍</span>
                              <span className="truncate">{summaryPath}</span>
                            </p>
                          </div>

                          <div className="px-3.5 py-2 rounded-xl bg-purple-50 group-hover:bg-purple-600 text-purple-700 group-hover:text-white border border-purple-200 font-bold text-xs flex items-center gap-1.5 transition-all shrink-0 shadow-2xs">
                            <span>불러오기</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* [사용자 손그림 스케치 완벽 반영 4분할 화면]: */}
      {/* - 좌측 상단: 출발지점부터 목적지별 전체 경로 크게 띄우기 (RouteOverviewNaviMap) */}
      {/* - 좌측 하단: 경유지 목록 (3개 이하면 3칸 가득 채우고, 3개 초과 시 슬라이드 스크롤) */}
      {/* - 우측 상단: 카멜레온 뒤뚱거리는 영상 무한반복 (아이콘/오버레이 일체 삭제, 깔끔한 전면 영상) */}
      {/* - 우측 하단: 거대한 "주행 시작하기" 버튼 + 네/아니오/수정 음성 대기 인터랙션 */}
      {/* ========================================================================= */}
      {carStep === 'briefing' && (
        <div className="flex-1 flex flex-col min-h-0 py-1 space-y-2.5 animate-fadeIn h-full overflow-hidden">
          
          {/* 상단 액션바: 뒤로가기 */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 shrink-0">
            <button
              onClick={() => {
                const rejectMsg = '다른 루트를 선택해주세요!';
                setAiResponseText(rejectMsg);
                setIsSpeaking(true);
                playKoreanTTS(rejectMsg);
                setTimeout(() => {
                  setIsSpeaking(false);
                  setCarStep('select');
                }, 1000);
              }}
              className="text-xs font-bold text-slate-700 hover:text-slate-900 flex items-center gap-1.5 transition-all px-3 py-1.5 rounded-xl bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 active:scale-95"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-blue-600" />
              <span>다른 루트 선택</span>
            </button>
          </div>

          {/* 좌우 2열 분할 레이아웃: 좌측(지도+경유지) / 우측(대형 카멜레온 영상 + 주행 시작하기) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0 h-full overflow-hidden">
            
            {/* [좌측 열]: 전체 경로 지도 (100% 풀사이즈 단독 배치) */}
            <div className="h-full min-h-0 rounded-3xl overflow-hidden border border-slate-200/90 shadow-sm bg-white relative flex flex-col">
              <RouteOverviewNaviMap stops={routeStops} routeTitle={selectedRoute.title} />
            </div>

            {/* [우측 열]: 카멜레온 대형 영상 (넓은 자리 차지) + 하단 [주행 시작하기] 단독 배치 */}
            <div className="flex flex-col gap-3.5 h-full min-h-0 overflow-hidden">
              
              {/* 3. [우측 상단]: 카멜레온 뒤뚱거리는 영상 무한반복 (화이트 스튜디오 스테이지) */}
              <div className="flex-1 min-h-0 rounded-3xl overflow-hidden border border-slate-200/90 shadow-sm bg-gradient-to-b from-slate-50 via-white to-slate-100/60 flex items-center justify-center relative">
                {/* 비디오 첫 프레임 로딩 전 부드러운 플레이스홀더 */}
                {!isVideoLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-0">
                    <img 
                      src="/chameleon_nobg.png" 
                      alt="Chameleon" 
                      className="w-1/2 h-1/2 object-contain opacity-75 animate-pulse" 
                    />
                  </div>
                )}

                <video
                  ref={(el) => {
                    if (el) {
                      el.muted = true;
                      el.play().catch(() => {});
                    }
                  }}
                  src="/chameleon_walking.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                  disableRemotePlayback
                  onPlaying={() => setIsVideoLoaded(true)}
                  className={`w-full h-full object-cover relative z-10 transition-opacity duration-300 ${
                    isVideoLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ pointerEvents: 'none' }}
                />

                {/* 카멜레온 음성 안내 중이거나 운전자 음성 감지 시 깔끔한 하단 플로팅 자막 */}
                {isSpeaking && (
                  <div className="absolute bottom-4 left-6 right-6 p-3.5 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 text-center animate-fadeIn shadow-xl">
                    <p className="text-xs md:text-sm font-black text-slate-900 leading-snug">
                      "{aiResponseText || `${selectedRoute.title}의 경로를 안내할게요. 이동 장소는 총 ${routeStops.length}곳입니다. 안내를 시작할까요?`}"
                    </p>
                  </div>
                )}
                {driverVoiceLog && !isSpeaking && (
                  <div className="absolute bottom-4 left-6 right-6 p-3.5 rounded-2xl bg-white/95 backdrop-blur-md border border-emerald-300 text-center animate-fadeIn shadow-xl">
                    <p className="text-xs md:text-sm font-bold text-emerald-700 truncate">
                      🎤 "{driverVoiceLog}"
                    </p>
                  </div>
                )}
              </div>

              {/* 4. [우측 하단]: 단독으로 큼직하게 배치된 [주행 시작하기] 버튼 */}
              <div className="shrink-0 pt-1">
                <button
                  onClick={() => {
                    const confirmMsg = `첫 번째 목적지인 ${currentStop.name}으로 안내를 시작합니다.`;
                    setAiResponseText(confirmMsg);
                    setIsSpeaking(true);
                    // Pleos 순정 NaviHelper 호출 (실제 차량 내비게이션 경로 전송 및 분할 화면 실행)
                    triggerPleosNaviHelper(0);
                    playKoreanTTS(confirmMsg, () => {
                      setIsSpeaking(false);
                      setCarStep('driving');
                    });
                    setTimeout(() => {
                      setIsSpeaking(false);
                      setCarStep('driving');
                    }, 4500);
                  }}
                  className="w-full h-20 md:h-24 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white font-black text-xl md:text-2xl shadow-xl shadow-blue-500/25 flex items-center justify-center gap-3 transition-all hover:scale-[1.01] hover:brightness-105 active:scale-[0.99] border-2 border-white/40 tracking-wider"
                >
                  <Navigation className="w-7 h-7 md:w-8 md:h-8 fill-current" />
                  <span>주행 시작하기</span>
                  <ArrowRight className="w-6 h-6 md:w-7 md:h-7" />
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* [Pleos 순정 NaviHelper & 카멜레온 차량 전용 주행 화면]: */}
      {/* - 실제 차량: OS가 순정 내비를 옆 화면에 띄우므로, CARmeleon은 전용 주행 비서 UI만 단독 표시 */}
      {/* - 브라우저 테스트: 토글을 통해 Leaflet 내비 시뮬레이션 지도도 프리뷰 가능 */}
      {/* ========================================================================= */}
      {carStep === 'driving' && (
        <div className="flex-1 flex flex-col justify-between py-1 space-y-2 animate-fadeIn h-full min-h-0 overflow-hidden">
          
          {/* 상단: 현대차 Pleos OS 시스템 상태 표시줄 */}
          <div className="flex items-center justify-between px-3.5 py-2 bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/90 text-[11px] text-slate-600 shrink-0 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="font-black text-blue-600">Pleos NaviHelper 연동 활성화</span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-700 font-bold hidden sm:inline">
                순정 내비게이션 주행 경로 안내 중 (Adjacent Dual Window)
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* 브라우저 테스트용 내비 프리뷰 전환 토글 */}
              <button
                type="button"
                onClick={() => setDrivingLayoutMode(drivingLayoutMode === 'carmeleon_only' ? 'preview_split' : 'carmeleon_only')}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold border border-slate-200/90 transition-colors shadow-2xs"
                title="실제 차량에서는 Pleos 순정 내비가 독립 실행되며, 브라우저에서는 시뮬레이션 지도를 확인해 볼 수 있습니다"
              >
                {drivingLayoutMode === 'carmeleon_only' ? '🖥️ 브라우저 내비 지도 프리뷰' : '🚘 차량 전용 단독 UI'}
              </button>

              <button 
                onClick={() => setCarStep('select')}
                className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-[10px] font-bold border border-rose-200 transition-colors shadow-2xs"
                title="주행 안내 종료"
              >
                ✕ 안내 종료
              </button>
            </div>
          </div>

          {/* 메인 본문: 차량 전용 단독 UI (carmeleon_only) vs 브라우저 분할 프리뷰 (preview_split) */}
          {drivingLayoutMode === 'carmeleon_only' ? (
            <div className="flex-1 flex gap-3 h-full min-h-0 overflow-hidden">
              
              {/* 좌측 패널 (flex-[6]): 목적지 히어로 & AI 3줄 브리핑 & 음성 상시 대화 */}
              <div className="flex-[6] bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
                
                {/* ========================================================================= */}
                {/* [긴급 HUD 1: 저배터리 스마트 EV 충전소 제안 배너] */}
                {/* ========================================================================= */}
                {batteryAlertState === 'prompting' && (
                  <div className="p-3.5 mb-2 rounded-2xl bg-gradient-to-r from-amber-50 via-white to-orange-50 border-2 border-amber-400 shadow-md animate-fadeIn shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 border border-amber-300 flex items-center justify-center font-black text-xl animate-bounce shrink-0 shadow-xs">
                          ⚡
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-amber-950">저배터리 감지 (잔량 {vehicleInfo.batteryPercent}% · 주행 가능 {vehicleInfo.remainingRangeKm}km)</span>
                            <span className="text-[10px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-black animate-pulse">충전 권장</span>
                          </div>
                          <p className="text-xs text-slate-800 font-bold mt-0.5 truncate">
                            가까운 충전소: <span className="text-blue-600 font-extrabold">{recommendedEVCharger.name}</span> ({recommendedEVCharger.distanceKm}km / {recommendedEVCharger.durationMin}분 소요)
                          </p>
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            🗣️ 음성으로 <strong>"응, 네, 어, 예"</strong> 또는 <strong>"나중에"</strong>라고 말씀하세요.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => confirmEVChargingNav(recommendedEVCharger)}
                          className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-black text-xs hover:brightness-105 shadow-sm active:scale-95 flex items-center gap-1"
                        >
                          <span>⚡ 충전소 안내 ("응/네")</span>
                        </button>
                        <button
                          type="button"
                          onClick={dismissLowBatteryPrompt}
                          className="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs border border-slate-200 active:scale-95"
                        >
                          <span>⏱️ 나중에</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* [긴급 HUD 1-B: 전기차 충전소 이동 중] */}
                {batteryAlertState === 'charging_nav' && (
                  <div className="p-3 mb-2 rounded-2xl bg-gradient-to-r from-blue-50 via-white to-cyan-50 border border-blue-200 shadow-xs animate-fadeIn shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-lg animate-spin text-blue-600">⚡</span>
                        <div className="min-w-0">
                          <span className="text-xs font-black text-blue-700 block truncate">
                            {recommendedEVCharger.name}으로 이동 중
                          </span>
                          <span className="text-[10px] text-slate-600 block truncate">
                            충전 완료 후 기존 목적지({savedDestinationBeforeCharging?.stop.name || '원래 목적지'})로 자동 연속 안내됩니다.
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBatteryAlertState('charging_active')}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 text-white font-black text-xs hover:bg-blue-700 active:scale-95 shrink-0 shadow-xs"
                      >
                        <span>🔋 충전소 도착 & 충전 시작</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* [긴급 HUD 1-C: 충전 완료 & 재탑승 시 기존 목적지 자동 연속 안내] */}
                {batteryAlertState === 'charging_active' && (
                  <div className="p-3.5 mb-2 rounded-2xl bg-gradient-to-r from-emerald-50 via-white to-teal-50 border-2 border-emerald-400 shadow-md animate-fadeIn shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 border border-emerald-300 flex items-center justify-center font-black text-xl animate-pulse shrink-0 shadow-xs">
                          🔋
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-emerald-900">고전압 배터리 85% 충전 완료 (주행 가능 392km)</span>
                            <span className="text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-black animate-bounce">재탑승 감지</span>
                          </div>
                          <p className="text-xs text-slate-800 font-bold mt-0.5 truncate">
                            기존 목적지인 <span className="text-blue-600 font-black">[{savedDestinationBeforeCharging?.stop.name || currentStop.name}]</span> 경로를 계속 이어서 안내합니다.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={completeChargingAndResumeDestination}
                        className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black text-xs hover:brightness-105 shadow-md active:scale-95 shrink-0 flex items-center gap-1.5"
                      >
                        <span>🚗 기존 목적지 이어서 주행</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* [긴급 HUD 2: 운전자 화장실 / 휴게소 긴급 경유지 제안 배너] */}
                {/* ========================================================================= */}
                {restroomAlertState.isOpen && (
                  <div className="p-3.5 mb-2 rounded-2xl bg-gradient-to-r from-teal-50 via-white to-cyan-50 border-2 border-teal-300 shadow-md animate-fadeIn shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-700 border border-teal-300 flex items-center justify-center font-black text-xl shrink-0 shadow-xs">
                          🚾
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-teal-900">긴급 화장실 / 휴게소 탐색 완료</span>
                            <span className="text-[10px] bg-teal-600 text-white px-2 py-0.5 rounded-full font-black">
                              {restroomAlertState.spot?.durationMin || 2}분 소요
                            </span>
                          </div>
                          <p className="text-xs text-slate-800 font-bold mt-0.5 truncate">
                            <span className="text-blue-600 font-extrabold">{restroomAlertState.spot?.name || '판교IC 졸음쉼터 화장실'}</span> ({restroomAlertState.spot?.distanceKm || 1.1}km · {restroomAlertState.spot?.detail || '24시간 개방'})
                          </p>
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            🗣️ 음성으로 <strong>"응, 네, 어, 예"</strong>라고 말씀하시면 첫 번째 경유지로 즉시 추가됩니다.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={confirmRestroomWaypoint}
                          className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-black text-xs hover:brightness-105 shadow-sm active:scale-95 flex items-center gap-1"
                        >
                          <span>🚾 경유지 추가 ("응/네")</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRestroomAlertState({ isOpen: false, spot: null })}
                          className="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs border border-slate-200 active:scale-95"
                        >
                          <span>닫기</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 1. 현재 목적지 진행 배너 (자율 가이드 모드 vs 일반 목적지 모드) */}
                {isAutonomousGuide ? (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50/50 to-white border border-emerald-200/90 flex items-center justify-between shrink-0 shadow-xs">
                    <div className="space-y-1 min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px] border border-emerald-300 flex items-center gap-1 animate-pulse">
                          <Sparkles className="w-3 h-3 fill-current" />
                          실시간 자율 여행 가이드 (자유 주행 모드)
                        </span>
                        <span className="text-[11px] text-teal-700 font-bold">
                          GPS 추적 활성화
                        </span>
                      </div>
                      <h2 className="text-lg md:text-xl font-black text-slate-900 flex items-center gap-2 truncate">
                        <span>{autonomousSpot?.title || '차량 위치 기반 자율 가이드'}</span>
                      </h2>
                      <p className="text-[11px] text-emerald-800 font-bold truncate">
                        📍 {autonomousSpot?.locationName || '현재 주행 도로 및 주변 랜드마크 실시간 탐색 중'}
                      </p>
                    </div>

                    {/* 다음 명소 해설 버튼 */}
                    <button
                      type="button"
                      onClick={() => fetchNextAutonomousSpot(true)}
                      className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:brightness-105 text-white font-black text-xs shadow-md shadow-emerald-500/15 flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 shrink-0"
                    >
                      <span>다음 명소 이야기</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-r from-blue-50/90 via-slate-50 to-indigo-50/40 border border-blue-200/80 flex items-center justify-between shrink-0 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-extrabold text-[10px] border border-blue-200">
                          {currentStop.type === 'business' ? '💼 비즈니스 미팅' : '🌊 드라이브 명소'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-bold">
                          경유지 {currentStopIndex + 1} / {routeStops.length}
                        </span>
                      </div>
                      <h2 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2">
                        <span>{currentStop.name}</span>
                        <span className="text-xs font-bold text-blue-700 bg-white px-2.5 py-0.5 rounded-lg border border-blue-200 shadow-2xs">
                          {currentStop.time} 예정
                        </span>
                      </h2>
                    </div>

                    {/* 도착 완료 & 다음 목적지 버튼 */}
                    <button
                      onClick={handleSimulateArrivalAndNext}
                      className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:brightness-105 text-white font-black text-xs shadow-md shadow-blue-500/15 flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95"
                    >
                      <span>도착 & 다음 경유지</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* 2. AI 주행 안전 브리핑 카드 (자율 가이드 vs 목적지 브리핑) */}
                {isAutonomousGuide ? (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-emerald-200/70 space-y-3 my-2 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-black text-emerald-800">
                        <Sparkles className="w-4 h-4 text-emerald-600 animate-spin" />
                        <span>🎙️ 카멜레온의 실시간 랜드마크 해설 ({autonomousSpot?.theme || '실시간 위치 가이드'})</span>
                      </span>
                      <button
                        onClick={() => {
                          const speech = autonomousSpot?.speechText || '카멜레온 자율 가이드예요! 편안한 드라이브 되세요.';
                          setIsSpeaking(true);
                          playKoreanTTS(speech);
                          setTimeout(() => setIsSpeaking(false), 3500);
                        }}
                        className="px-3 py-1 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 text-emerald-700 border border-emerald-200 flex items-center gap-1 transition-colors shadow-2xs"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>해설 다시 듣기</span>
                      </button>
                    </div>

                    <p className="text-xs md:text-sm text-slate-800 font-semibold leading-relaxed bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                      "{autonomousSpot?.speechText || '카멜레온이 차량 FusedLocation GPS를 실시간 분석하여 지나치는 도로와 랜드마크의 설화와 관광 정보를 들려드립니다.'}"
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-700 flex items-center gap-2 shadow-2xs">
                        <span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold flex items-center justify-center text-[10px] shrink-0">
                          💡
                        </span>
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-500 block font-bold">알아두면 재미있는 상식</span>
                          <span className="truncate block font-semibold text-slate-900">{autonomousSpot?.trivia || '판교는 널빤지로 만든 다리에서 유래했어요.'}</span>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-700 flex items-center gap-2 shadow-2xs">
                        <span className="w-5 h-5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 font-bold flex items-center justify-center text-[10px] shrink-0">
                          🎵
                        </span>
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-500 block font-bold">드라이브 추천 음악</span>
                          <span className="truncate block font-semibold text-blue-600">{autonomousSpot?.recommendedBgm || '유키카 - SOUL LADY'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 my-2 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-black text-blue-800">
                        <Sparkles className="w-4 h-4 text-blue-600" />
                        <span>{currentStop.type === 'business' ? '💼 비즈니스 핵심 자료 브리핑' : '🌊 여행지 명소 설화 & 썰'}</span>
                      </span>
                      <button
                        onClick={() => {
                          const briefingMsg = currentStop.aiBriefing?.contextStory || currentStop.memo || (
                            currentStop.type === 'business'
                              ? `${currentStop.name} 미팅 관련 핵심 자료 브리핑입니다. 안건 및 제휴 조건을 확인하세요.`
                              : `운전자님, 전방 2시 방향을 잠시 보세요! ${currentStop.name}의 역사와 숨은 명소 이야기입니다.`
                          );
                          setIsSpeaking(true);
                          playKoreanTTS(briefingMsg);
                          setTimeout(() => setIsSpeaking(false), 4500);
                        }}
                        className="px-3 py-1 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 text-blue-700 border border-blue-200 flex items-center gap-1 transition-colors shadow-2xs"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>음성 듣기</span>
                      </button>
                    </div>

                    <p className="text-xs md:text-sm text-slate-800 font-medium leading-relaxed bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                      {currentStop.aiBriefing?.contextStory || currentStop.memo || (
                        currentStop.type === 'business'
                          ? (currentStop.attachedFile 
                              ? `방금 첨부하신 [${currentStop.attachedFile}] 문서를 AI가 분석했습니다. 핵심 3줄: 1) 파트너사 제휴 안건 2) 납기 일정 조율 3) Q&A 대비사항을 숙지하세요!`
                              : `'${currentStop.name}' 미팅 10분 전입니다. 핵심 안건과 계약 서류를 미리 챙겨주세요!`)
                          : `운전자님, 전방 2시 방향을 잠시 보세요! ${currentStop.name}의 역사와 명소 이야기입니다.`
                      )}
                    </p>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {currentStop.aiBriefing?.summaryPoints?.slice(0, 2).map((pt, i) => (
                        <div key={i} className="p-2 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-700 flex items-center gap-2 shadow-2xs">
                          <span className="w-4 h-4 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-bold flex items-center justify-center text-[10px] shrink-0">
                            {i + 1}
                          </span>
                          <span className="truncate">{pt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. 상시 음성 STT & Gemini 대화 로그 */}
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 shrink-0 shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shrink-0"></div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {driverVoiceLog ? `🎤 "${driverVoiceLog}"` : '상시 음성 대기 중 ("카멜레온~"으로 호출)'}
                      </p>
                      {aiResponseText && (
                        <p className="text-[11px] text-blue-600 truncate font-semibold">🤖 AI: {aiResponseText}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleVoiceInput('카멜레온 가이드 호출해줘')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all shadow-2xs ${
                        isAutonomousGuide 
                          ? 'bg-emerald-600 text-white animate-pulse' 
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}
                      title="실시간 자율 여행 가이드 발화 시뮬레이션"
                    >
                      🧭 "가이드 호출해줘"
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVoiceInput('카멜레온')}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black text-[11px] shadow-2xs"
                    >
                      🗣️ "카멜레온~"
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVoiceInput('카멜레온 노래 틀어줘')}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] border border-slate-200 shadow-2xs"
                    >
                      🎵 노래
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerLowBatteryFlow(18)}
                      className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-[11px] border border-amber-200 flex items-center gap-1 active:scale-95 shadow-2xs"
                      title="배터리 18% 저배터리 상황 및 충전소 제안 시뮬레이션"
                    >
                      ⚡ 저배터리
                    </button>
                    <button
                      type="button"
                      onClick={triggerRestroomFlow}
                      className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-[11px] border border-teal-200 flex items-center gap-1 active:scale-95 shadow-2xs"
                      title="화장실 / 휴게소 긴급 요청 시뮬레이션"
                    >
                      🚾 "화장실 급해"
                    </button>
                  </div>
                </div>

              </div>

              {/* 우측 패널 (flex-[4]): 카멜레온 3D 영상 & 전체 경유지 타임라인 / 자율 가이드 모니터 & 음악 */}
              <div className="flex-[4] bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
                
                {/* 3D 카멜레온 모션 캐릭터 */}
                <div className="relative rounded-2xl overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100/70 border border-slate-200/80 flex items-center justify-center h-44 shrink-0 shadow-inner">
                  <video
                    src="/chameleon_walking.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-white/90 backdrop-blur-md border border-blue-200/80 text-[10px] font-black text-blue-700 flex items-center gap-1.5 shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
                    <span>{isAutonomousGuide ? '✨ 실시간 자율 가이드 동승 중' : 'AI 안전 가이드 동승 중'}</span>
                  </div>
                </div>

                {/* 전체 경유지 진행 타임라인 or 실시간 자율 가이드 계기판 */}
                {isAutonomousGuide ? (
                  <div className="flex-1 my-2 overflow-y-auto space-y-2 pr-1">
                    <div className="text-[11px] font-bold text-emerald-800 px-1 pb-1 border-b border-emerald-200 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Sparkles className="w-3 h-3 fill-current" />
                        자율 주행 가이드 모니터
                      </span>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">LIVE</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-emerald-200/70 space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">실시간 GPS 좌표</span>
                        <span className="font-mono font-bold text-blue-600">
                          {currentCoordRef.current.lat.toFixed(4)}, {currentCoordRef.current.lng.toFixed(4)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">차량 주행 속도</span>
                        <span className="font-mono font-bold text-emerald-600">{vehicleSpeed} km/h</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">오디오 안전 제어</span>
                        <span className="text-blue-600 font-bold">Safety-Aware 감시 중</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200/70 text-xs space-y-1">
                      <span className="text-[10px] font-bold text-emerald-800 block">💡 자율 모드 안내</span>
                      <p className="text-[11px] text-slate-700 leading-snug">
                        운전자는 좌측 순정 내비를 보며 운전하시고, 카멜레온이 실시간 차량 위치를 따라 주변 관광 썰과 음악을 자동으로 해설합니다.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => triggerAutonomousGuide(false)}
                      className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-rose-200 text-rose-600 text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-2xs"
                    >
                      <span>자율 가이드 끄기</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 my-2 overflow-y-auto space-y-1.5 pr-1">
                    <div className="text-[11px] font-bold text-slate-500 px-1 pb-1 border-b border-slate-200 flex items-center justify-between">
                      <span>전체 여정 경유지</span>
                      <span className="text-blue-600 font-black">{currentStopIndex + 1} / {routeStops.length} 완료</span>
                    </div>
                    {routeStops.map((stop, idx) => {
                      const isDone = idx < currentStopIndex;
                      const isCurrent = idx === currentStopIndex;
                      return (
                        <div
                          key={idx}
                          className={`p-2 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                            isCurrent
                              ? 'bg-blue-50/80 border-blue-300 text-slate-900 font-bold shadow-2xs'
                              : isDone
                              ? 'bg-slate-50 border-slate-200/60 text-slate-400'
                              : 'bg-white border-slate-200/90 text-slate-700 shadow-2xs'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                              isCurrent
                                ? 'bg-blue-600 text-white'
                                : isDone
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}>
                              {isDone ? '✓' : idx + 1}
                            </span>
                            <span className="truncate">{stop.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 shrink-0">{stop.time}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 하단 음악 플레이어 컨트롤바 */}
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs shrink-0">
                  <div className="flex items-center gap-2 text-slate-600 text-[11px]">
                    <Music className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
                    <span className="truncate font-medium">
                      {isMusicPlaying ? '드라이브 음악 재생 중 🎵' : '음성으로 "노래 틀어줘" 가능'}
                    </span>
                  </div>
                  <button
                    onClick={() => setIsMusicPlaying(!isMusicPlaying)}
                    className="text-[11px] font-bold text-blue-600 hover:underline"
                  >
                    {isMusicPlaying ? '음악 끄기' : '노래 틀기'}
                  </button>
                </div>

              </div>
            </div>
          ) : (
            /* preview_split 모드: 브라우저 개발자용 분할 프리뷰 */
            <div className="flex-1 flex gap-2 h-full min-h-0 overflow-hidden">
              <div className="flex-[6] bg-white rounded-2xl border border-slate-200/90 shadow-md flex flex-col overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-blue-600 text-white font-black flex items-center justify-center text-[10px] shadow-sm">H</div>
                    <span className="font-black text-slate-800 text-xs">현대 순정 내비게이션 (ccNC / Pleos Navi 시뮬레이션)</span>
                  </div>
                  <button onClick={() => setDrivingLayoutMode('carmeleon_only')} className="text-blue-600 text-[10px] font-bold hover:underline">
                    차량 단독 뷰로 전환
                  </button>
                </div>
                <div className="flex-1 w-full h-full relative">
                  <HyundaiRealNaviMap
                    currentStop={currentStop}
                    nextStop={nextStop}
                    currentStopIndex={currentStopIndex}
                    totalStops={routeStops.length}
                    onArrivalNext={handleSimulateArrivalAndNext}
                    autoAlert={autoNaviAlert}
                  />
                </div>
              </div>

              <div className="flex-[4] bg-white rounded-2xl border border-slate-200/90 shadow-md flex flex-col justify-between overflow-hidden p-4">
                <div className="space-y-3">
                  <h4 className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                    <span>AI 안전 주행 브리핑</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  </h4>
                  <p className="text-xs text-blue-600 font-bold">목적지: {currentStop.name}</p>
                  <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
                    {currentStop.aiBriefing?.contextStory || currentStop.memo || (
                      currentStop.type === 'business'
                        ? `'${currentStop.name}' 미팅 10분 전입니다. 핵심 안건과 계약 서류를 미리 챙겨주세요!`
                        : `운전자님, 전방 2시 방향을 잠시 보세요! ${currentStop.name}의 역사와 명소 이야기입니다.`
                    )}
                  </p>
                </div>
                <button
                  onClick={handleSimulateArrivalAndNext}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs shadow-sm transition-all"
                >
                  다음 목적지로 이동
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* Google Gemini 1.5 Flash API 연동 모달 */}
      {isGeminiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Google Gemini 1.5 Flash 연동</h3>
                  <p className="text-xs text-slate-500">자연어 음성 인식 & 경로 지능형 자동 수정</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setIsGeminiModalOpen(false); setGeminiSaveMsg(null); }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
              <p>
                제미나이 API 키를 등록하면, 운전자의 자연스러운 음성 명령(예: <span className="text-blue-600 font-bold">"친구 잠깐 태워야 해서 판교역 들렀다 가자"</span>, <span className="text-amber-600 font-bold">"중간에 밥 먹을 만한 맛집 하나 넣어줘"</span>)을 Gemini AI가 알아듣고 경로를 수정해 드립니다.
              </p>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span className="font-bold">연동 상태:</span>
                  <span className={hasGeminiKey ? 'text-emerald-600 font-black' : 'text-amber-600 font-bold'}>
                    {hasGeminiKey ? '● 정상 연결됨 (Gemini 1.5 Flash 작동 중)' : '○ 미등록 (스마트 규칙 모드로 동작 중)'}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                  <span>Gemini API Key:</span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline text-[10px]"
                  >
                    Google AI Studio에서 무료 발급 ↗
                  </a>
                </label>
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-blue-500 focus:outline-none text-slate-900 text-xs font-mono"
                />
              </div>

              {geminiSaveMsg && (
                <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold text-center animate-fadeIn">
                  {geminiSaveMsg}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setIsGeminiModalOpen(false); setGeminiSaveMsg(null); }}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => handleSaveGeminiKey(geminiKeyInput)}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black shadow-md shadow-blue-500/20 active:scale-95 transition-all"
              >
                연동 저장하기
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
