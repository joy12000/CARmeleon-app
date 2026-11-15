export interface VehicleColorOption {
  code: string; // 현대 공식 컬러 코드 (예: 'SAW', 'C5G', 'MZH')
  name: string; // 한글 대표 컬러명 (예: '아틀라스 화이트')
  englishName: string; // 공식 영문 컬러명 (예: 'Atlas White')
  hexColor: string; // 스와치 칩 색상 코드
  image3D: string; // 공식 3D 투명 렌더링 이미지 경로
  isMatte?: boolean; // 무광 여부
}

export interface VehicleInfo {
  id: string;
  name: string; // 한글 대표 모델명 (예: '아이오닉 5')
  englishName: string; // 영문 볼드 타이틀 (예: 'IONIQ 5')
  trim: string; // 공식 트림명 (예: 'Long Range Prestige 2WD')
  type: 'EV' | 'HV';
  batteryCapacity: string;
  maxRange: string;
  defaultColorCode: string;
  colors: VehicleColorOption[];
  aliases: string[]; // 매칭용 별칭 목록
}

export const VEHICLE_CATALOG: VehicleInfo[] = [
  {
    id: 'ioniq5',
    name: '아이오닉 5',
    englishName: 'IONIQ 5',
    trim: 'Long Range Prestige 2WD',
    type: 'EV',
    batteryCapacity: '77.4 kWh',
    maxRange: '458 km',
    defaultColorCode: 'SAW',
    colors: [
      {
        code: 'SAW',
        name: '아틀라스 화이트',
        englishName: 'Atlas White',
        hexColor: '#F6F6F7',
        image3D: '/ioniq5_atlas_white.png'
      },
      {
        code: 'C5G',
        name: '사이버 그레이 메탈릭',
        englishName: 'Cyber Gray Metallic',
        hexColor: '#9DA2A6',
        image3D: '/ioniq5_cyber_gray.png'
      },
      {
        code: 'MZH',
        name: '팬텀 블랙 펄',
        englishName: 'Phantom Black Pearl',
        hexColor: '#1F2022',
        image3D: '/ioniq5_phantom_black.png'
      },
      {
        code: 'R3G',
        name: '갤럭틱 그레이 메탈릭',
        englishName: 'Galactic Gray Metallic',
        hexColor: '#5C6063',
        image3D: '/ioniq5_galactic_gray.png'
      },
      {
        code: 'W3T',
        name: '그래비티 골드 매트',
        englishName: 'Gravity Gold Matte',
        hexColor: '#C4B292',
        image3D: '/ioniq5_gravity_gold.png',
        isMatte: true
      },
      {
        code: 'T5R',
        name: '슈팅스타 그레이 매트',
        englishName: 'Shooting-Star Gray Matte',
        hexColor: '#75787B',
        image3D: '/ioniq5_shooting_star.png',
        isMatte: true
      },
      {
        code: 'U3P',
        name: '루시드 블루 펄',
        englishName: 'Lucid Blue Pearl',
        hexColor: '#2A4A75',
        image3D: '/ioniq5_lucid_blue.png'
      },
      {
        code: 'M9U',
        name: '디지털 틸그린 펄',
        englishName: 'Digital Teal-Green Pearl',
        hexColor: '#2E494A',
        image3D: '/ioniq5_digital_teal.png'
      }
    ],
    aliases: ['아이오닉5', '아이오닉 5', 'ioniq 5', 'ioniq5', '아이오닉']
  },
  {
    id: 'kona_ev',
    name: '디 올 뉴 코나 EV',
    englishName: 'KONA Electric',
    trim: 'Inspiration Long Range 2WD',
    type: 'EV',
    batteryCapacity: '64.8 kWh',
    maxRange: '417 km',
    defaultColorCode: 'SAW',
    colors: [
      {
        code: 'SAW',
        name: '아틀라스 화이트',
        englishName: 'Atlas White',
        hexColor: '#F6F6F7',
        image3D: '/kona_ev_3d.png'
      },
      {
        code: 'C5G',
        name: '사이버 그레이 메탈릭',
        englishName: 'Cyber Gray',
        hexColor: '#9DA2A6',
        image3D: '/kona_ev_3d.png'
      },
      {
        code: 'MZH',
        name: '어비스 블랙 펄',
        englishName: 'Abyss Black Pearl',
        hexColor: '#1F2022',
        image3D: '/kona_ev_3d.png'
      }
    ],
    aliases: ['코나', '코나ev', '코나 EV', '디 올 뉴 코나 EV', '디올뉴코나', 'kona']
  },
  {
    id: 'ioniq6',
    name: '아이오닉 6',
    englishName: 'IONIQ 6',
    trim: 'Long Range Exclusive Plus 2WD',
    type: 'EV',
    batteryCapacity: '77.4 kWh',
    maxRange: '524 km',
    defaultColorCode: 'W3T',
    colors: [
      {
        code: 'W3T',
        name: '그래비티 골드 매트',
        englishName: 'Gravity Gold Matte',
        hexColor: '#C4B292',
        image3D: '/ioniq6_3d.png',
        isMatte: true
      },
      {
        code: 'SAW',
        name: '세레니티 화이트 펄',
        englishName: 'Serenity White Pearl',
        hexColor: '#F6F6F7',
        image3D: '/ioniq6_3d.png'
      },
      {
        code: 'R3G',
        name: '녹턴 그레이 메탈릭',
        englishName: 'Nocturne Gray Metallic',
        hexColor: '#5C6063',
        image3D: '/ioniq6_3d.png'
      }
    ],
    aliases: ['아이오닉6', '아이오닉 6', 'ioniq 6', 'ioniq6']
  },
  {
    id: 'genesis_gv60',
    name: '제네시스 GV60',
    englishName: 'GENESIS GV60',
    trim: 'Performance AWD Dual Motor',
    type: 'EV',
    batteryCapacity: '77.4 kWh',
    maxRange: '400 km',
    defaultColorCode: 'SAW',
    colors: [
      {
        code: 'SAW',
        name: '우유니 화이트',
        englishName: 'Uyuni White',
        hexColor: '#F6F6F7',
        image3D: '/genesis_gv60_3d.png'
      },
      {
        code: 'C5G',
        name: '마테호른 화이트 매트',
        englishName: 'Matterhorn White Matte',
        hexColor: '#E2E5E8',
        image3D: '/genesis_gv60_3d.png',
        isMatte: true
      },
      {
        code: 'MZH',
        name: '비크 블랙',
        englishName: 'Vik Black',
        hexColor: '#1F2022',
        image3D: '/genesis_gv60_3d.png'
      }
    ],
    aliases: ['gv60', 'GV60', '제네시스', '제네시스 GV60', 'genesis']
  },
  {
    id: 'santafe',
    name: '디 올 뉴 싼타페 하이브리드',
    englishName: 'SANTA FE Hybrid',
    trim: 'Calligraphy 1.6T HEV AWD',
    type: 'HV',
    batteryCapacity: '1.49 kWh (HEV)',
    maxRange: '880 km',
    defaultColorCode: 'SAW',
    colors: [
      {
        code: 'SAW',
        name: '크리미 화이트 펄',
        englishName: 'Creamy White Pearl',
        hexColor: '#F6F6F7',
        image3D: '/santafe_3d.png'
      },
      {
        code: 'C5G',
        name: '사이버 세이지 펄',
        englishName: 'Cyber Sage Pearl',
        hexColor: '#8C9A96',
        image3D: '/santafe_3d.png'
      },
      {
        code: 'MZH',
        name: '어비스 블랙 펄',
        englishName: 'Abyss Black Pearl',
        hexColor: '#1F2022',
        image3D: '/santafe_3d.png'
      }
    ],
    aliases: ['싼타페', '산타페', 'santafe', '디 올 뉴 싼타페', '싼타페 하이브리드']
  }
];

