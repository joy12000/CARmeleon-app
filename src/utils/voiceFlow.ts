export type DetourKind =
  | 'gas'
  | 'restroom'
  | 'charger'
  | 'convenience'
  | 'pharmacy'
  | 'parking'
  | 'hospital'
  | 'carwash'
  | 'meal'
  | 'coffee';

export interface VoiceDetourCandidate {
  kind: DetourKind;
  placeName: string;
  address: string;
  distanceText: string;
  extraMinutes: number;
}

export interface ActiveDetour {
  candidate: VoiceDetourCandidate;
  phase: 'TO_DETOUR' | 'PARKED_AT_DETOUR';
  originalStopId: string;
  originalStopName: string;
  originalStopTime: string;
}

const DETOUR_CANDIDATES: Record<string, Record<DetourKind, VoiceDetourCandidate>> = {
  'stop-yangjae': {
    gas: {
      kind: 'gas',
      placeName: 'SK에너지 양재 IC 주유소',
      address: '서울 서초구 양재대로 158',
      distanceText: '800m 전방',
      extraMinutes: 4,
    },
    restroom: {
      kind: 'restroom',
      placeName: '양재 시민의숲 개방 화장실',
      address: '서울 서초구 매헌로 99',
      distanceText: '650m 전방',
      extraMinutes: 3,
    },
    charger: {
      kind: 'charger',
      placeName: '양재 만남의광장 초급속 충전소',
      address: '경부고속도로 하행선 416',
      distanceText: '1.1km 전방',
      extraMinutes: 12,
    },
    convenience: {
      kind: 'convenience',
      placeName: 'GS25 양재역사거리점',
      address: '서울 서초구 강남대로 212',
      distanceText: '450m 전방',
      extraMinutes: 2,
    },
    pharmacy: {
      kind: 'pharmacy',
      placeName: '양재 온누리약국',
      address: '서울 서초구 남부순환로 2592',
      distanceText: '600m 전방',
      extraMinutes: 3,
    },
    parking: {
      kind: 'parking',
      placeName: '매헌 시민의숲 공영주차장',
      address: '서울 서초구 매헌로 99',
      distanceText: '680m 전방',
      extraMinutes: 3,
    },
    hospital: {
      kind: 'hospital',
      placeName: '양재 메디컬 응급의원',
      address: '서울 서초구 강남대로 228',
      distanceText: '720m 전방',
      extraMinutes: 4,
    },
    carwash: {
      kind: 'carwash',
      placeName: '양재 셀프오토 세차장',
      address: '서울 서초구 양재천로 117',
      distanceText: '950m 전방',
      extraMinutes: 8,
    },
    meal: {
      kind: 'meal',
      placeName: '양재천 브런치·한식 다이닝',
      address: '서울 서초구 양재천로 131',
      distanceText: '900m 전방',
      extraMinutes: 6,
    },
    coffee: {
      kind: 'coffee',
      placeName: '양재대로 드라이브스루 카페',
      address: '서울 서초구 양재대로 12길',
      distanceText: '500m 전방',
      extraMinutes: 4,
    },
  },
  'stop-namyang': {
    gas: {
      kind: 'gas',
      placeName: '현대오일뱅크 남양직영 주유소',
      address: '경기 화성시 남양읍 남양로 620',
      distanceText: '1.0km 전방',
      extraMinutes: 4,
    },
    restroom: {
      kind: 'restroom',
      placeName: '비봉휴게소 개방 화장실',
      address: '경기 화성시 비봉면 서해안로',
      distanceText: '1.2km 전방',
      extraMinutes: 4,
    },
    charger: {
      kind: 'charger',
      placeName: '화성 E-pit 초고속 충전소',
      address: '경기 화성시 남양읍 현대연구소로',
      distanceText: '1.8km 전방',
      extraMinutes: 15,
    },
    convenience: {
      kind: 'convenience',
      placeName: 'CU 화성남양대로점',
      address: '경기 화성시 남양읍 시청로 140',
      distanceText: '750m 전방',
      extraMinutes: 3,
    },
    pharmacy: {
      kind: 'pharmacy',
      placeName: '남양 중앙약국',
      address: '경기 화성시 남양읍 역골중앙로 42',
      distanceText: '1.1km 전방',
      extraMinutes: 4,
    },
    parking: {
      kind: 'parking',
      placeName: '화성시청 남측 공영주차장',
      address: '경기 화성시 남양읍 시청로 159',
      distanceText: '950m 전방',
      extraMinutes: 3,
    },
    hospital: {
      kind: 'hospital',
      placeName: '화성중앙종합병원',
      address: '경기 화성시 향남읍 평3길 8',
      distanceText: '2.3km 전방',
      extraMinutes: 7,
    },
    carwash: {
      kind: 'carwash',
      placeName: '남양 워시존 셀프세차장',
      address: '경기 화성시 남양읍 남양성지로 185',
      distanceText: '1.3km 전방',
      extraMinutes: 9,
    },
    meal: {
      kind: 'meal',
      placeName: '남양읍 한우 국밥',
      address: '경기 화성시 남양읍 시청로',
      distanceText: '1.5km 전방',
      extraMinutes: 7,
    },
    coffee: {
      kind: 'coffee',
      placeName: '남양대로 드라이브스루 카페',
      address: '경기 화성시 남양읍 남양로',
      distanceText: '850m 전방',
      extraMinutes: 3,
    },
  },
  'stop-home': {
    gas: {
      kind: 'gas',
      placeName: 'GS칼텍스 도곡 직영주유소',
      address: '서울 강남구 남부순환로 2718',
      distanceText: '550m 전방',
      extraMinutes: 3,
    },
    restroom: {
      kind: 'restroom',
      placeName: '양재역 공영주차장 화장실',
      address: '서울 서초구 강남대로 221',
      distanceText: '500m 전방',
      extraMinutes: 2,
    },
    charger: {
      kind: 'charger',
      placeName: '서초구청 공영 급속 충전소',
      address: '서울 서초구 남부순환로 2584',
      distanceText: '750m 전방',
      extraMinutes: 10,
    },
    convenience: {
      kind: 'convenience',
      placeName: '세븐일레븐 도곡스타점',
      address: '서울 강남구 도곡로 210',
      distanceText: '350m 전방',
      extraMinutes: 2,
    },
    pharmacy: {
      kind: 'pharmacy',
      placeName: '도곡 미소약국',
      address: '서울 강남구 남부순환로 2736',
      distanceText: '480m 전방',
      extraMinutes: 2,
    },
    parking: {
      kind: 'parking',
      placeName: '양재역 환승 공영주차장',
      address: '서울 서초구 강남대로 221',
      distanceText: '520m 전방',
      extraMinutes: 3,
    },
    hospital: {
      kind: 'hospital',
      placeName: '강남세브란스병원 응급실',
      address: '서울 강남구 언주로 211',
      distanceText: '1.4km 전방',
      extraMinutes: 5,
    },
    carwash: {
      kind: 'carwash',
      placeName: '도곡 논스톱 자동세차장',
      address: '서울 강남구 논현로 145',
      distanceText: '800m 전방',
      extraMinutes: 7,
    },
    meal: {
      kind: 'meal',
      placeName: '도곡동 수제 도시락',
      address: '서울 강남구 남부순환로 2741',
      distanceText: '650m 전방',
      extraMinutes: 5,
    },
    coffee: {
      kind: 'coffee',
      placeName: '강남대로 스페셜티 테이크아웃',
      address: '서울 서초구 강남대로 240',
      distanceText: '400m 전방',
      extraMinutes: 3,
    },
  },
  'stop-suwon-hwaseong': {
    gas: {
      kind: 'gas',
      placeName: 'SK에너지 장안문 주유소',
      address: '경기 수원시 팔달구 정조로 932',
      distanceText: '720m 전방',
      extraMinutes: 4,
    },
    restroom: {
      kind: 'restroom',
      placeName: '화성행궁 개방 공중화장실',
      address: '경기 수원시 팔달구 정조로 825',
      distanceText: '500m 전방',
      extraMinutes: 2,
    },
    charger: {
      kind: 'charger',
      placeName: '화서문 공영주차장 급속충전소',
      address: '경기 수원시 팔달구 장안로 18',
      distanceText: '850m 전방',
      extraMinutes: 11,
    },
    convenience: {
      kind: 'convenience',
      placeName: 'GS25 행궁광장점',
      address: '경기 수원시 팔달구 정조로 840',
      distanceText: '420m 전방',
      extraMinutes: 2,
    },
    pharmacy: {
      kind: 'pharmacy',
      placeName: '행궁 온누리약국',
      address: '경기 수원시 팔달구 팔달로 105',
      distanceText: '600m 전방',
      extraMinutes: 3,
    },
    parking: {
      kind: 'parking',
      placeName: '화성행궁 공영주차장',
      address: '경기 수원시 팔달구 정조로 825',
      distanceText: '520m 전방',
      extraMinutes: 3,
    },
    hospital: {
      kind: 'hospital',
      placeName: '수원 성빈센트병원 응급실',
      address: '경기 수원시 팔달구 중부대로 93',
      distanceText: '1.6km 전방',
      extraMinutes: 6,
    },
    carwash: {
      kind: 'carwash',
      placeName: '영화동 워시존 셀프세차장',
      address: '경기 수원시 장안구 경수대로 925',
      distanceText: '1.1km 전방',
      extraMinutes: 8,
    },
    meal: {
      kind: 'meal',
      placeName: '행궁동 한옥 한정식',
      address: '경기 수원시 팔달구 화서문로 32',
      distanceText: '650m 전방',
      extraMinutes: 5,
    },
    coffee: {
      kind: 'coffee',
      placeName: '행궁동 정지영커피로스터즈',
      address: '경기 수원시 팔달구 수화로 42',
      distanceText: '580m 전방',
      extraMinutes: 4,
    },
  },
  'stop-suwon-chicken': {
    gas: {
      kind: 'gas',
      placeName: 'GS칼텍스 팔달문 주유소',
      address: '경기 수원시 팔달구 중부대로 48',
      distanceText: '680m 전방',
      extraMinutes: 4,
    },
    restroom: {
      kind: 'restroom',
      placeName: '남수동 공영주차장 개방 화장실',
      address: '경기 수원시 팔달구 수원천로 265',
      distanceText: '380m 전방',
      extraMinutes: 2,
    },
    charger: {
      kind: 'charger',
      placeName: '팔달구청 공영주차장 급속충전소',
      address: '경기 수원시 팔달구 창룡대로 23',
      distanceText: '900m 전방',
      extraMinutes: 10,
    },
    convenience: {
      kind: 'convenience',
      placeName: 'CU 수원통닭거리점',
      address: '경기 수원시 팔달구 수원천로 274',
      distanceText: '300m 전방',
      extraMinutes: 2,
    },
    pharmacy: {
      kind: 'pharmacy',
      placeName: '팔달문 시장약국',
      address: '경기 수원시 팔달구 팔달문로 6',
      distanceText: '450m 전방',
      extraMinutes: 2,
    },
    parking: {
      kind: 'parking',
      placeName: '남수동 공영주차장',
      address: '경기 수원시 팔달구 수원천로 265',
      distanceText: '390m 전방',
      extraMinutes: 3,
    },
    hospital: {
      kind: 'hospital',
      placeName: '수원 동수원병원 응급실',
      address: '경기 수원시 팔달구 중부대로 165',
      distanceText: '1.9km 전방',
      extraMinutes: 6,
    },
    carwash: {
      kind: 'carwash',
      placeName: '인계동 오토 워시',
      address: '경기 수원시 팔달구 인계로 108',
      distanceText: '1.4km 전방',
      extraMinutes: 8,
    },
    meal: {
      kind: 'meal',
      placeName: '수원왕갈비통닭 진미통닭',
      address: '경기 수원시 팔달구 정조로800번길 21',
      distanceText: '280m 전방',
      extraMinutes: 4,
    },
    coffee: {
      kind: 'coffee',
      placeName: '수원천 로스터리 테이크아웃',
      address: '경기 수원시 팔달구 수원천로 292',
      distanceText: '350m 전방',
      extraMinutes: 3,
    },
  },
};

