import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowRight, 
  ArrowUpRight, 
  BatteryMedium, 
  Check, 
  ChevronDown, 
  Clock3, 
  Compass, 
  MapPin, 
  MessageCircle, 
  Mic, 
  MicOff,
  Navigation, 
  Radio,
  Route, 
  Utensils, 
  Volume2, 
  VolumeX, 
  X,
  FileText,
  Sun,
  Moon,
  Smartphone,
  Building2,
  Home,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  HelpCircle,
  Send,
  Bot,
  Columns
} from 'lucide-react';
import './legacyVehicle.css';
import { DailyPlan } from '../types';
import { PleosNaviScreen } from './PleosNaviScreen';
import {
  type ActiveDetour,
  type BrowserSpeechRecognition,
  type VoiceDetourCandidate,
  type VoiceTonePreset,
  configureCuteUtterance,
  extractPlaceSearchQuery,
  extractWakeCommand,
  findDetourCandidate,
  getSpeechRecognitionCtor,
  isBriefingUtterance,
  isCancelUtterance,
  isConfirmUtterance,
  isReboardUtterance,
  pickBestTranscriptAlternative,
  withRoParticle,
} from '../utils/voiceFlow';

export type Mode = 'work' | 'travel' | 'daily';
export type Appearance = 'light' | 'dark';

// 사용자가 핸드폰 앱에서 등록한 "카멜레온 미팅" 실제 3개 정차지 데이터
export interface MeetingStop {
  id: string;
  name: string;
  address: string;
  time: string;
  category: string;
  attachedFile: string;
  aiBriefingTitle: string;
  aiSpeechText: string;
  summaryPoints: string[];
}

export const meetingStopsData: MeetingStop[] = [
  {
    id: 'stop-yangjae',
    name: '현대자동차 양재 본사',
    address: '서울특별시 서초구 헌릉로 12',
    time: '13:30',
    category: '본사/사옥',
    attachedFile: 'Carmeleon_서비스_미팅자료.pptx',
    aiBriefingTitle: '헌릉로 진입 500m 전입니다.\n[Carmeleon_서비스_미팅자료.pptx] 핵심 알맹이 브리핑',
    aiSpeechText: '운전자님, 양재 본사 도착 10분 전입니다. 첨부하신 서비스 미팅자료의 핵심 내용만 짚어드릴게요. 첫째, 이번 미팅의 핵심 안건은 카멜레온 앱 탑재 시 월 8,900원 구독 모델 제안과 수익 7:3 배분 승인입니다. 둘째, 현대차 측에서 오프라인 데이터 보안을 집중 질문할 예정이니, 차량 주행 데이터는 차 안에서만 처리된다는 5페이지 보안 장표를 강조하세요. 셋째, 서관 지하 2층 VIP 주차구역이 배정되어 있습니다.',
    summaryPoints: [
      '💡 제휴 비즈니스 모델: 월 8,900원 구독 제안 및 현대차-카멜레온 7:3 수익 배분 안건 확정',
      '🔒 Q&A 대비 (5p 장표): 주행 데이터 외부 유출 없이 차 안에서만 처리되는 보안 아키텍처 강조',
      '🚗 도착 준비: 서관 지하 2층 VIP 주차구역 사전 등록 완료 (방문증 키오스크 1분 발급)'
    ]
  },
  {
    id: 'stop-namyang',
    name: '현대자동차 남양기술연구소',
    address: '경기도 화성시 남양읍 현대연구소로 150',
    time: '16:00',
    category: '연구소/R&D',
    attachedFile: 'Carmeleon_Pleos.pptx',
    aiBriefingTitle: '현대연구소로 진입 500m 전입니다.\n[Carmeleon_Pleos.pptx] R&D 기술 검증 브리핑',
    aiSpeechText: '운전자님, 남양연구소 진입 500m 전입니다. Pleos 기술 문서 요약입니다. 첫째, 고속 주행 소음 70dB 환경에서 호출어 인식률 94.2% 달성 시험 결과를 공유하고 마이크 우선권 로직을 협의합니다. 둘째, 터널 진입 시 GPS 단절을 관성 항법으로 보정하는 12페이지 로직을 확정해야 합니다. 셋째, 1게이트에서 노트북 보안 스티커를 부착해야 하니 5분 여유를 두세요.',
    summaryPoints: [
      '🎙️ 음성 인식 (8p): 주행 소음 70dB 환경에서 "카멜레온" 호출어 인식률 94.2% 실차 시험 데이터 공유',
      '🧭 내비 오차 보정 (12p): 터널/지하 진입 시 GPS 단절을 관성 센서로 오차 ±2m 이내 보정하는 규격 합의',
      '🛡️ 연구동 보안 절차: R&D 1게이트 사전 등록 완료 (노트북/스마트폰 카메라 보안 스티커 부착 필요)'
    ]
  },
  {
    id: 'stop-home',
    name: '집',
    address: '서울특별시 구로구 중앙로12길 12',
    time: '18:30',
    category: '귀가',
    attachedFile: '식단메모.txt',
    aiBriefingTitle: '동네 어귀 진입 500m 전입니다.\n퇴근길 리마인드 & 주차 현황',
    aiSpeechText: '운전자님, 오늘 양재 본사와 남양연구소 미팅 모두 수고하셨습니다. 곧 집에 도착합니다. 아파트 상가 마트에서 오늘 저녁 달걀과 신선 식품 타임 세일 중이고, 맡기신 세탁물이 무인함에 도착했습니다. 아파트 지하 2층 전기차 충전기 여유 있으니 바로 충전기에 주차하세요.',
    summaryPoints: [
      '🛒 장보기 리마인드: 아파트 상가 마트 오늘 저녁 신선 식품 20% 타임 세일 중',
      '🧺 세탁물 수령: 어제 맡기신 정장 드라이클리닝 완료 (20시 전 무인 택배함 3번)',
      '⚡ 충전 및 주차: 아파트 지하 2층 완속 충전기 4기 중 2기 여유 자리 확인'
    ]
  },
  {
    id: 'stop-suwon-hwaseong',
    name: '수원화성',
    address: '경기도 수원시 팔달구 정조로 910',
    time: '11:30',
    category: '여행 · 역사명소',
    attachedFile: '수원여행_코스_가이드.pdf',
    aiBriefingTitle: '수원화성 가는 길\n[수원화성] 거중기·오성지 비하인드 스토리',
    aiSpeechText: '지금 수원화성으로 달리고 있어요! 가는 길에 재미있는 비하인드 하나 들려드릴게요. 조선 정조대왕이 백성들과 함께 만든 수원화성은 원래 10년 걸릴 대공사였는데, 다산 정약용 선생이 도르래 원리로 발명한 거중기 덕분에 무려 2년 8개월 만에 완성됐대요! 또 숭례문보다 큰 북문 장안문 위엔 적군이 성문에 불을 지르면 위에서 물을 콸콸 쏟아 끄는 비밀 물탱크 오성지가 숨어 있답니다. 도착하면 화성행궁이나 창룡문 공영주차장에 대시고, 용연 연못 위 방화수류정에서 산책도 꼭 즐겨보세요!',
    summaryPoints: [
      '🏯 거중기의 기적: 정약용이 발명한 도르래 기중기로 10년 공사를 2년 8개월 만에 완공',
      '💧 비밀 장치 오성지: 숭례문보다 큰 북문 장안문 옹성 위에서 불을 끄던 5개 물구멍',
      '🅿️ 주차 · 다음 코스: 화성행궁/창룡문 공영주차장 권장 · 관람 후 수원왕갈비통닭거리 이동'
    ]
  },
  {
    id: 'stop-suwon-chicken',
    name: '수원왕갈비통닭거리',
    address: '경기도 수원시 팔달구 수원천로 280',
    time: '14:00',
    category: '여행 · 맛집거리',
    attachedFile: '수원여행_맛집_리스트.pdf',
    aiBriefingTitle: '수원왕갈비통닭거리 가는 길\n[통닭거리] 가마솥 50년 & 영화 비하인드',
    aiSpeechText: '이번엔 맛있는 수원왕갈비통닭거리로 가는 길이에요! 재밌는 이야기 하나, 여긴 1970년대부터 무쇠 가마솥에 기름을 가득 붓고 생닭을 통째로 튀겨내던 50년 역사의 골목인데요, 천만 영화 극한직업에서 형사들이 위장 창업을 했던 왕갈비통닭의 실제 모티브가 된 성지랍니다! 진미통닭·용성통닭·남문통닭이 유명하고 바삭한 닭모래집 튀김 서비스도 별미예요. 남수동 공영주차장에 대시면 골목까지 딱 3분이고, 식사 후엔 집으로 귀가 안내할게요.',
    summaryPoints: [
      '🎬 50년 골목 & 극한직업: 무쇠 가마솥 후라이드 원조이자 천만 영화 왕갈비통닭 모티브 성지',
      '🍗 대표 맛집 · 팁: 진미·용성·남문통닭 인기 — 주말엔 현장 웨이팅 또는 전화 포장 추천',
      '🏠 주차 · 다음 코스: 남수동 공영주차장 도보 3분 · 식사 후 마지막 목적지 집으로 귀가'
    ]
  }
];

export interface DocQA {
  keywords: string[];
  question: string;
  answer: string;
  pageRef: string;
}

