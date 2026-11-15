// CARmeleon 통합 날짜 처리 및 정렬 유틸리티

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 오늘 또는 offsetDays 후의 날짜를 "MM.DD (오늘)" 또는 "MM.DD (요일)" 형식으로 반환
 */
export const getTodayDateString = (offsetDays = 0): string => {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dateNum = String(d.getDate()).padStart(2, '0');
  if (offsetDays === 0) {
    return `${m}.${dateNum} (오늘)`;
  }
  return `${m}.${dateNum} (${DAY_NAMES[d.getDay()]})`;
};

/**
 * offsetDays 후의 날짜를 HTML5 date input용 YYYY-MM-DD 문자열로 반환
 */
export const getIsoDateString = (offsetDays = 0): string => {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  const year = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${m}-${day}`;
};

/**
 * ISO 날짜(YYYY-MM-DD)를 사용자 친화적인 "MM.DD (오늘)" 또는 "MM.DD (요일)"로 변환
 */
export const formatIsoToDisplayDate = (isoDateStr: string): string => {
  if (!isoDateStr) return getTodayDateString(0);

  const parts = isoDateStr.split('-');
  if (parts.length < 3) return isoDateStr;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  const target = new Date(year, month - 1, day);
  const now = new Date();

  const isToday =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();

  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');

  if (isToday) {
    return `${mStr}.${dStr} (오늘)`;
  }

  const dayName = DAY_NAMES[target.getDay()] || '요일';
  return `${mStr}.${dStr} (${dayName})`;
};

/**
 * 다양한 형식의 날짜 문자열을 YYYY-MM-DD ISO 형식으로 역변환 (달력 기본값 바인딩용)
 */
export const parseDisplayDateToIso = (dateStr: string): string => {
  if (!dateStr) return getIsoDateString(0);

  // 이미 YYYY-MM-DD 형태인 경우
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  const now = new Date();
  const currentYear = now.getFullYear();

  if (dateStr.includes('오늘')) {
    return getIsoDateString(0);
  }

  // MM.DD 또는 MM-DD 추출
  const match = dateStr.match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (match) {
    const month = String(parseInt(match[1], 10)).padStart(2, '0');
    const day = String(parseInt(match[2], 10)).padStart(2, '0');
    return `${currentYear}-${month}-${day}`;
  }

  return getIsoDateString(0);
};

/**
 * 날짜 문자열을 밀리초 타임스탬프 숫자로 변환하여 오름차순(가까운 날짜순) 정렬에 사용
 */
export const parseRouteDateKey = (dateStr: string): number => {
  if (!dateStr) return 9999999999999;
  const now = new Date();
  const currentYear = now.getFullYear();

  // 1) ISO 포맷인 경우: 2026-11-10
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  // 2) '오늘' 포함
  if (dateStr.includes('오늘')) {
    return new Date(currentYear, now.getMonth(), now.getDate()).getTime();
  }

  // 3) MM.DD 또는 MM-DD 형식 (예: 11.14 (토), 11-14)
  const match = dateStr.match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (match) {
    const month = parseInt(match[1], 10) - 1;
    const day = parseInt(match[2], 10);
    return new Date(currentYear, month, day).getTime();
  }

  return 9999999999999;
};

/**
 * 오늘 자정(00:00:00) 기준 과거 날짜인지 판별 (지난 루트 보관함 자동 격리용)
 */
export const isPastRouteDate = (dateStr: string): boolean => {
  if (!dateStr) return false;
  if (dateStr.includes('오늘') || dateStr.includes('(오늘)')) return false;
  if (dateStr.includes('지난') || dateStr.includes('(지난 루트)')) return true;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetTime = parseRouteDateKey(dateStr);

  return targetTime < todayStart;
};