const WAKE_REGEX =
  /(?:(?:저기요?|이봐요?|헤이|오케이|안녕|야|어이|어|음)\s+)*(?:카\s*멜\s*[레리래네내니]?\s*[온론언오옹요]|카\s*멜\s*내\s*용|카\s*메\s*라\s*온|카\s*메\s*레\s*온|카\s*메\s*론|카\s*밀\s*[레리]?\s*[온론언]|가\s*멜\s*[레리]?\s*[온론언]|커\s*멜\s*[레리]?\s*[온론언]|케\s*멜\s*[레리]?\s*[온론언]|캐\s*멜\s*[레리]?\s*[온론언]|까\s*멜\s*[레리]?\s*[온론언]|차\s*멜\s*[레리]?\s*[온론언]|하\s*멜\s*[레리]?\s*[온론언]|파\s*멜\s*[레리]?\s*[온론언]|참\s*엘\s*레\s*온|car\s*meleon|chameleon|카\s*멜(?=$|[\s~,.!?아아야어님요]))(?:\s+(?:야|아|님)(?=$|[\s~,.!?:])|(?:[아아야어이님요]|한테|에게)(?=$|[\s~,.!?:]))?[ ~,.!?:]*/i;

/**
 * 한국어 STT 결과에서 "카멜레온~" 호출어(유사 발음·오인식 포함) 여부를 판별하고 뒤따르는 명령문을 추출합니다.
 */