export const stopQADatabase: Record<string, DocQA[]> = {
  'stop-yangjae': [
    {
      keywords: ['수익', '배분', '비율', '구독', '돈', '가격', '얼마', '7:3', '70', '8900', '8,900'],
      question: '수익 배분 비율과 월 구독료가 어떻게 되나요?',
      answer: '월 8,900원 유료 구독 모델을 기준으로, 카멜레온 70%, 현대자동차 30% 배분 안건입니다. 제휴 서류 3페이지에 명시되어 있습니다.',
      pageRef: 'Carmeleon_서비스_미팅자료.pptx (3p 제휴 모델)'
    },
    {
      keywords: ['보안', '5p', '5페이지', '데이터', '유출', '온디바이스', '클라우드', '규격', '오프라인'],
      question: '5페이지 보안 아키텍처의 핵심이 무엇인가요?',
      answer: '차량 주행 및 개인 위치 데이터가 외부 클라우드로 유출되지 않고 차 안에서 온디바이스로 암호화 처리되는 구조입니다. 현대차의 엄격한 데이터 보안 규격을 100% 충족합니다.',
      pageRef: 'Carmeleon_서비스_미팅자료.pptx (5p 보안 장표)'
    },
    {
      keywords: ['주차', '주차장', '어디', 'vip', '키오스크', '방문증', '도착', '서관'],
      question: '양재 본사 주차와 출입증 발급은 어떻게 하나요?',
      answer: '서관 지하 2층 VIP 전용 주차구역에 차량 번호가 사전 등록되어 있습니다. 로비 키오스크에서 1분 만에 방문증을 발급받으실 수 있습니다.',
      pageRef: '양재 본사 사전 등록증'
    }
  ],
  'stop-namyang': [
    {
      keywords: ['소음', '데시벨', 'db', '인식률', '음성', '호출', '호출어', '8p', '8페이지', '94'],
      question: '주행 소음 환경에서 음성 인식률이 얼마인가요?',
      answer: '주행 소음 70dB 고속 환경에서 "카멜레온" 호출어 인식률 94.2%를 달성했습니다. 8페이지 기술 검증 장표에 실차 시험 측정 그래프가 첨부되어 있습니다.',
      pageRef: 'Carmeleon_Pleos.pptx (8p 음성인식 시험)'
    },
    {
      keywords: ['센서', '내비', '터널', '오차', '관성', 'gps', '12p', '12페이지', '보정', 'fused'],
      question: '터널 진입 시 GPS 오차 보정은 어떻게 동작하나요?',
      answer: '터널이나 지하 주차장 진입 시 FusedLocation 관성 항법 센서를 활용하여 오차를 ±2m 이내로 보정하도록 규격이 합의되었습니다. 12페이지 규격 협의 안건입니다.',
      pageRef: 'Carmeleon_Pleos.pptx (12p FusedLocation)'
    },
    {
      keywords: ['보안', '출입', '게이트', '노트북', '스티커', '카메라', '절차', '1게이트'],
      question: '남양기술연구소 출입 및 보안 절차가 어떻게 되나요?',
      answer: 'R&D 1게이트에 사전 등록되어 있으며, 지참하신 노트북 및 스마트폰 카메라 렌즈에 보안 봉인 스티커를 부착해야 하므로 약 5분 정도 추가 시간이 소요됩니다.',
      pageRef: '남양연구소 방문 안내 수칙'
    }
  ],
  'stop-home': [
    {
      keywords: ['마트', '세일', '장보기', '식단', '저녁', '할인', '계란', '달걀'],
      question: '오늘 마트 할인 품목이 무엇인가요?',
      answer: '아파트 상가 마트에서 오늘 저녁 신선 식품과 달걀 20% 타임 세일을 진행하고 있습니다.',
      pageRef: '식단메모.txt'
    },
    {
      keywords: ['세탁', '세탁물', '택배', '정장', '무인', '드라이클리닝'],
      question: '맡긴 세탁물은 어디서 찾아야 하나요?',
      answer: '어제 맡기신 정장 드라이클리닝이 완료되어 20시 전까지 아파트 무인 택배함 3번에서 수령하시면 됩니다.',
      pageRef: '세탁소 알림 문자'
    },
    {
      keywords: ['충전', '주차', '전기차', '완속', '지하'],
      question: '아파트 주차장 완속 충전기 여유가 있나요?',
      answer: '아파트 지하 2층 완속 충전기 4기 중 2기 여유가 있으니 바로 충전 자리에 주차하시면 됩니다.',
      pageRef: '아파트 홈넷 주차 정보'
    }
  ],
  'stop-suwon-hwaseong': [
    {
      keywords: ['주차', '주차장', '어디', '화성행궁', '연무대', '창룡문'],
      question: '수원화성 주차는 어디에 하는 게 좋나요?',
      answer: '화성행궁 공영주차장이나 창룡문(연무대) 공영주차장을 추천드려요. 주차 후 장안문과 방화수류정 성곽길을 걷기 가장 좋은 동선입니다.',
      pageRef: '수원여행_코스_가이드.pdf (주차 안내)'
    },
    {
      keywords: ['재밌', '재미', '이야기', '얘기', '스토리', '비하인드', '거중기', '정조', '사도세자', '유네스코', '역사', '궁금', '장안문', '방화수류정', '정약용', '유래', '명소', '설명', '볼거리', '오성지'],
      question: '수원화성에 얽힌 재미있는 이야기나 볼거리가 있나요?',
      answer: '다산 정약용 선생이 도르래 원리로 만든 거중기 덕분에 원래 10년 걸릴 성곽 공사를 2년 8개월 만에 끝냈대요! 또 숭례문보다 큰 북문 장안문 위엔 적이 불을 질렀을 때 물을 쏟아 끄는 비밀 물탱크 오성지가 숨어 있고, 용연 연못 위 방화수류정은 밤에 달이 비치는 피크닉 인생샷 명소로 유명합니다.',
      pageRef: '수원여행_코스_가이드.pdf (스토리 가이드)'
    },
    {
      keywords: ['통닭', '갈비', '맛집', '다음', '밥', '먹을'],
      question: '관람 끝나고 다음 코스는 어디인가요?',
      answer: '수원화성 관람 후 차로 약 10분 거리인 수원왕갈비통닭거리로 이동한 뒤, 식사 후 마지막 목적지 집으로 귀가하는 수원여행 루트입니다.',
      pageRef: '수원여행 일정표'
    }
  ],
  'stop-suwon-chicken': [
    {
      keywords: ['재밌', '재미', '이야기', '얘기', '스토리', '유래', '극한직업', '영화', '가마솥', '왜유명', '역사'],
      question: '수원왕갈비통닭거리만의 재미있는 이야기가 있나요?',
      answer: '1970년대부터 커다란 무쇠 가마솥에 기름을 가득 붓고 생닭을 통째로 튀기던 50년 역사의 골목인데요, 천만 영화 극한직업에서 형사들이 위장 창업한 왕갈비통닭의 실제 모티브가 된 바로 그 성지예요! 서비스로 나오는 바삭한 닭모래집 튀김도 꼭 맛보세요.',
      pageRef: '수원여행_맛집_리스트.pdf (스토리)'
    },
    {
      keywords: ['맛집', '어디', '추천', '진미', '용성', '남문', '왕갈비', '통닭', '메뉴', '웨이팅'],
      question: '수원왕갈비통닭거리 대표 맛집과 웨이팅 팁 알려줘',
      answer: '진미통닭, 용성통닭, 남문통닭이 3대 맛집으로 유명해요. 가마솥 후라이드와 단짠 수원왕갈비통닭을 반반으로 즐기기 좋고, 주말 피크 시간에는 현장 대기 또는 전화 포장 주문을 추천합니다.',
      pageRef: '수원여행_맛집_리스트.pdf (맛집 & 웨이팅)'
    },
    {
      keywords: ['주차', '주차장', '어디', '팔달', '남수동'],
      question: '통닭거리 근처 주차 어디에 하면 편할까요?',
      answer: '팔달문 남수동 공영주차장이나 팔달구청 공영주차장에 대시면 통닭거리 골목까지 도보 3분 내로 편하게 이동하실 수 있어요.',
      pageRef: '수원여행_맛집_리스트.pdf (주차 안내)'
    },
    {
      keywords: ['집', '다음', '귀가', '마지막', '일정', '설명'],
      question: '통닭거리 다음 일정은 어디인가요?',
      answer: '수원왕갈비통닭거리에서 식사 및 포장을 마치신 뒤에는 수원여행의 마지막 코스인 집(서울 구로구)으로 귀가 안내를 시작합니다.',
      pageRef: '수원여행 일정표'
    }
  ]
};

export const suggestedQuestions: Record<string, string[]> = {
  'stop-yangjae': [
    '카멜레온~ 수익 배분 비율이 몇 대 몇이었지?',
    '카멜레온~ 5페이지 보안 관련 내용이 뭐야?',
    '카멜레온~ 주차 어디에 해야 해?'
  ],
  'stop-namyang': [
    '카멜레온~ 소음 몇 dB에서 인식률 얼마야?',
    '카멜레온~ 12페이지 관성 센서 보정 내용이 뭐야?',
    '카멜레온~ 연구소 보안 절차가 어떻게 돼?'
  ],
  'stop-home': [
    '카멜레온~ 오늘 마트 세일 품목이 뭐야?',
    '카멜레온~ 맡긴 세탁물 어디서 찾아야 해?',
    '카멜레온~ 아파트 전기차 충전기 여유 있어?'
  ],
  'stop-suwon-hwaseong': [
    '카멜레온~ 수원화성 주차 어디에 해?',
    '카멜레온~ 장안문이랑 방화수류정 설명해줘',
    '카멜레온~ 다음 코스 어디야?'
  ],
  'stop-suwon-chicken': [
    '카멜레온~ 왕갈비통닭 맛집 추천해줘',
    '카멜레온~ 통닭거리 주차 어디가 편해?',
    '카멜레온~ 다음 일정은 어디야?'
  ]
};

function MapScene({ destination, proposed, accepted }: { destination: string; proposed: boolean; accepted: boolean }) {
  const changed = proposed || accepted;
  return (
    <section className="cm-map w-full h-full relative overflow-hidden select-none" aria-label="이동 경로 개념도">
      <svg className="cm-map-art" viewBox="0 0 866 540" preserveAspectRatio="xMidYMid slice" role="img">
        <defs>
          <pattern id="cm-blocks-full" width="112" height="92" patternTransform="rotate(-24)" patternUnits="userSpaceOnUse">
            <rect x="5" y="5" width="100" height="80" rx="5" className="cm-block" />
            <path d="M0 0H112V92" className="cm-street-grid" fill="none" strokeWidth="2" />
          </pattern>
        </defs>
        <rect width="866" height="540" className="cm-map-ground" />
        <rect width="866" height="540" fill="url(#cm-blocks-full)" />
        <path d="M-20 265Q170 340 260 236T540 175T910 65" className="cm-river" fill="none" strokeWidth="58" />
        <path d="M-30 95L196 205 350 285 580 415 920 478M120 -20L196 205 250 570M560 -20L535 180 580 415 490 570" fill="none" className="cm-road-outline" strokeWidth="19" />
        <path d="M-30 95L196 205 350 285 580 415 920 478M120 -20L196 205 250 570M560 -20L535 180 580 415 490 570" fill="none" className="cm-road" strokeWidth="14" />
        <path d="M180 420L212 342Q220 325 247 321L350 285 535 180 631 159" fill="none" className="cm-route-outline" strokeWidth="12" strokeLinecap="round" />
        <path d="M180 420L212 342Q220 325 247 321L350 285 535 180 631 159" fill="none" className="cm-original-route" data-muted={changed} strokeWidth="6" strokeLinecap="round" />
        <path d="M247 321L313 392Q326 406 344 391L446 316Q460 303 445 285L414 249" fill="none" className="cm-detour" data-visible={changed} strokeWidth="6" strokeLinecap="round" strokeDasharray={proposed && !accepted ? '8 9' : undefined} />
        <text x="75" y="135" className="cm-map-label">서초구</text>
        <text x="657" y="430" className="cm-map-label">화성시</text>
        <text x="556" y="273" className="cm-map-label minor">양재천</text>
        <text x="334" y="145" className="cm-map-label minor">헌릉로</text>
      </svg>
      <div className="cm-map-search cursor-pointer">
        <Navigation size={19} />
        <span className="font-bold">{destination}</span>
        <span>가는 중</span>
      </div>
      <span className="cm-map-compass">
        <Compass size={23} />
        <small>N</small>
      </span>
      <div className="cm-destination">
        <MapPin size={20} className="text-blue-600" />
        <span className="font-bold">{destination}</span>
      </div>
      <div className="cm-car">
        <Navigation size={23} />
      </div>
      <div className="cm-food-pin" data-visible={changed}>
        <Utensils size={18} />
        <span>{accepted ? '다음 경유지' : '+6분'}</span>
      </div>
      <div className="cm-map-credit">카멜레온 미팅 · 실제 등록 파일 연동 완료</div>
    </section>
  );
}

interface FullVehicleCockpitProps {
  currentPlan?: DailyPlan;
  onSwitchToPhoneView?: () => void;
}