/**
 * 차량 모델명 문자열을 기반으로 카탈로그에서 매칭되는 차량 정보를 반환합니다.
 */
export function getVehicleInfoByModel(modelName?: string): VehicleInfo {
  if (!modelName) return VEHICLE_CATALOG[0];

  const lower = modelName.toLowerCase().replace(/\s+/g, '');
  const found = VEHICLE_CATALOG.find(v => 
    v.aliases.some(alias => lower.includes(alias.toLowerCase().replace(/\s+/g, '')))
  );

  return found || VEHICLE_CATALOG[0];
}

/**
 * 차종 정보와 사용자의 컬러 데이터(이름 또는 코드)를 기반으로 정확한 3D 렌더링 이미지와 컬러 정보를 반환합니다.
 */
export function getVehicleColorImage(vehicle: VehicleInfo, colorNameOrCode?: string): VehicleColorOption {
  if (!colorNameOrCode) {
    return vehicle.colors[0];
  }

  const query = colorNameOrCode.toLowerCase().replace(/\s+/g, '');
  
  // 1. 코드 일치 검사
  const matchCode = vehicle.colors.find(c => c.code.toLowerCase() === query);
  if (matchCode) return matchCode;

  // 2. 한글명 일치 검사
  const matchName = vehicle.colors.find(c => 
    c.name.toLowerCase().replace(/\s+/g, '').includes(query) ||
    query.includes(c.name.toLowerCase().replace(/\s+/g, ''))
  );
  if (matchName) return matchName;

  // 3. 영문명 일치 검사
  const matchEng = vehicle.colors.find(c => 
    c.englishName.toLowerCase().replace(/\s+/g, '').includes(query) ||
    query.includes(c.englishName.toLowerCase().replace(/\s+/g, ''))
  );
  if (matchEng) return matchEng;

  // 4. 일반적 단어 매칭 ('화이트', '그레이', '블랙', '골드', '블루')
  if (query.includes('화이트') || query.includes('white')) {
    const white = vehicle.colors.find(c => c.name.includes('화이트') || c.englishName.includes('White'));
    if (white) return white;
  }
  if (query.includes('그레이') || query.includes('gray') || query.includes('grey')) {
    const gray = vehicle.colors.find(c => c.name.includes('그레이') || c.englishName.includes('Gray'));
    if (gray) return gray;
  }
  if (query.includes('블랙') || query.includes('black')) {
    const black = vehicle.colors.find(c => c.name.includes('블랙') || c.englishName.includes('Black'));
    if (black) return black;
  }
  if (query.includes('골드') || query.includes('gold')) {
    const gold = vehicle.colors.find(c => c.name.includes('골드') || c.englishName.includes('Gold'));
    if (gold) return gold;
  }

  return vehicle.colors[0];
}