export function extractWakeCommand(raw: string): { woke: boolean; command: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { woke: false, command: '' };
  const match = trimmed.match(WAKE_REGEX);
  if (!match || match.index === undefined) return { woke: false, command: trimmed };
  const before = trimmed.slice(0, match.index).trim();
  const after = trimmed.slice(match.index + match[0].length).trim();
  const command = after || (before.length >= 2 && !/^(저기|저기요|야|어이|어|음|헤이|안녕)$/.test(before) ? before : '');
  return {
    woke: true,
    command,
  };
}

/**
 * Web Speech API가 반환한 여러 후보 문장(maxAlternatives) 중 호출어가 인식된 최적 후보를 고릅니다.
 */
export function pickBestTranscriptAlternative(alternatives: string[]): {
  transcript: string;
  woke: boolean;
  command: string;
} {
  const cleaned = alternatives.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return { transcript: '', woke: false, command: '' };
  let firstWake: { transcript: string; woke: boolean; command: string } | null = null;
  for (const alt of cleaned) {
    const parsed = extractWakeCommand(alt);
    if (parsed.woke) {
      const candidate = { transcript: alt, woke: true, command: parsed.command };
      if (parsed.command.length >= 2) return candidate;
      if (!firstWake) firstWake = candidate;
    }
  }
  if (firstWake) return firstWake;
  const fallback = cleaned[0];
  return { transcript: fallback, woke: false, command: fallback };
}