export function FullVehicleCockpit({ currentPlan, onSwitchToPhoneView }: FullVehicleCockpitProps) {
  // 사용자가 핸드폰 앱에서 저장한 '카멜레온 미팅' 정차지 인덱스 (0: 양재 본사, 1: 남양연구소, 2: 집)
  const [stopIndex, setStopIndex] = useState<number>(0);
  // 0: 출발 준비, 1: 동행 중, 2: 식사 제안, 3: 반영 중, 4: 반영 완료
  const [phase, setPhase] = useState<number>(0);
  const [cardType, setCardType] = useState<'food' | 'briefing' | 'qa' | null>(null);
  const [routeOpen, setRouteOpen] = useState<boolean>(false);
  const [appearance, setAppearance] = useState<Appearance>('light');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // 카멜레온 자료 기반 Q&A 상태
  const [qaQuery, setQaQuery] = useState<string>('');
  const [qaHistory, setQaHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string; pageRef?: string; at: string }>>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);

  // Siri / Apple Intelligence 스타일 앰비언트 엣지 글로우 (Ambient Edge Glow) 상태
  const [edgeGlowMode, setEdgeGlowMode] = useState<'voice' | 'briefing' | 'battery' | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number>(72);

  // 옆에 실제 Pleos 순정 내비 화면을 나란히 띄울지 여부 (기본 false = 기존 CARmeleon UI 원형 유지)
  const [showPleosSide, setShowPleosSide] = useState<boolean>(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'pleos'
  );
  const [pleosFullscreen, setPleosFullscreen] = useState<boolean>(false);

  // 음성 인식 · "카멜레온~" 상시 자동 감지 · 경유지 변경 & 재탑승 자동 복귀 상태
  const [isListening, setIsListening] = useState<boolean>(false);
  const [wakeWordActive, setWakeWordActive] = useState<boolean>(true);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [pendingDetour, setPendingDetour] = useState<VoiceDetourCandidate | null>(null);
  const [activeDetour, setActiveDetour] = useState<ActiveDetour | null>(null);
  const [resumedFromDetour, setResumedFromDetour] = useState<{
    placeName: string;
    address: string;
    originalStopName: string;
  } | null>(null);
  const [voicePreset, setVoicePreset] = useState<VoiceTonePreset>('cute');
  const voicePresetRef = useRef<VoiceTonePreset>('cute');
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    voicePresetRef.current = voicePreset;
  }, [voicePreset]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, []);
  const [aiStatus, setAiStatus] = useState<{
    checked: boolean;
    modelConfigured: boolean;
    placesConfigured: boolean;
    ttsConfigured: boolean;
  }>({ checked: false, modelConfigured: false, placesConfigured: false, ttsConfigured: false });
  const aiStatusRef = useRef(aiStatus);
  useEffect(() => {
    aiStatusRef.current = aiStatus;
  }, [aiStatus]);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setAiStatus({
          checked: true,
          modelConfigured: Boolean(data.modelConfigured),
          placesConfigured: Boolean(data.placesConfigured),
          ttsConfigured: Boolean(data.ttsConfigured),
        });
      })
      .catch(() => {
        if (!active) return;
        setAiStatus({ checked: true, modelConfigured: false, placesConfigured: false, ttsConfigured: false });
      });
    return () => {
      active = false;
    };
  }, []);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recognitionModeRef = useRef<'command' | 'wake' | null>(null);
  const recognitionGenRef = useRef<number>(0);
  const processedFinalIdxRef = useRef<number>(0);
  const latestInterimRef = useRef<string>('');
  const dispatchedCommandRef = useRef<boolean>(false);
  const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const speakGenRef = useRef<number>(0);
  const ttsAudioCacheRef = useRef<Map<string, string>>(new Map());
  const detourAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeActiveRef = useRef<boolean>(true);
  const suppressEchoRef = useRef<boolean>(false);
  const needsUserGestureRef = useRef<boolean>(false);
  const consecutiveErrorRef = useRef<number>(0);
  const pendingDetourRef = useRef<VoiceDetourCandidate | null>(null);
  const activeDetourRef = useRef<ActiveDetour | null>(null);
  const utteranceHandlerRef = useRef<(raw: string, opts?: { viaWake?: boolean }) => void>(() => {});

  const flashVoiceHint = (msg: string | null, clearAfterMs = 0) => {
    if (voiceHintTimerRef.current) {
      clearTimeout(voiceHintTimerRef.current);
      voiceHintTimerRef.current = null;
    }
    setVoiceHint(msg);
    if (msg && clearAfterMs > 0) {
      voiceHintTimerRef.current = setTimeout(() => {
        voiceHintTimerRef.current = null;
        setVoiceHint((prev) => (prev === msg ? null : prev));
      }, clearAfterMs);
    }
  };

  useEffect(() => {
    wakeActiveRef.current = wakeWordActive;
  }, [wakeWordActive]);

  useEffect(() => {
    pendingDetourRef.current = pendingDetour;
  }, [pendingDetour]);

  useEffect(() => {
    activeDetourRef.current = activeDetour;
  }, [activeDetour]);

  const currentStop = meetingStopsData[stopIndex] || meetingStopsData[0];
  const accepted = phase === 4;
  const isDriving = phase >= 1;
  const originalTime = currentStop.time;
  const newTime = '13:46';

  const stopRecognition = () => {
    recognitionGenRef.current += 1;
    if (interimTimerRef.current) {
      clearTimeout(interimTimerRef.current);
      interimTimerRef.current = null;
    }
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const prev = recognitionRef.current;
      recognitionRef.current = null;
      recognitionModeRef.current = null;
      try {
        prev.onresult = null;
        prev.onerror = null;
        prev.onend = null;
        prev.abort();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  };

  // 음성 TTS 함수 (Gemini 귀여운 신경망 음성 Leda/Aoede 우선 + 미설정 시 브라우저 음성 폴백, 발화 중 에코 차단)
  const speak = (
    text: string,
    glow?: 'voice' | 'briefing' | 'battery',
    onDone?: () => void
  ) => {
    speakGenRef.current += 1;
    const mySpeakGen = speakGenRef.current;
    if (speechFallbackTimerRef.current) {
      clearTimeout(speechFallbackTimerRef.current);
      speechFallbackTimerRef.current = null;
    }
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.onended = null;
        activeAudioRef.current.onerror = null;
      } catch {
        // ignore
      }
      activeAudioRef.current = null;
    }
    const clean = text.replace(/[\n\r]+/g, ' ').replace(/^카멜레온:\s*/, '').trim();
    if (!clean) {
      onDone?.();
      return;
    }

    let settled = false;
    const finishSpeech = () => {
      if (settled || mySpeakGen !== speakGenRef.current) return;
      settled = true;
      activeUtteranceRef.current = null;
      activeAudioRef.current = null;
      if (speechFallbackTimerRef.current) {
        clearTimeout(speechFallbackTimerRef.current);
        speechFallbackTimerRef.current = null;
      }
      setIsSpeaking(false);
      suppressEchoRef.current = false;
      setTimeout(() => setEdgeGlowMode(null), 1200);
      if (onDone) {
        setTimeout(onDone, 280);
      } else if (wakeActiveRef.current) {
        setTimeout(() => startRecognition('wake'), 320);
      }
    };

    const speakWithBrowserFallback = () => {
      if (mySpeakGen !== speakGenRef.current || settled) return;
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        speechFallbackTimerRef.current = setTimeout(
          finishSpeech,
          Math.min(8000, Math.max(2000, clean.length * 70))
        );
        return;
      }
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume?.();
      const utt = new SpeechSynthesisUtterance(clean);
      // Chrome GC가 발화 중간에 SpeechSynthesisUtterance를 회수해 onend가 누락되는 현상 방지
      activeUtteranceRef.current = utt;
      configureCuteUtterance(utt, voicePresetRef.current, voicesRef.current);
      utt.onstart = () => setIsSpeaking(true);
      utt.onend = finishSpeech;
      utt.onerror = finishSpeech;
      speechFallbackTimerRef.current = setTimeout(
        finishSpeech,
        Math.min(12000, Math.max(2000, clean.length * 80))
      );
      window.speechSynthesis.speak(utt);
    };

    suppressEchoRef.current = true;
    stopRecognition();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (glow) setEdgeGlowMode(glow);
    setIsSpeaking(true);

    if (aiStatusRef.current.ttsConfigured && typeof Audio !== 'undefined') {
      const preset = voicePresetRef.current;
      const cacheKey = `${preset}:${clean}`;
      const cachedUrl = ttsAudioCacheRef.current.get(cacheKey);
      const playAudioUrl = (audioUrl: string) => {
        if (mySpeakGen !== speakGenRef.current || settled) return;
        const audio = new Audio(audioUrl);
        activeAudioRef.current = audio;
        audio.onended = finishSpeech;
        audio.onerror = speakWithBrowserFallback;
        speechFallbackTimerRef.current = setTimeout(
          finishSpeech,
          Math.min(18000, Math.max(3000, clean.length * 105))
        );
        audio.play().catch(speakWithBrowserFallback);
      };

      if (cachedUrl) {
        playAudioUrl(cachedUrl);
        return;
      }

      fetch('/api/v1/simulator/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, preset }),
      })
        .then(async (res) => {
          if (mySpeakGen !== speakGenRef.current || settled) return;
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !ct.includes('audio/')) {
            speakWithBrowserFallback();
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          if (ttsAudioCacheRef.current.size >= 24) {
            const firstKey = ttsAudioCacheRef.current.keys().next().value;
            if (firstKey) {
              const oldUrl = ttsAudioCacheRef.current.get(firstKey);
              if (oldUrl) URL.revokeObjectURL(oldUrl);
              ttsAudioCacheRef.current.delete(firstKey);
            }
          }
          ttsAudioCacheRef.current.set(cacheKey, url);
          playAudioUrl(url);
        })
        .catch(speakWithBrowserFallback);
      return;
    }

    speakWithBrowserFallback();
  };

  const scheduleWakeRestart = (delayMs = 350) => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (wakeActiveRef.current && !suppressEchoRef.current && !recognitionRef.current && !needsUserGestureRef.current) {
        startRecognition('wake');
      }
    }, delayMs);
  };

  const startRecognition = (mode: 'command' | 'wake', opts?: { fromUserGesture?: boolean }) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      if (mode === 'command') {
        setIsListening(false);
        setLiveTranscript('');
        flashVoiceHint('이 브라우저는 음성 인식을 지원하지 않아요. Chrome 또는 Edge를 사용해 주세요.', 5000);
      } else {
        setWakeWordActive(false);
        wakeActiveRef.current = false;
      }
      return;
    }

    if (opts?.fromUserGesture) {
      needsUserGestureRef.current = false;
      consecutiveErrorRef.current = 0;
    }

    const hadRunningRec = Boolean(recognitionRef.current);
    stopRecognition();

    const gen = recognitionGenRef.current;
    processedFinalIdxRef.current = 0;
    latestInterimRef.current = '';
    dispatchedCommandRef.current = false;

    const rec = new Ctor();
    rec.lang = 'ko-KR';
    rec.continuous = mode === 'wake';
    rec.interimResults = true;
    rec.maxAlternatives = 4;
    recognitionRef.current = rec;
    recognitionModeRef.current = mode;

    if (mode === 'command') {
      setIsListening(true);
      setLiveTranscript('');
    }

    rec.onresult = (event) => {
      if (gen !== recognitionGenRef.current) return;
      consecutiveErrorRef.current = 0;

      const startIdx = processedFinalIdxRef.current;
      let allFinal = true;
      const altStreams: string[][] = [[], [], [], []];

      for (let i = startIdx; i < event.results.length; i++) {
        const res = event.results[i];
        if (!res.isFinal) allFinal = false;
        const primary = (res[0]?.transcript || '').trim();
        for (let a = 0; a < 4; a++) {
          const alt = (res[a]?.transcript || primary).trim();
          if (alt) altStreams[a].push(alt);
        }
      }

      const combinedAlts = altStreams.map((parts) => parts.join(' ').trim()).filter(Boolean);
      const best = pickBestTranscriptAlternative(combinedAlts);
      if (!best.transcript) return;

      latestInterimRef.current = best.transcript;
      setLiveTranscript(best.transcript);

      if (interimTimerRef.current) {
        clearTimeout(interimTimerRef.current);
        interimTimerRef.current = null;
      }

      if (mode === 'command') {
        if (allFinal) {
          processedFinalIdxRef.current = event.results.length;
          latestInterimRef.current = '';
          dispatchedCommandRef.current = true;
          stopRecognition();
          utteranceHandlerRef.current(best.transcript, { viaWake: false });
          return;
        }
        // 말 중간 숨고르기(최대 1.9초)는 끊지 않고 기다렸다가 rec.stop()으로 자연스럽게 문장 완결 유도
        interimTimerRef.current = setTimeout(() => {
          interimTimerRef.current = null;
          if (gen !== recognitionGenRef.current) return;
          try {
            rec.stop();
          } catch {
            const fallbackText = latestInterimRef.current.trim();
            if (fallbackText && !dispatchedCommandRef.current) {
              dispatchedCommandRef.current = true;
              stopRecognition();
              utteranceHandlerRef.current(fallbackText, { viaWake: false });
            }
          }
        }, 1900);
        return;
      }

      // 'wake' (상시 자동 감지) 모드
      const quickResponseNeeded =
        (pendingDetourRef.current !== null &&
          (isConfirmUtterance(best.transcript) || isCancelUtterance(best.transcript))) ||
        (activeDetourRef.current !== null && isReboardUtterance(best.transcript));

      if (best.woke) {
        flashVoiceHint(
          best.command
            ? `카멜레온 듣는 중: "${best.command}"`
            : '카멜레온 호출 감지! 이어서 말씀하세요...'
        );
        if (allFinal && best.command.length >= 2) {
          processedFinalIdxRef.current = event.results.length;
          latestInterimRef.current = '';
          stopRecognition();
          utteranceHandlerRef.current(best.transcript, { viaWake: true });
          return;
        }
        // "카멜레온~" 직후 이어지는 명령이 한 박자 늦게 붙어도 끊기지 않도록 1.5초(최종 확정은 0.95초) 대기
        interimTimerRef.current = setTimeout(() => {
          interimTimerRef.current = null;
          if (gen !== recognitionGenRef.current) return;
          const captured = latestInterimRef.current.trim();
          processedFinalIdxRef.current = event.results.length;
          latestInterimRef.current = '';
          stopRecognition();
          if (captured) {
            utteranceHandlerRef.current(captured, { viaWake: true });
          }
        }, allFinal ? 950 : 1500);
        return;
      }

      if (quickResponseNeeded) {
        if (allFinal) {
          processedFinalIdxRef.current = event.results.length;
          latestInterimRef.current = '';
          stopRecognition();
          utteranceHandlerRef.current(best.transcript, { viaWake: true });
          return;
        }
        interimTimerRef.current = setTimeout(() => {
          interimTimerRef.current = null;
          if (gen !== recognitionGenRef.current) return;
          const captured = latestInterimRef.current.trim();
          processedFinalIdxRef.current = event.results.length;
          latestInterimRef.current = '';
          stopRecognition();
          if (captured) {
            utteranceHandlerRef.current(captured, { viaWake: true });
          }
        }, 1100);
        return;
      }

      // 호출어 없이 일반 음성이 확정되었을 때는 버퍼만 비우고 무엇이 들렸는지 안내 (사용자가 마이크 작동 확인 가능)
      if (allFinal) {
        processedFinalIdxRef.current = event.results.length;
        latestInterimRef.current = '';
        flashVoiceHint(
          `들린 음성: "${best.transcript}" · 앞에 "카멜레온~"을 붙이거나 마이크를 눌러주세요`,
          3800
        );
      }
    };

    rec.onerror = (err) => {
      if (gen !== recognitionGenRef.current) return;
      consecutiveErrorRef.current += 1;
      if (mode === 'command') {
        setIsListening(false);
      }

      if (err.error === 'not-allowed' || err.error === 'service-not-allowed') {
        if (!opts?.fromUserGesture && mode === 'wake') {
          needsUserGestureRef.current = true;
          flashVoiceHint('화면을 한 번 클릭하거나 마이크를 누르면 "카멜레온~" 자동 감지가 시작됩니다.', 6000);
          return;
        }
        setWakeWordActive(false);
        wakeActiveRef.current = false;
        flashVoiceHint('브라우저 마이크 권한이 차단되어 있어요. 주소창 마이크 아이콘에서 허용해 주세요.', 7000);
      } else if (err.error === 'audio-capture' && mode === 'command') {
        flashVoiceHint('연결된 마이크를 찾을 수 없거나 다른 프로그램이 사용 중이에요.', 5000);
      } else if (err.error === 'network' && mode === 'command') {
        flashVoiceHint('Chrome 음성 인식 네트워크 연결이 불안정합니다. 잠시 후 다시 시도해요.', 4000);
      } else if (err.error === 'no-speech' && mode === 'command') {
        flashVoiceHint('목소리가 들리지 않았어요. 마이크를 누르거나 "카멜레온~"으로 불러주세요.', 3500);
      }
    };

    rec.onend = () => {
      if (gen !== recognitionGenRef.current) return;
      recognitionRef.current = null;
      recognitionModeRef.current = null;
      if (interimTimerRef.current) {
        clearTimeout(interimTimerRef.current);
        interimTimerRef.current = null;
      }

      const trailing = latestInterimRef.current.trim();
      latestInterimRef.current = '';
      if (mode === 'command') {
        setIsListening(false);
        if (trailing && !dispatchedCommandRef.current) {
          dispatchedCommandRef.current = true;
          utteranceHandlerRef.current(trailing, { viaWake: false });
          return;
        }
      } else if (trailing) {
        const wakeCheck = extractWakeCommand(trailing);
        if (wakeCheck.woke) {
          utteranceHandlerRef.current(trailing, { viaWake: true });
          return;
        }
      }

      if (wakeActiveRef.current && !suppressEchoRef.current && !needsUserGestureRef.current) {
        const delay = consecutiveErrorRef.current > 0 ? Math.min(2500, 450 * consecutiveErrorRef.current) : 340;
        scheduleWakeRestart(delay);
      }
    };

    const launch = () => {
      if (gen !== recognitionGenRef.current) return;
      try {
        rec.start();
      } catch {
        recognitionRef.current = null;
        recognitionModeRef.current = null;
        if (mode === 'command') setIsListening(false);
        // 이전 abort 직후 일시 충돌 시 1회 안전 재시도
        if (hadRunningRec) {
          setTimeout(() => {
            if (gen === recognitionGenRef.current && !recognitionRef.current) {
              try {
                recognitionRef.current = rec;
                recognitionModeRef.current = mode;
                if (mode === 'command') setIsListening(true);
                rec.start();
              } catch {
                recognitionRef.current = null;
                recognitionModeRef.current = null;
                if (mode === 'command') setIsListening(false);
              }
            }
          }, 220);
        }
      }
    };

    launch();
  };

  // 페이지 로드 · 첫 클릭 · 탭 복귀 시 상시 "카멜레온~" 호출 대기 마이크 자동 시작/복구
  useEffect(() => {
    if (typeof window === 'undefined') return;
    startRecognition('wake');
    const resumeWakeOnGesture = () => {
      if (
        wakeActiveRef.current &&
        !suppressEchoRef.current &&
        (!recognitionRef.current || needsUserGestureRef.current)
      ) {
        startRecognition('wake', { fromUserGesture: true });
      }
    };
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        wakeActiveRef.current &&
        !suppressEchoRef.current &&
        !recognitionRef.current &&
        !needsUserGestureRef.current
      ) {
        scheduleWakeRestart(300);
      }
    };
    window.addEventListener('pointerdown', resumeWakeOnGesture, { passive: true });
    window.addEventListener('keydown', resumeWakeOnGesture, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pointerdown', resumeWakeOnGesture);
      window.removeEventListener('keydown', resumeWakeOnGesture);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const stopAudio = () => {
    speakGenRef.current += 1;
    suppressEchoRef.current = false;
    activeUtteranceRef.current = null;
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.onended = null;
        activeAudioRef.current.onerror = null;
      } catch {
        // ignore
      }
      activeAudioRef.current = null;
    }
    if (speechFallbackTimerRef.current) {
      clearTimeout(speechFallbackTimerRef.current);
      speechFallbackTimerRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setEdgeGlowMode(null);
  };

  const clearDetourAutoTimer = () => {
    if (detourAutoTimerRef.current) {
      clearTimeout(detourAutoTimerRef.current);
      detourAutoTimerRef.current = null;
    }
  };

  const parkDetourFnRef = useRef<() => void>(() => {});
  const reboardFnRef = useRef<() => void>(() => {});

  // 경유지 승인("네") -> 경유지로 안내 변경 -> 시뮬레이션 이동 후 자동 도착 -> 원래 목적지 자동 재개
  const confirmDetour = () => {
    const candidate = pendingDetourRef.current;
    if (!candidate) return;
    clearDetourAutoTimer();
    setPendingDetour(null);
    setResumedFromDetour(null);
    if (phase === 0) setPhase(1);
    const nextDetour: ActiveDetour = {
      candidate,
      phase: 'TO_DETOUR',
      originalStopId: currentStop.id,
      originalStopName: currentStop.name,
      originalStopTime: currentStop.time,
    };
    activeDetourRef.current = nextDetour;
    setActiveDetour(nextDetour);
    const msg = `${withRoParticle(candidate.placeName)} 길안내를 변경했습니다. 잠시 들렀다 출발하시면 여기서부터 원래 목적지인 ${withRoParticle(currentStop.name)} 이어서 안내할게요.`;
    setVoiceHint(msg);
    speak(msg, 'voice', () => {
      if (wakeActiveRef.current) startRecognition('wake');
      clearDetourAutoTimer();
      detourAutoTimerRef.current = setTimeout(() => {
        detourAutoTimerRef.current = null;
        if (activeDetourRef.current?.phase === 'TO_DETOUR') {
          parkDetourFnRef.current();
        }
      }, 1800);
    });
  };

  const cancelDetour = () => {
    clearDetourAutoTimer();
    setPendingDetour(null);
    const msg = `알겠어요. 기존 ${currentStop.name} 경로를 그대로 유지할게요.`;
    setVoiceHint(msg);
    speak(msg, 'voice');
  };

  const parkAtDetour = () => {
    const current = activeDetourRef.current;
    if (!current) return;
    clearDetourAutoTimer();
    const parked: ActiveDetour = { ...current, phase: 'PARKED_AT_DETOUR' };
    activeDetourRef.current = parked;
    setActiveDetour(parked);
    const msg = `${current.candidate.placeName}에 도착해 정차했어요. 곧 여기서부터 원래 목적지 ${withRoParticle(current.originalStopName)} 안내를 이어갈게요.`;
    setVoiceHint(msg);
    speak(msg, 'voice', () => {
      if (wakeActiveRef.current) startRecognition('wake');
      clearDetourAutoTimer();
      detourAutoTimerRef.current = setTimeout(() => {
        detourAutoTimerRef.current = null;
        if (activeDetourRef.current?.phase === 'PARKED_AT_DETOUR') {
          reboardFnRef.current();
        }
      }, 2000);
    });
  };
  parkDetourFnRef.current = parkAtDetour;

  // 경유지에서 재출발 -> 내 차 위치는 들른 장소에 두고, 거기부터 원래 목적지로 경로 재탐색·안내 시작
  const reboardResume = () => {
    const current = activeDetourRef.current;
    if (!current) return;
    clearDetourAutoTimer();
    activeDetourRef.current = null;
    setActiveDetour(null);
    setResumedFromDetour({
      placeName: current.candidate.placeName,
      address: current.candidate.address,
      originalStopName: current.originalStopName,
    });
    const msg = `다시 출발할게요! 현재 위치 ${current.candidate.placeName}에서 원래 목적지 ${withRoParticle(current.originalStopName)} 길안내를 새로 시작합니다.`;
    setVoiceHint(msg);
    setLastAnswer(msg);
    speak(msg, 'briefing');
  };
  reboardFnRef.current = reboardResume;

  const stopCenterCoordinates: Record<string, { latitude: number; longitude: number }> = {
    'stop-yangjae': { latitude: 37.464, longitude: 127.042 },
    'stop-namyang': { latitude: 37.163, longitude: 126.826 },
    'stop-home': { latitude: 37.484, longitude: 127.034 },
    'stop-suwon-hwaseong': { latitude: 37.2889, longitude: 127.0135 },
    'stop-suwon-chicken': { latitude: 37.2798, longitude: 127.0177 },
  };

  // 통합 음성 발화 핸들러 (마이크 버튼 · "카멜레온~" 호출어 · 직접 입력 공통 처리)
  const handleVoiceUtterance = (rawText: string, opts?: { viaWake?: boolean }) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    setIsListening(false);
    const { woke, command } = extractWakeCommand(trimmed);

    // 1) "네" / "아니요" 대답이 기다려지는 중이라면 호출어 없이 바로 응답 인식
    if (pendingDetourRef.current) {
      const target = woke && command ? command : trimmed;
      if (isConfirmUtterance(target)) {
        confirmDetour();
        return;
      }
      if (isCancelUtterance(target)) {
        cancelDetour();
        return;
      }
    }

    // 2) 경유 중 "재탑승 / 원래 목적지로 가자" 음성 명령
    if (activeDetourRef.current && isReboardUtterance(woke && command ? command : trimmed)) {
      reboardResume();
      return;
    }

    // 3) 상시 호출 대기 모드일 때는 "카멜레온~"으로 불렀을 때만 반응
    if (opts?.viaWake && !woke) return;

    // 호출어만 부른 경우 ("카멜레온~") -> "네, 말씀하세요" 후 바로 명령 듣기 시작
    if (woke && !command) {
      flashVoiceHint('네, 말씀하세요. 듣고 있어요!');
      speak('네, 말씀하세요. 무엇을 도와드릴까요?', 'voice', () =>
        startRecognition('command', { fromUserGesture: false })
      );
      return;
    }

    const utterance = woke ? command : trimmed;
    const uttCompact = utterance.toLowerCase().replace(/[\s?!.,~]+/g, '');
    setLiveTranscript(utterance);

    // 3-b) 음성 중지 / 목소리 톤 변경 / 일상 인사·테스트·일정 안내 즉답
    if (['그만', '멈춰', '조용히', '음성꺼', '말그만', '시끄러'].some((k) => uttCompact.includes(k))) {
      stopAudio();
      flashVoiceHint('음성 안내를 멈췄어요.', 2500);
      if (wakeActiveRef.current) scheduleWakeRestart(300);
      return;
    }

    if (/(발랄|하이텐션|신나게)/.test(uttCompact) && /(목소리|톤|말투)/.test(uttCompact)) {
      voicePresetRef.current = 'bubbly';
      setVoicePreset('bubbly');
      const msg = '알겠어요! 더 발랄하고 신나는 목소리로 안내해 드릴게요!';
      flashVoiceHint(msg, 4000);
      speak(msg, 'voice');
      return;
    }
    if (/(차분|조용한|낮은)/.test(uttCompact) && /(목소리|톤|말투)/.test(uttCompact)) {
      voicePresetRef.current = 'calm';
      setVoicePreset('calm');
      const msg = '차분하고 안정감 있는 목소리로 바꿨어요.';
      flashVoiceHint(msg, 4000);
      speak(msg, 'voice');
      return;
    }
    if (/(귀여운|원래|기본)/.test(uttCompact) && /(목소리|톤|말투)/.test(uttCompact)) {
      voicePresetRef.current = 'cute';
      setVoicePreset('cute');
      const msg = '귀엽고 산뜻한 카멜레온 기본 목소리로 맞췄어요!';
      flashVoiceHint(msg, 4000);
      speak(msg, 'voice');
      return;
    }

    if (/^(안녕|안녕하세요|반가워|잘들려|들려|들리니|테스트|아아|고마워|감사|하이|헬로)/.test(uttCompact)) {
      const msg = uttCompact.includes('고마') || uttCompact.includes('감사')
        ? '천만에요! 안전 운전하시고 필요한 게 있으면 언제든 카멜레온을 불러주세요.'
        : '네, 아주 잘 들려요! 주변 주유소나 화장실 찾기, 미팅 자료 질문 무엇이든 말씀하세요.';
      flashVoiceHint(msg, 4000);
      setLastAnswer(msg);
      speak(msg, 'voice');
      return;
    }

    if (['너누구야', '누구야', '이름이뭐야', '뭐할수있어', '도움말', '기능'].some((k) => uttCompact.includes(k))) {
      const msg = `저는 드라이빙 AI 비서 카멜레온이에요. ${currentStop.attachedFile} 미팅 자료 요약과 질문 답변, 그리고 주유소·화장실 같은 주변 경유지 안내를 도와드릴 수 있어요.`;
      flashVoiceHint(msg, 4500);
      setLastAnswer(msg);
      speak(msg, 'voice');
      return;
    }

    // 4) 주변 주유소/화장실/충전소/편의점/약국/식사/카페 등 경유 탐색
    const detour = findDetourCandidate(utterance, currentStop.id);
    if (detour) {
      if (aiStatus.placesConfigured) {
        const queryWord =
          detour.kind === 'gas'
            ? '주유소'
            : detour.kind === 'charger'
            ? '전기차충전소'
            : detour.kind === 'convenience'
            ? '편의점'
            : detour.kind === 'pharmacy'
            ? '약국'
            : detour.kind === 'parking'
            ? '주차장'
            : detour.kind === 'hospital'
            ? '병원'
            : detour.kind === 'carwash'
            ? '세차장'
            : detour.kind === 'coffee'
            ? '카페'
            : detour.kind === 'meal'
            ? '식당'
            : '공중화장실';
        const center = stopCenterCoordinates[currentStop.id] || stopCenterCoordinates['stop-yangjae'];
        setIsThinking(true);
        fetch('/api/v1/simulator/places', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: queryWord, center }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            setIsThinking(false);
            const first = data?.configured && Array.isArray(data.places) ? data.places[0] : null;
            const resolved: VoiceDetourCandidate = first
              ? {
                  kind: detour.kind,
                  placeName: first.name,
                  address: first.address || '실시간 Kakao 검색 결과',
                  distanceText: first.distanceMeters
                    ? `${first.distanceMeters >= 1000 ? `${(first.distanceMeters / 1000).toFixed(1)}km` : `${first.distanceMeters}m`} 반경`
                    : detour.distanceText,
                  extraMinutes: detour.extraMinutes,
                }
              : detour;
            setPendingDetour(resolved);
            const askText = `가장 가까운 ${resolved.placeName}이 ${resolved.distanceText}에 있어요. 약 ${resolved.extraMinutes}분 더 걸리는데, 거기로 길안내를 해드릴까요?`;
            setVoiceHint(askText);
            speak(askText, 'voice', () => startRecognition('command'));
          })
          .catch(() => {
            setIsThinking(false);
            setPendingDetour(detour);
            const askText = `가장 가까운 ${detour.placeName}이 ${detour.distanceText}에 있어요. 약 ${detour.extraMinutes}분 더 걸리는데, 거기로 길안내를 해드릴까요?`;
            setVoiceHint(askText);
            speak(askText, 'voice', () => startRecognition('command'));
          });
        return;
      }

      setPendingDetour(detour);
      const askText = `가장 가까운 ${detour.placeName}이 ${detour.distanceText}에 있어요. 약 ${detour.extraMinutes}분 더 걸리는데, 거기로 길안내를 해드릴까요?`;
      setVoiceHint(askText);
      speak(askText, 'voice', () => startRecognition('command'));
      return;
    }

    // 4-b) 고정 카테고리 외 자유 장소 검색 ("근처 다이소 찾아줘" 등)
    const customPlaceQuery = extractPlaceSearchQuery(utterance);
    if (customPlaceQuery) {
      if (aiStatus.placesConfigured) {
        const center = stopCenterCoordinates[currentStop.id] || stopCenterCoordinates['stop-yangjae'];
        setIsThinking(true);
        fetch('/api/v1/simulator/places', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: customPlaceQuery, center }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            setIsThinking(false);
            const first = data?.configured && Array.isArray(data.places) ? data.places[0] : null;
            if (first) {
              const candidate: VoiceDetourCandidate = {
                kind: 'convenience',
                placeName: first.name,
                address: first.address || 'Kakao 실시간 검색',
                distanceText: first.distanceMeters ? `${first.distanceMeters}m 반경` : '주변',
                extraMinutes: 5,
              };
              setPendingDetour(candidate);
              const askText = `${customPlaceQuery} 검색 결과 가장 가까운 ${candidate.placeName}(${candidate.distanceText})을 찾았어요. 경유지로 안내할까요?`;
              setVoiceHint(askText);
              speak(askText, 'voice', () => startRecognition('command'));
            } else {
              const msg = `주변에서 '${customPlaceQuery}' 검색 결과를 찾지 못했어요.`;
              setVoiceHint(msg);
              setLastAnswer(msg);
              speak(msg, 'voice');
            }
          })
          .catch(() => {
            setIsThinking(false);
            const msg = `주변 '${customPlaceQuery}' 검색 중 연결 오류가 발생했어요.`;
            setVoiceHint(msg);
            setLastAnswer(msg);
            speak(msg, 'voice');
          });
        return;
      }

      const msg = `현재 실시간 주변 장소 검색(Kakao Local API 키)이 연결되지 않아 '${customPlaceQuery}' 실시간 검색은 아직 지원되지 않아요. 시연 데이터로 준비된 주유소·충전소·화장실·편의점·약국·주차장·병원·세차장·카페·식당은 바로 경유 안내가 가능해요.`;
      setVoiceHint(msg);
      setLastAnswer(msg);
      speak(msg, 'voice');
      return;
    }

    // 5) 전체 브리핑 요청과 세부 질문을 명확히 구분
    const qaList = stopQADatabase[currentStop.id] || [];
    const matchedSpecificQA = qaList.find((item) =>
      item.keywords.some((k) => uttCompact.includes(k.toLowerCase().replace(/\s+/g, '')))
    );
    if (!matchedSpecificQA && isBriefingUtterance(utterance)) {
      const msg = currentStop.category.startsWith('여행')
        ? `🎙️ ${currentStop.name} 가는 길 · 재미있는 스토리 안내 중`
        : `[${currentStop.attachedFile}] 기준 ${currentStop.name} 브리핑: ${currentStop.summaryPoints[0]} / ${currentStop.summaryPoints[1]}`;
      setCardType('briefing');
      setLastAnswer(msg);
      setVoiceHint(msg);
      speak(
        currentStop.category.startsWith('여행')
          ? `가는 길에 ${currentStop.name}에 얽힌 재미있는 이야기를 들려드릴게요! ${currentStop.aiSpeechText}`
          : `첨부하신 ${currentStop.attachedFile} 자료를 바탕으로 ${currentStop.name} 미팅 내용을 설명해 드릴게요. ${currentStop.aiSpeechText}`,
        'briefing'
      );
      return;
    }

    // 6) 그 외 세부 자료 기반 Q&A 질문 (OpenAI API 연결 시 실시간 AI 응답, 미연결 시 로컬 자료 정밀 검색)
    setVoiceHint(null);
    handleAskQuestion(utterance);
  };

  utteranceHandlerRef.current = handleVoiceUtterance;

  const handleToggleMic = () => {
    stopAudio();
    if (isListening) {
      stopRecognition();
      if (wakeActiveRef.current) startRecognition('wake', { fromUserGesture: true });
      return;
    }
    setWakeWordActive(true);
    wakeActiveRef.current = true;
    flashVoiceHint('듣고 있어요. 편하게 말씀해 주세요!');
    startRecognition('command', { fromUserGesture: true });
  };

  const handleToggleWakeWord = () => {
    setWakeWordActive((prev) => {
      const next = !prev;
      wakeActiveRef.current = next;
      if (next) {
        flashVoiceHint('"카멜레온~"이라고 부르시면 바로 듣기 시작합니다.', 3500);
        startRecognition('wake', { fromUserGesture: true });
      } else {
        stopRecognition();
        flashVoiceHint(null);
      }
      return next;
    });
  };

  // 차량 배터리 부족 시뮬레이션 핸들러 (앰버 엣지 글로우 트리거)
  const handleTriggerBatteryAlert = () => {
    const nextLevel = batteryLevel > 20 ? 18 : 72;
    setBatteryLevel(nextLevel);
    if (nextLevel <= 20) {
      setCardType('qa');
      const speech = `배터리 잔량이 18%로 낮아졌습니다. 남양연구소 이동 경로 2.4km 거리에 있는 초급속 현대 E-pit 충전소를 경유지에 추가할까요?`;
      setLastAnswer(`⚡ 차량 배터리 18% 경고 감지\n남양연구소 이동 경로 2.4km 부근에 초급속 현대 E-pit 화성휴게소 충전소(대기 0대, 350kW 초급속)가 있습니다.\n"충전소 들렀다 가자"라고 말씀하시면 경로에 자동으로 반영됩니다.`);
      speak(speech, 'battery');
    } else {
      speak('배터리가 72%로 충분합니다. 정상 주행을 이어갑니다.', 'voice');
    }
  };

  useEffect(() => {
    return () => {
      stopRecognition();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // 로컬 자료 정밀 검색 (OpenAI API 키 미연결 시에도 실제 문맥·띄어쓰기 오인식 보정 답변 제공)
  const buildLocalDocumentAnswer = (query: string): { answerText: string; pageRef: string } => {
    const qLower = query.toLowerCase();
    const qCompact = qLower.replace(/[\s?!.,~]+/g, '');
    const list = stopQADatabase[currentStop.id] || [];
    const tokens = qLower
      .replace(/[?!.,~]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    // 1) QA DB 점수 매칭 (띄어쓰기 제거 포함)
    let bestQa: DocQA | null = null;
    let bestScore = 0;
    for (const item of list) {
      let score = 0;
      for (const kw of item.keywords) {
        const kwCompact = kw.toLowerCase().replace(/\s+/g, '');
        if (qCompact.includes(kwCompact)) score += 3;
      }
      for (const tk of tokens) {
        if (
          item.question.toLowerCase().replace(/\s+/g, '').includes(tk) ||
          item.answer.toLowerCase().replace(/\s+/g, '').includes(tk)
        ) {
          score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestQa = item;
      }
    }
    if (bestQa && bestScore >= 2) {
      return { answerText: bestQa.answer, pageRef: bestQa.pageRef };
    }

    // 2) 목적지·시간·장소·첨부파일 직접 질문 대응
    if (/(어디가|목적지|지금어디|어디로가|다음일정|다음코스|전체일정|오늘일정|여행코스|루트)/.test(qCompact)) {
      const restStops =
        currentStop.id === 'stop-suwon-hwaseong'
          ? [meetingStopsData[4], meetingStopsData[2]]
          : currentStop.id === 'stop-suwon-chicken'
          ? [meetingStopsData[2]]
          : meetingStopsData.slice(stopIndex + 1, 3);
      const restNames = restStops
        .filter(Boolean)
        .map((s) => `${s.name}(${s.time})`)
        .join(', ');
      return {
        answerText: `현재 목적지는 '${currentStop.name}'(${currentStop.time} 예정)이고 주소는 ${currentStop.address}입니다.${restNames ? ` 이후 일정은 ${restNames} 순서예요.` : ''}`,
        pageRef: currentStop.attachedFile,
      };
    }
    if (/(몇시|시간|일정|언제|남았)/.test(qCompact)) {
      return {
        answerText: `${currentStop.name} 일정은 ${currentStop.time}에 예정되어 있어요. 도착 전 첨부된 '${currentStop.attachedFile}' 핵심 안건을 확인해 보세요.`,
        pageRef: currentStop.attachedFile,
      };
    }
    if (/(주소|위치|어디)/.test(qCompact)) {
      return {
        answerText: `${currentStop.name} 주소는 '${currentStop.address}'입니다. ${currentStop.summaryPoints[2] || currentStop.summaryPoints[0]}`,
        pageRef: currentStop.attachedFile,
      };
    }
    if (/(첨부|파일|문서|ppt|자료이름)/.test(qCompact)) {
      return {
        answerText: `현재 연결된 자료는 '${currentStop.attachedFile}'입니다. 핵심은 ${currentStop.summaryPoints.map((s) => s.replace(/^[^\w가-힣]+/, '')).join(', ')} 입니다.`,
        pageRef: currentStop.attachedFile,
      };
    }

    // 3) summaryPoints & aiSpeechText 문장 토큰 매칭
    const sentences = [
      ...currentStop.summaryPoints,
      ...currentStop.aiSpeechText.split(/(?<=[.?!])\s+/),
    ].filter(Boolean);
    const matchedSentences = sentences.filter((s) =>
      tokens.some((tk) => s.toLowerCase().includes(tk))
    );
    if (matchedSentences.length > 0) {
      return {
        answerText: `${matchedSentences.slice(0, 2).join(' ')} (${currentStop.attachedFile} 확인)`,
        pageRef: currentStop.attachedFile,
      };
    }

    // 4) 최종 fallback (자연스러운 한국어 안내)
    return {
      answerText: `'${query}'에 대해 연결된 ${currentStop.attachedFile} 핵심 안건을 먼저 정리해 드릴게요. ${currentStop.summaryPoints.slice(0, 2).join(', ')}입니다. 더 궁금한 내용이나 주변 주유소·화장실 경유도 말씀해 주세요.`,
      pageRef: currentStop.attachedFile,
    };
  };

  // 자료 기반 질문 핸들러 ("카멜레온~ ...")
  const handleAskQuestion = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || isThinking) return;
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setQaHistory((prev) => [...prev, { role: 'user', text: query, at: nowStr }]);
    setIsThinking(true);
    setCardType('qa');
    setEdgeGlowMode('voice');
    stopAudio();

    try {
      const qaList = stopQADatabase[currentStop.id] || [];
      if (aiStatus.modelConfigured) {
        const res = await fetch('/api/v1/simulator/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            stopName: currentStop.name,
            stopTime: currentStop.time,
            stopAddress: currentStop.address,
            attachedFile: currentStop.attachedFile,
            speechText: currentStop.aiSpeechText,
            summaryPoints: currentStop.summaryPoints,
            qaNotes: qaList.map((q) => ({ question: q.question, answer: q.answer, pageRef: q.pageRef })),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.configured && typeof data.answer === 'string' && data.answer.trim()) {
            const answerText = data.answer.trim();
            setQaHistory((prev) => [
              ...prev,
              { role: 'assistant', text: answerText, pageRef: `${currentStop.attachedFile} · AI(${data.model || 'OpenAI'})`, at: nowStr },
            ]);
            setLastAnswer(answerText);
            setVoiceHint(null);
            speak(answerText, 'voice');
            return;
          }
        }
      }

      // OpenAI 키 미설정 또는 비활성 시 로컬 정밀 자료 검색 응답
      await new Promise((resolve) => setTimeout(resolve, 350));
      const { answerText, pageRef } = buildLocalDocumentAnswer(query);
      setQaHistory((prev) => [...prev, { role: 'assistant', text: answerText, pageRef, at: nowStr }]);
      setLastAnswer(answerText);
      setVoiceHint(null);
      speak(answerText, 'voice');
    } catch {
      const { answerText, pageRef } = buildLocalDocumentAnswer(query);
      setQaHistory((prev) => [...prev, { role: 'assistant', text: answerText, pageRef, at: nowStr }]);
      setLastAnswer(answerText);
      speak(answerText, 'voice');
    } finally {
      setIsThinking(false);
    }
  };

  // 1. 주 액션 핸들러 ([함께 출발하기] / [미팅 자료 브리핑])
  const handlePrimaryAction = () => {
    if (phase === 0) {
      // 출발하기
      setPhase(1);
      const startMsg = `${currentStop.name}으로 출발합니다. 첨부하신 ${currentStop.attachedFile}를 기반으로 이동 중에 브리핑을 준비할게요.`;
      speak(startMsg, 'briefing');
    } else if (cardType === 'briefing' || cardType === 'qa') {
      // 닫기
      setCardType(null);
      stopAudio();
    } else {
      // 브리핑 열기
      setCardType('briefing');
      speak(currentStop.aiSpeechText, 'briefing');
    }
  };

  // 2. 식사 제안 열기
  const handleOpenFood = () => {
    setRouteOpen(false);
    setCardType('food');
    setPhase(2);
    const speech = `양재 본사 가는 길에 양재천 맛집이 있어요. 식사하고 가실래요?`;
    speak(speech, 'briefing');
  };

  const handleAcceptFood = () => {
    setPhase(3);
    setTimeout(() => {
      setPhase(4);
      speak(`경로에 식당 경유지가 추가되었습니다.`);
    }, 1000);
  };

  // 3. 다음 정차지(남양연구소 / 집)로 전환
  const handleNextStop = (nextIdx: number) => {
    setStopIndex(nextIdx);
    setCardType('briefing');
    setPhase(1);
    setRouteOpen(false);
    setLastAnswer(null);
    setQaHistory([]);
    const target = meetingStopsData[nextIdx];
    speak(target.aiSpeechText);
  };

  const isTravelStop = currentStop.category.startsWith('여행');

  const currentTitle =
    phase === 0
      ? isTravelStop
        ? `${currentStop.name} 여행,\n가볍게 떠나볼까요?`
        : `${currentStop.name} 미팅,\n여유 있게 준비해요.`
      : cardType === 'qa'
      ? lastAnswer
        ? '자료 본문 확인 완료,\n답변을 확인하세요.'
        : '자료에 대해 궁금한 점을\n편하게 물어보세요.'
      : cardType === 'briefing'
      ? currentStop.aiBriefingTitle
      : cardType === 'food'
      ? '약속에 늦지 않게,\n점심부터 챙길까요?'
      : accepted
      ? '점심 먹고 다음 목적지로.\n준비는 이어서 도울게요.'
      : isTravelStop
      ? '도착하기 전에,\n여행 포인트를 들려드릴까요?'
      : '도착하기 전에,\n미팅 안건을 브리핑할까요?';

  const currentDetail =
    cardType === 'qa'
      ? lastAnswer
        ? `💡 카멜레온 답변:\n${lastAnswer}`
        : `첨부 문서: ${currentStop.attachedFile}\n"카멜레온~ (질문)"으로 질문하면 AI가 실제 자료 본문을 찾아 답변합니다.`
      : cardType === 'briefing'
      ? `첨부 문서: ${currentStop.attachedFile}\n이동 중간(500m 전) ${isTravelStop ? '여행 코스' : '회의 안건'} 브리핑이 열렸어요.`
      : cardType === 'food'
      ? '예정 시간과 남은 주행 일정을 함께 살펴봤어요.'
      : phase === 0
      ? `핸드폰에서 등록하신 [${isTravelStop ? '수원여행' : '카멜레온 미팅'}] 경로입니다.\n첨부파일: ${currentStop.attachedFile}`
      : isTravelStop
      ? `${currentStop.name} 방면 이동 중입니다.\n${currentStop.summaryPoints[0]}`
      : `헌릉로 진입 500m 전입니다.\n양재 본사 주차와 서비스 제휴 안건을 확인하세요.`;

  return (
    <div
      className="fixed inset-0 z-50 w-full h-[100dvh] overflow-hidden select-none flex bg-[#0b0e14]"
      style={{ fontFamily: '"Segoe UI", "Malgun Gothic", sans-serif' }}
    >
      {/* ========================================================================= */}
      {/* 좌측 (또는 전체): 기존 CARmeleon 차량용 UI 원형 그대로 유지 */}
      {/* ========================================================================= */}
      <div className={`cm-journey cm-${appearance} flex-1 min-w-0 h-full overflow-hidden flex flex-col relative`}>
        {/* 1. 최상단 상태 바 (cm-top: 6565cf5 원형 그대로, 줄바꿈 없음) */}
        <div className="cm-top h-[46px] flex items-center justify-between px-6 bg-white border-b border-[#e4e5e7] shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0 whitespace-nowrap">
            <span className="cm-wordmark font-bold text-lg tracking-tight shrink-0">carmeleon</span>
            <span className="cm-status text-xs text-slate-500 font-medium shrink-0">
              {phase === 3 ? '경로 반영 중' : accepted ? '경유지 추가됨' : isDriving ? '동행 중' : '출발 준비'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200 ml-1 truncate">
              📂 {isTravelStop ? '수원여행' : '카멜레온 미팅'} ({currentStop.attachedFile})
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0 whitespace-nowrap">
            <button
              onClick={() => {
                setShowPleosSide((v) => {
                  const next = !v;
                  if (!next) setPleosFullscreen(false);
                  return next;
                });
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all border ${
                showPleosSide
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
              }`}
              title="기존 UI는 그대로 두고 Pleos 에뮬레이터 3분할 화면(차량 뷰+내비+카멜레온)을 띄웁니다"
            >
              <Columns size={13} />
              <span>{showPleosSide ? 'Pleos 화면 닫기' : 'Pleos 실제 화면 띄우기'}</span>
            </button>

            <button
              onClick={() => setAppearance((a) => (a === 'light' ? 'dark' : 'light'))}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
              title="주간 / 야간 화면 전환"
            >
              {appearance === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>

            <div className="flex items-center gap-2">
              <span>11:42</span>
              <span>18°C</span>
              <button
                onClick={handleTriggerBatteryAlert}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                  batteryLevel <= 20
                    ? 'bg-amber-100 text-amber-800 font-extrabold ring-1 ring-amber-400 animate-pulse'
                    : 'hover:bg-slate-100 text-slate-700'
                }`}
                title="클릭: 배터리 부족(18%) 엣지 글로우 경고 시뮬레이션"
              >
                <BatteryMedium size={18} className={batteryLevel <= 20 ? 'text-amber-600' : 'text-slate-500'} />
                <span>{batteryLevel}%</span>
              </button>
            </div>

            {onSwitchToPhoneView && (
              <button
                onClick={onSwitchToPhoneView}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors border border-slate-200"
                title="스마트폰 경로 준비 모드로 전환"
              >
                <Smartphone size={13} />
                <span>폰 모드</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. 메인 컨텐츠 영역 (cm-content: 좌측 에이전트 + 우측 원래 MapScene 지도) */}
        <div
          className={`cm-content flex-1 min-h-0 grid overflow-hidden ${
            showPleosSide ? 'grid-cols-[270px_1fr] xl:grid-cols-[310px_1fr]' : 'grid-cols-[360px_1fr]'
          }`}
        >
        
        {/* 좌측: 동행 에이전트 패널 (cm-agent) */}
        <section className="cm-agent bg-white p-6 flex flex-col justify-between border-r border-[#e4e5e7] z-10 shadow-xs">
          <div>
            {/* 상단 메타 */}
            <div className="cm-agent-meta flex items-center justify-between text-xs mb-3">
              <span className="font-extrabold text-slate-900 flex items-center gap-1.5">
                <Building2 size={15} className="text-blue-600" />
                <span>{isTravelStop ? '여행 가이드 · 수원여행' : '업무 비서 · 카멜레온 미팅'}</span>
              </span>
              <span className="cm-connection text-[11px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full">
                실시간 연동
              </span>
            </div>

            {/* AI 대화 말풍선 */}
            <div className="cm-speech min-h-[90px] mb-2">
              <div className="cm-speech-title text-[22px] font-bold text-slate-900 leading-snug whitespace-pre-line tracking-tight">
                {currentTitle}
              </div>
            </div>

            {/* AI 맥락 설명 */}
            <div className="cm-context text-xs text-slate-500 leading-relaxed whitespace-pre-line min-h-[50px]">
              {currentDetail}
            </div>

            {/* 목적지 및 도착 정보 */}
            <div className="cm-trip border-t border-slate-200 pt-4 mt-2">
              <div className="cm-trip-destination flex items-center gap-2 text-sm font-bold text-slate-800">
                <MapPin size={17} className="text-blue-600 shrink-0" />
                <span className="truncate">{currentStop.name}</span>
              </div>
              <div className="cm-eta flex items-baseline gap-2.5 mt-2">
                <strong className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
                  {accepted ? newTime : originalTime}
                </strong>
                <span className="text-xs text-slate-500 font-medium">도착 예정</span>
              </div>
              <div className="cm-trip-sub text-xs text-slate-500 flex justify-between mt-1">
                <span>{accepted ? '식사 40분 포함' : '38분 · 24 km'}</span>
                <span className="text-blue-600 font-bold">📄 {currentStop.attachedFile}</span>
              </div>
            </div>
          </div>

          {/* 하단 음성 파동 및 액션 버튼 */}
          <div className="cm-agent-action flex flex-col items-center gap-3 pt-3">
            {/* 파동 애니메이션 (Wave) */}
            <div className="cm-voice-mark flex items-center gap-1 h-7" aria-hidden="true">
              {[6, 14, 24, 30, 20, 12, 6].map((h, i) => (
                <i
                  key={i}
                  className={`w-[3px] rounded-full transition-all ${
                    isSpeaking ? 'bg-blue-600 animate-pulse' : 'bg-slate-800'
                  }`}
                  style={{ height: isSpeaking ? h * 1.2 : h }}
                />
              ))}
            </div>

            {/* 주 액션 버튼 */}
            <button
              onClick={handlePrimaryAction}
              className={`w-full h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-98 shadow-sm ${
                phase === 0
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : cardType === 'briefing'
                  ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                  : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200'
              }`}
            >
              {phase === 0 ? (
                <>
                  <ArrowRight size={17} />
                  <span>함께 출발하기</span>
                </>
              ) : cardType === 'briefing' ? (
                <>
                  <X size={17} />
                  <span>브리핑 카드 닫기</span>
                </>
              ) : (
                <>
                  <FileText size={17} className="text-blue-600" />
                  <span>📄 {currentStop.name.split(' ')[1] || '미팅'} 안건 브리핑 (500m 전)</span>
                </>
              )}
            </button>

            {/* 음성 말하기 · "카멜레온~" 상시 대기 제어 */}
            <div className="w-full flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleToggleMic}
                className={`flex-1 h-9 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all border ${
                  isListening
                    ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                }`}
                title="누르고 바로 말씀하세요"
              >
                {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                <span>{isListening ? '듣는 중...' : '마이크로 말하기'}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleWakeWord}
                className={`px-2.5 h-9 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-all border ${
                  wakeWordActive
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
                title='마이크 버튼을 누르지 않아도 "카멜레온~"을 상시 감지합니다'
              >
                <Radio size={13} className={wakeWordActive ? 'animate-pulse text-blue-600' : ''} />
                <span>{wakeWordActive ? '호출 대기' : '호출 꺼짐'}</span>
              </button>
            </div>

            {(voiceHint || (isListening && liveTranscript)) && (
              <div className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 text-center leading-snug">
                {isListening && liveTranscript ? `"${liveTranscript}"` : voiceHint}
              </div>
            )}

            <span className="cm-voice-caption text-[11px] text-slate-400">
              {phase === 0 ? '준비되면 출발을 눌러주세요' : isSpeaking ? '🔊 AI가 회의 파일을 음성으로 브리핑하고 있어요' : '버튼을 누르거나 "카멜레온~"이라고 불러보세요'}
            </span>
          </div>
        </section>

        {/* 우측: 지도 및 팝업 카드 영역 (cm-map-space: 원래 MapScene 100% 보존) */}
        <div className="cm-map-space relative w-full h-full overflow-hidden bg-[#e8e7e3]">
          <MapScene destination={currentStop.name} proposed={cardType === 'food' || phase === 2} accepted={accepted} />

          {/* 1) 실제 회의파일 브리핑 카드 (카멜레온 미팅 연동) */}
          {cardType === 'briefing' && (
            <div className="absolute right-6 bottom-6 w-[520px] max-w-[calc(100%-2rem)] z-30 animate-fadeIn">
              <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3.5 backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[11px] font-bold">
                      📍 진입 500m 전 자동 브리핑
                    </span>
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <FileText size={14} className="text-blue-600" />
                      <strong>{currentStop.attachedFile}</strong>
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setCardType(null);
                      stopAudio();
                    }}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <X size={17} />
                  </button>
                </div>

                <div>
                  <div className="text-sm font-bold text-slate-900 leading-snug">
                    "{currentStop.name} 미팅 10분 전입니다. 첨부하신 {currentStop.attachedFile}의 핵심 안건을 확인하세요!"
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    위치: {currentStop.address} · 도착 예정: {currentStop.time}
                  </p>
                </div>

                {/* 등록된 회의자료 핵심 3줄 요약 */}
                <div className="space-y-1.5">
                  {currentStop.summaryPoints.map((pt, i) => (
                    <div key={i} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="font-medium leading-tight">{pt}</span>
                    </div>
                  ))}
                </div>

                {/* 자료 Q&A 바로가기 버튼 */}
                <button
                  onClick={() => {
                    setCardType('qa');
                    stopAudio();
                  }}
                  className="w-full h-9 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-indigo-200 transition-colors shadow-xs"
                >
                  <Sparkles size={14} className="text-indigo-600" />
                  <span>🎙️ 자료에 대해 추가 질문하기 ("카멜레온~")</span>
                </button>

                {/* 하단 액션 버튼 */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                  <button
                    onClick={() =>
                      isSpeaking ? stopAudio() : speak(currentStop.aiSpeechText)
                    }
                    className={`flex-1 h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                      isSpeaking
                        ? 'bg-rose-50 text-rose-700 border border-rose-200 animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {isSpeaking ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    <span>{isSpeaking ? '음성 중지' : '🔊 AI 음성으로 브리핑 듣기'}</span>
                  </button>

                  {stopIndex < meetingStopsData.length - 1 && (
                    <button
                      onClick={() => handleNextStop(stopIndex + 1)}
                      className="px-3.5 h-10 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold flex items-center gap-1 border border-blue-200"
                      title="다음 목적지 안건 보기"
                    >
                      <span>다음: {meetingStopsData[stopIndex + 1].name.split(' ')[1] || '남양연구소'}</span>
                      <ChevronRight size={14} />
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setCardType(null);
                      stopAudio();
                    }}
                    className="px-3.5 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                  >
                    확인 완료
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 1.5) 카멜레온 자료 기반 실시간 Q&A 카드 */}
          {cardType === 'qa' && (
            <div className="absolute right-6 bottom-6 w-[540px] max-w-[calc(100%-2rem)] z-30 animate-fadeIn">
              <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3.5 backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center gap-1">
                      <Sparkles size={13} className="text-indigo-600" />
                      자료 실시간 Q&A
                    </span>
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <FileText size={14} className="text-indigo-600" />
                      <strong>{currentStop.attachedFile}</strong>
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setCardType(null);
                      stopAudio();
                    }}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <X size={17} />
                  </button>
                </div>

                {/* 대화 내역 */}
                <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                  {qaHistory.length === 0 ? (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                      <p className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Bot size={15} className="text-indigo-600" />
                        <span>카멜레온 AI가 첨부문서의 본문과 수치를 직접 분석해 답변합니다.</span>
                      </p>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        "카멜레온~ 이번 수익 배분 비율이 몇 대 몇이었지?"처럼 물어보거나 아래 추천 질문을 눌러보세요.
                      </p>
                    </div>
                  ) : (
                    qaHistory.map((item, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl text-xs ${
                          item.role === 'user'
                            ? 'bg-blue-600 text-white ml-8 font-medium shadow-xs'
                            : 'bg-slate-50 text-slate-800 border border-slate-200 mr-4'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-[11px] opacity-90 flex items-center gap-1">
                            {item.role === 'user' ? '👤 운전자' : '🦎 카멜레온 AI'}
                          </span>
                          {item.pageRef && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">
                              📄 {item.pageRef}
                            </span>
                          )}
                        </div>
                        <p className="leading-relaxed whitespace-pre-line">{item.text}</p>
                      </div>
                    ))
                  )}

                  {isThinking && (
                    <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-700 flex items-center gap-2 animate-pulse">
                      <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
                      <span className="font-bold">
                        자료 [{currentStop.attachedFile}] 본문 검색 및 핵심 수치 생각 중...
                      </span>
                    </div>
                  )}
                </div>

                {/* 추천 빠른 질문 칩들 */}
                <div>
                  <div className="text-[11px] font-bold text-slate-500 mb-1.5">
                    💡 이 장소({currentStop.name.split(' ')[1] || '미팅'}) 추천 질문 (클릭 시 AI 즉시 답변):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(suggestedQuestions[currentStop.id] || []).map((q, i) => (
                      <button
                        key={i}
                        onClick={() => handleAskQuestion(q)}
                        disabled={isThinking}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 text-slate-700 text-[11px] font-medium border border-slate-200 transition-colors text-left disabled:opacity-50"
                      >
                        "{q}"
                      </button>
                    ))}
                  </div>
                </div>

                {/* 질문 입력창 및 마이크 */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (qaQuery.trim() && !isThinking) {
                      handleAskQuestion(qaQuery.trim());
                      setQaQuery('');
                    }
                  }}
                  className="flex items-center gap-2 pt-2 border-t border-slate-100"
                >
                  <input
                    type="text"
                    value={qaQuery}
                    onChange={(e) => setQaQuery(e.target.value)}
                    placeholder='예: "카멜레온~ 수익 배분 비율이 몇 대 몇이었지?"'
                    disabled={isThinking}
                    className="flex-1 h-10 px-3.5 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isThinking || !qaQuery.trim()}
                    className="px-3.5 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white text-xs font-bold flex items-center gap-1 transition-colors"
                  >
                    <Send size={14} />
                    <span>질문</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* 2) 경로 경유지(식당) 제안 카드 (cm-sheet-slot) */}
          {cardType === 'food' && (
            <div className="cm-sheet-slot" data-open="true">
              <div className="cm-food-sheet p-5 bg-white rounded-2xl shadow-2xl border border-slate-200 space-y-3.5">
                <div className="cm-sheet-top flex items-center justify-between text-xs text-slate-500">
                  <span className="font-bold text-slate-700">
                    {accepted ? '경로에 추가했어요' : '가는 길에 들러요'}
                  </span>
                  <button
                    onClick={() => {
                      setCardType(null);
                      stopAudio();
                    }}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                  >
                    <X size={17} />
                  </button>
                </div>

                <div className="cm-food-main flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <Utensils size={22} />
                  </div>
                  <div>
                    <div className="cm-food-name font-bold text-base text-slate-900">양재천 맛집 식당</div>
                    <div className="cm-food-detail text-xs text-slate-500">빠른 한식 반상 · 주차 가능</div>
                  </div>
                  <span className="cm-on-route ml-auto text-[11px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                    경로 주변
                  </span>
                </div>

                <div className="cm-impact grid grid-cols-3 gap-3 border-y border-slate-100 py-3 text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px]">추가 이동</span>
                    <strong className="block text-lg font-bold text-slate-900 mt-0.5">+6분</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">식사 시간</span>
                    <strong className="block text-lg font-bold text-slate-900 mt-0.5">40분</strong>
                  </div>
                  <div className="cm-arrival">
                    <span className="text-slate-400 text-[10px]">도착 시각</span>
                    <strong className="block text-base font-bold text-blue-600 mt-0.5">
                      <span className="line-through text-slate-400 text-xs mr-1">{originalTime}</span>
                      {newTime}
                    </strong>
                  </div>
                </div>

                <div className="cm-reason text-xs text-slate-600 leading-relaxed">
                  식사를 마쳐도 {currentStop.name} 13:30 미팅 시간까지 34분 여유가 있어요.
                </div>

                <div className="cm-sheet-actions flex gap-2">
                  <button
                    onClick={() => {
                      setCardType(null);
                      stopAudio();
                    }}
                    className="flex-1 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                  >
                    {accepted ? '패널 닫기' : '지금은 그냥 갈게'}
                  </button>
                  <button
                    onClick={accepted ? () => setCardType(null) : handleAcceptFood}
                    className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    {phase === 3 ? (
                      <>
                        <Clock3 size={15} />
                        <span>경로에 반영 중...</span>
                      </>
                    ) : accepted ? (
                      <>
                        <Check size={15} />
                        <span>이어서 함께 가기</span>
                      </>
                    ) : (
                      <>
                        <ArrowUpRight size={15} />
                        <span>경유지에 추가</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3) 사용자의 실제 '카멜레온 미팅' 정차지 목록 드로어 (cm-route-drawer) */}
          {routeOpen && (
            <div className="cm-route-drawer absolute left-6 top-6 w-[360px] z-30 animate-fadeIn">
              <div className="cm-route-card bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <span className="font-extrabold text-slate-900 text-sm">
                      {isTravelStop ? '수원여행 · 미팅 경로' : '카멜레온 미팅 · 여행'}
                    </span>
                    <span className="text-[11px] text-blue-600 font-bold ml-2">
                      등록 경로 ({meetingStopsData.length}곳)
                    </span>
                  </div>
                  <button
                    onClick={() => setRouteOpen(false)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                  >
                    <X size={17} />
                  </button>
                </div>

                <div className="space-y-2 text-xs">
                  {meetingStopsData.map((s, idx) => {
                    const isSelected = stopIndex === idx;
                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          setStopIndex(idx);
                          setRouteOpen(false);
                          setCardType('briefing');
                          speak(s.aiSpeechText);
                        }}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50 border-blue-300 shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">
                              {idx + 1}
                            </span>
                            <strong className="text-slate-900 text-xs">{s.name}</strong>
                          </div>
                          <span className="text-blue-600 font-bold text-[11px]">{s.time}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 pl-7">
                          <span>{s.category}</span>
                          <span className="text-slate-700 font-medium truncate max-w-[160px]">
                            📄 {s.attachedFile}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-[11px] text-slate-500 pt-1 leading-relaxed">
                  목적지를 클릭하면 해당 장소의 <strong>회의 첨부자료 브리핑</strong>으로 즉시 전환됩니다.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. 최하단 차량용 독 바 (cm-dock) */}
      <div className={`cm-dock h-[64px] bg-[#101114] border-t border-[#1b1c20] text-slate-200 ${showPleosSide ? 'px-3' : 'px-6'} flex items-center justify-between shrink-0 gap-1.5`}>
        {!showPleosSide && (
          <div className="cm-dock-title text-sm font-bold text-white flex items-center gap-2 whitespace-nowrap w-[220px]">
            <span>CARmeleon</span>
            <span className="text-xs text-blue-400 font-bold px-2 py-0.5 rounded bg-blue-950/60 border border-blue-800">
              카멜레온 미팅
            </span>
          </div>
        )}

        {/* 3대 핵심 독 버튼 */}
        <div className={`cm-dock-apps flex items-center ${showPleosSide ? 'gap-1' : 'gap-3'} whitespace-nowrap`}>
          {/* [경로] 버튼 */}
          <button
            onClick={() => setRouteOpen((o) => !o)}
            className={`h-11 ${showPleosSide ? 'px-2.5 text-[11px]' : 'px-5 text-xs'} rounded-xl font-bold flex items-center gap-1.5 transition-all ${
              routeOpen
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#252830]'
            }`}
          >
            <Route size={15} />
            <span>경로 ({meetingStopsData.length}곳)</span>
          </button>

          {/* [동행] 버튼 */}
          <button
            onClick={() => {
              setCardType('briefing');
              setRouteOpen(false);
              speak(currentStop.aiSpeechText, 'briefing');
            }}
            className={`h-11 ${showPleosSide ? 'px-2.5 text-[11px]' : 'px-5 text-xs'} rounded-xl font-bold flex items-center gap-1.5 transition-all ${
              cardType === 'briefing'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#252830]'
            }`}
          >
            <MessageCircle size={15} />
            <span>{isTravelStop ? '여행 브리핑' : '회의 브리핑'}</span>
          </button>

          {/* [자료 Q&A] 버튼 */}
          <button
            onClick={() => {
              setCardType(cardType === 'qa' ? null : 'qa');
              setRouteOpen(false);
              stopAudio();
            }}
            className={`h-11 ${showPleosSide ? 'px-2.5 text-[11px]' : 'px-4 text-xs'} rounded-xl font-bold flex items-center gap-1.5 transition-all ${
              cardType === 'qa'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#252830]'
            }`}
          >
            <Sparkles size={15} className={cardType === 'qa' ? 'text-white' : 'text-indigo-400'} />
            <span>자료 Q&A</span>
          </button>

          {/* [식사] 버튼 */}
          <button
            onClick={handleOpenFood}
            className={`h-11 ${showPleosSide ? 'px-2.5 text-[11px]' : 'px-5 text-xs'} rounded-xl font-bold flex items-center gap-1.5 transition-all ${
              cardType === 'food'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#252830]'
            }`}
          >
            <Utensils size={15} />
            <span>식사 경유</span>
          </button>
        </div>

        {/* 우측 음성 상태 */}
        <button
          onClick={() =>
            isSpeaking ? stopAudio() : speak(currentStop.aiSpeechText, 'briefing')
          }
          className={`cm-dock-audio ${showPleosSide ? 'text-[11px] w-auto shrink-0' : 'text-xs w-[220px]'} text-slate-400 hover:text-white flex items-center gap-1.5 justify-end transition-colors whitespace-nowrap`}
          title="클릭하여 AI 음성 재생/중지"
        >
          {isSpeaking ? <VolumeX size={16} className="text-blue-400 animate-pulse" /> : <Volume2 size={16} />}
          <span>{isSpeaking ? '음성 브리핑 중' : '음성 동행'}</span>
        </button>
      </div>
      </div>

      {/* ========================================================================= */}
      {/* 우측 (선택 시에만 표시): 기존 UI 손대지 않고 '옆에' 독립 Pleos 순정 내비 화면 */}
      {/* ========================================================================= */}
      {showPleosSide && (
        <div
          className={
            pleosFullscreen
              ? 'fixed inset-0 z-50 w-full h-[100dvh] bg-[#0e131b] flex flex-col overflow-hidden'
              : 'w-[60%] min-w-0 lg:min-w-[560px] max-w-[960px] h-full border-l-2 border-slate-800 bg-[#080b0f] flex flex-col shrink-0 relative overflow-hidden'
          }
        >
          <div className="h-9 px-4 bg-[#0e131b] border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-300 shrink-0">
            <div className="flex items-center gap-2 font-bold min-w-0">
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] shrink-0">
                PLEOS EMULATOR VIEW
              </span>
              <span className="truncate">
                Pleos Connect 3분할 (차량 뷰 · 순정 내비 · CARmeleon 듀얼)
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setPleosFullscreen((f) => !f)}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold border border-slate-700 transition-colors"
                title={pleosFullscreen ? '기존 창과 나란히 보기' : 'Pleos 차량 화면 전체 크기로 보기'}
              >
                {pleosFullscreen ? '나란히 보기' : '전체 크기로 보기'}
              </button>
              <button
                onClick={() => {
                  setPleosFullscreen(false);
                  setShowPleosSide(false);
                }}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Pleos 화면 닫기"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 relative overflow-hidden">
            <PleosNaviScreen
              currentStop={currentStop}
              isSpeaking={isSpeaking}
              edgeGlowMode={edgeGlowMode}
              batteryLevel={batteryLevel}
              lastAnswer={lastAnswer}
              hidePill={false}
              isDrivingStarted={isDriving}
              onStartJourney={() => {
                if (phase === 0) {
                  setPhase(1);
                  if (currentStop.category.startsWith('여행')) {
                    flashVoiceHint(`🎙️ ${currentStop.name} 가는 길 · 재미있는 스토리 안내 중`, 8000);
                    speak(
                      `${withRoParticle(currentStop.name)} 출발합니다! ${currentStop.aiSpeechText}`,
                      'briefing'
                    );
                  } else {
                    speak(
                      `${currentStop.name}으로 안내를 시작합니다. 이동 중 필요한 게 있으면 언제든 말씀하세요.`,
                      'briefing'
                    );
                  }
                }
              }}
              onSelectSavedRoute={(saved) => {
                clearDetourAutoTimer();
                setStopIndex(saved.stopIndex);
                setPendingDetour(null);
                setActiveDetour(null);
                setResumedFromDetour(null);
                setLastAnswer(null);
                setPhase(1);
                const targetStop = meetingStopsData[saved.stopIndex];
                if (saved.isTravel && targetStop) {
                  flashVoiceHint(`🎙️ ${targetStop.name} 가는 길 · 재미있는 여행 스토리 안내 중`, 9000);
                  speak(
                    `${saved.title} 출발할게요! ${saved.summary} 순서로 가고 있어요. ${targetStop.aiSpeechText}`,
                    'briefing'
                  );
                } else {
                  setVoiceHint(null);
                  speak(
                    `${saved.title} 경로를 내비게이션으로 전송했습니다. ${saved.destName} 안내를 시작합니다.`,
                    'briefing'
                  );
                }
              }}
              onSelectStopIndex={(nextIdx, routeTitle) => {
                clearDetourAutoTimer();
                const target = meetingStopsData[nextIdx];
                if (!target) return;
                setStopIndex(nextIdx);
                setPendingDetour(null);
                setActiveDetour(null);
                setResumedFromDetour(null);
                setLastAnswer(null);
                setPhase(1);
                const prefix = routeTitle ? `${routeTitle} 다음 목적지인 ` : '다음 목적지인 ';
                if (target.category.startsWith('여행')) {
                  flashVoiceHint(`🎙️ ${target.name} 가는 길 · 재미있는 여행 스토리 안내 중`, 9000);
                } else {
                  setVoiceHint(null);
                }
                speak(`${prefix}${withRoParticle(target.name)} 안내를 이어갈게요. ${target.aiSpeechText}`, 'briefing');
              }}
              isListening={isListening}
              isThinking={isThinking}
              aiStatus={aiStatus}
              voicePreset={voicePreset}
              onChangeVoicePreset={(nextPreset) => {
                voicePresetRef.current = nextPreset;
                setVoicePreset(nextPreset);
                speak('안녕! 난 카멜레온이야. 오늘도 기분 좋게 안내해 줄게!', 'voice');
              }}
              wakeWordActive={wakeWordActive}
              liveTranscript={liveTranscript}
              voiceHint={voiceHint}
              pendingDetour={pendingDetour}
              activeDetour={activeDetour}
              resumedFromDetour={resumedFromDetour}
              onToggleMic={handleToggleMic}
              onToggleWakeWord={handleToggleWakeWord}
              onSubmitVoiceText={(txt) => handleVoiceUtterance(txt)}
              onConfirmDetour={confirmDetour}
              onCancelDetour={cancelDetour}
              onParkAtDetour={parkAtDetour}
              onReboardResume={reboardResume}
              onTriggerVoice={handleToggleMic}
              onTriggerBatteryAlert={handleTriggerBatteryAlert}
              onTriggerBriefing={() => {
                if (currentStop.category.startsWith('여행')) {
                  flashVoiceHint(`🎙️ ${currentStop.name} 가는 길 · 재미있는 여행 스토리 안내 중`, 9000);
                }
                speak(currentStop.aiSpeechText, 'briefing');
              }}
              onStopAudio={stopAudio}
              onClearResponse={() => {
                clearDetourAutoTimer();
                setResumedFromDetour(null);
                setLastAnswer(null);
                setVoiceHint(null);
                stopAudio();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