export function isBriefingUtterance(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  const compact = t.replace(/\s+/g, '');
  if (!t) return false;
  const looksLikeSpecificQuestion = [
    '?',
    '뭐',
    '무슨',
    '몇',
    '얼마',
    '어디',
    '언제',
    '누구',
    '왜',
    '어떻게',
    '페이지',
    'p ',
    '알려',
  ].some((k) => t.includes(k));
  if (looksLikeSpecificQuestion && !['전체', '브리핑', '미팅장소설명'].some((k) => compact.includes(k))) {
    return false;
  }
  return [
    '브리핑',
    '미팅장소설명',
    '장소설명',
    '자료바탕으로설명',
    '전체요약',
    '자료요약',
    '요약해',
  ].some((k) => compact.includes(k));
}

export function isConfirmUtterance(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[~!?. ]+/g, '');
  if (!t) return false;
  return ['네', '예', '응', '어', '좋아', '그래', '해줘', '안내해', '변경', '가자', '거기로', '콜', '맞아', '부탁', 'ok', 'yes'].some(
    (k) => t === k || t.includes(k)
  );
}

export function isCancelUtterance(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[~!?. ]+/g, '');
  if (!t) return false;
  return ['아니', '아뇨', '취소', '됐어', '싫어', '그만', '안해', '괜찮아', '말고', 'no'].some(
    (k) => t === k || t.includes(k)
  );
}

export function isReboardUtterance(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  return ['재탑승', '다시출발', '원래목적지', '이어서', '계속가', '본사로가'].some((k) =>
    t.includes(k)
  );
}

export function detectDetourKind(raw: string): DetourKind | null {
  const t = raw.trim().toLowerCase();
  const compact = t.replace(/\s+/g, '');
  // 구체적인 시설 키워드를 먼저 판별해 "주유소 급해"가 화장실로 오인되지 않도록 함 (띄어쓰기/음성 오인식 포함)
  if (
    ['주유소', '주요소', '주유서', '주유', '기름', '연료', '휘발유', '경유', '디젤', 'lpg', 'sk주유', 'gs칼텍스', '에쓰오일', '오일뱅크'].some((k) =>
      compact.includes(k)
    )
  ) {
    return 'gas';
  }
  if (['충전소', '충전', '배터리', '전기차', 'e-pit', '이피트', '슈퍼차저'].some((k) => compact.includes(k))) {
    return 'charger';
  }
  if (['편의점', '편이점', 'cu', '씨유', 'gs25', '지에스', '세븐일레븐', '이마트24', '미니스톱'].some((k) => compact.includes(k))) {
    return 'convenience';
  }
  if (['약국', '감기약', '두통약', '소화제', '타이레놀', '약좀'].some((k) => compact.includes(k))) {
    return 'pharmacy';
  }
  if (['주차장', '공영주차', '주차할', '주차하', '차세울'].some((k) => compact.includes(k))) {
    return 'parking';
  }
  if (['병원', '응급실', '의원', '치과'].some((k) => compact.includes(k))) {
    return 'hospital';
  }
  if (['세차장', '세차'].some((k) => compact.includes(k))) {
    return 'carwash';
  }
  if (['커피', '카페', '까페', '아메리카노', '스타벅스', '스벅', '투썸', '이디야', '메가커피', '컴포즈', '음료', '테이크아웃'].some((k) => compact.includes(k))) {
    return 'coffee';
  }
  if (['배고', '식사', '밥', '점심', '저녁', '아침', '식당', '맛집', '국밥', '한식', '출출', '먹을'].some((k) => compact.includes(k))) {
    return 'meal';
  }
  if (['화장실', '화장시', '공중화장실', '개방화장실', '볼일', '쉬', '휴게소', '급해', '급하', '오줌'].some((k) => compact.includes(k))) {
    return 'restroom';
  }
  return null;
}

/**
 * 고정 경유 카테고리에 없는 자유 장소 탐색 발화("근처 다이소 찾아줘", "올리브영 경유해줘")에서 검색어를 추출합니다.
 */
export function extractPlaceSearchQuery(raw: string): string | null {
  const t = raw.trim();
  if (!t || detectDetourKind(t)) return null;
  if (/(미팅|자료|안건|ppt|발표|수익|보안|계약|요약|브리핑|일정|시간|언제|누구|목소리)/i.test(t)) return null;
  const placeIntent = /(찾아|검색|경유|들렀다|들러|데려다|근처|주변|가까운)/i.test(t);
  if (!placeIntent) return null;
  const cleaned = t
    .replace(/(가까운|근처|주변|가장|제일|빨리|지금|혹시)/g, ' ')
    .replace(/(찾아줘|찾아봐|검색해줘|경유해줘|들렀다\s*가자|들러줘|가자|데려다줘|어디야|어디\s*있어|있어\??)/g, ' ')
    .replace(/[~!?.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 1 ? cleaned : t;
}

export function findDetourCandidate(raw: string, stopId: string): VoiceDetourCandidate | null {
  const kind = detectDetourKind(raw);
  if (!kind) return null;
  const table = DETOUR_CANDIDATES[stopId] || DETOUR_CANDIDATES['stop-yangjae'];
  return table[kind] || null;
}

export interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence?: number;
}

export interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  length?: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

export interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((e: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onaudiostart?: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export function getSpeechRecognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** 한국어 받침 여부에 따라 '로' / '으로' 조사를 자연스럽게 붙입니다. */
export function withRoParticle(placeName: string): string {
  const trimmed = placeName.trim();
  if (!trimmed) return placeName;
  const last = trimmed.charCodeAt(trimmed.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const jong = (last - 0xac00) % 28;
    return jong === 0 || jong === 8 ? `${trimmed}로` : `${trimmed}으로`;
  }
  return `${trimmed}으로`;
}

export type VoiceTonePreset = 'cute' | 'bubbly' | 'calm';

/** 브라우저에서 가장 밝고 자연스러운 한국어 음성을 우선순위로 고릅니다. */
export function pickCuteKoreanVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const koVoices = voices.filter(
    (v) => v.lang.toLowerCase().startsWith('ko') || /korean|한국/i.test(v.name)
  );
  if (koVoices.length === 0) return null;
  const priorities = [
    /sunhi.*natural|sunhi/i,
    /google\s*한국의|google.*korean/i,
    /yuna|sora/i,
    /heami/i,
  ];
  for (const pattern of priorities) {
    const found = koVoices.find((v) => pattern.test(v.name));
    if (found) return found;
  }
  return koVoices[0];
}

/** SpeechSynthesisUtterance에 귀여운 카멜레온 캐릭터 톤(피치·템포·음성)을 적용합니다. */
export function configureCuteUtterance(
  utterance: SpeechSynthesisUtterance,
  preset: VoiceTonePreset = 'cute',
  voices?: SpeechSynthesisVoice[]
): void {
  utterance.lang = 'ko-KR';
  utterance.volume = 1.0;
  const list =
    voices ??
    (typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis.getVoices()
      : []);
  const selected = pickCuteKoreanVoice(list);
  if (selected) utterance.voice = selected;

  // Gemini TTS 미연결 시 브라우저 기본 음성도 날카롭지 않고 부드럽게 조정
  const isHeami = Boolean(selected && /heami/i.test(selected.name));
  if (preset === 'bubbly') {
    utterance.pitch = isHeami ? 1.18 : 1.24;
    utterance.rate = 1.06;
  } else if (preset === 'calm') {
    utterance.pitch = isHeami ? 1.0 : 1.02;
    utterance.rate = 0.98;
  } else {
    utterance.pitch = isHeami ? 1.11 : 1.14;
    utterance.rate = 1.03;
  }
}
