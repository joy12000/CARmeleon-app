import { DailyPlan, SavedRoute, ShortcutPlace } from './types';
export {
  getTodayDateString,
  getIsoDateString,
  formatIsoToDisplayDate,
  parseDisplayDateToIso,
  parseRouteDateKey,
  isPastRouteDate
} from './utils/dateUtils';
import { getTodayDateString } from './utils/dateUtils';

export const initialShortcuts: ShortcutPlace[] = [
  { id: 'sc-1', keyword: '집', name: '판교 봇들마을 7단지', address: '성남시 분당구 판교역로 100', latitude: 37.4013, longitude: 127.1086, icon: 'home' },
  { id: 'sc-2', keyword: '회사', name: '현대자동차 양재 본사', address: '서울시 서초구 헌릉로 12', latitude: 37.4638, longitude: 127.0427, icon: 'building' },
  { id: 'sc-3', keyword: '헬스장', name: '판교 F45 피트니스', address: '성남시 분당구 대왕판교로 606', latitude: 37.3948, longitude: 127.1119, icon: 'dumbbell' },
  { id: 'sc-4', keyword: '단골카페', name: '정지영 커피로스터즈', address: '수원시 팔달구 수화로 42', latitude: 37.2845, longitude: 127.0152, icon: 'coffee' }
];

// 1. [오늘의 주행 코스]: 차량 시동을 켠 오늘 날짜 기준 등록된 루트들
export const mockSavedRoutes: SavedRoute[] = [
  {
    id: 'route-1',
    title: '판교 미팅 끝내고 수원 맛집 퇴근길',
    date: getTodayDateString(0),
    isActiveInCar: true,
    isBusiness: true,
    isTravel: true,
    stops: [
      {
        id: 's-1',
        name: 'A기업 (판교)',
        time: '13:30',
        address: '성남시 분당구 판교역로 166',
        latitude: 37.3948,
        longitude: 127.1119,
        poiId: 'POI_PANGYO_A',
        type: 'business',
        attachedFile: '제안서.pdf',
        memo: 'A기업 판교 본사 미팅 10분 전입니다. 클라우드 인프라 제휴 안건을 확인하세요.',
        aiBriefing: {
          summaryPoints: [
            '제안서 기반 클라우드 협업 모델 최종 조율',
            '현대차 Pleos NaviHelper SDK 기술 검증 일정 확정',
            '지하 3층 방문객 전용 주차구역 사전 배정 완료'
          ],
          contextStory: '운전자님, 판교역로 진입 500m 전입니다. 첨부하신 제안서 문서의 핵심 안건 3가지를 정리해 두었으니 미팅 전 확인해 주세요!'
        }
      },
      {
        id: 's-2',
        name: 'B기업 (강남)',
        time: '16:00',
        address: '서울시 강남구 테헤란로 152',
        latitude: 37.5000,
        longitude: 127.0364,
        poiId: 'POI_GANGNAM_B',
        type: 'business',
        attachedFile: 'API체크.docx',
        memo: '테헤란로 B기업 본사 미팅입니다. API 연동 규격서와 주차 확인증을 준비해 두었습니다.',
        aiBriefing: {
          summaryPoints: [
            '모빌리티 연동 REST API 규격 체크리스트 검토',
            '실시간 FusedLocation 오차 범위 ±2m 검증',
            '강남파이낸스센터 지하 자주식 주차장 진입 권장'
          ],
          contextStory: '운전자님, 강남 테헤란로 진입 구간입니다. 교통량이 많아 서행이 예상되니, 첨부된 API 체크리스트를 편안히 음성으로 확인해 보세요.'
        }
      },
      {
        id: 's-3',
        name: '수원 통닭거리',
        time: '18:30',
        address: '수원시 팔달구 수원천로 280',
        latitude: 37.2798,
        longitude: 127.0177,
        poiId: 'POI_SUWON_CHICKEN',
        type: 'travel',
        memo: '운전자님, 전방 2시 방향 수원천 매향교 너머를 보세요! 1970년대부터 가마솥에 기름을 붓고 통째로 튀겨내던 수원 통닭거리입니다. 영화 극한직업 수원왕갈비통닭의 모티브가 된 50년 전통 명소예요!',
        aiBriefing: {
          summaryPoints: [
            '1970년대부터 이어진 50년 가마솥 통닭 전통 골목',
            '영화 극한직업 왕갈비통닭의 실제 배경지로 전국 3대 통닭 성지',
            '가마솥에서 고온으로 튀겨 겉은 바삭하고 속은 촉촉한 육즙의 원조'
          ],
          contextStory: '운전자님, 전방 2시 방향 수원천 매향교 너머를 보세요! 1970년대 가마솥에 기름을 붓고 생닭을 통째로 튀겨내던 수원 통닭거리입니다. 영화 극한직업의 수원왕갈비통닭 모티브가 된 50년 전통 명소로, 매일 신선한 닭을 무쇠 가마솥에 튀겨내는 독보적인 바삭함 덕분에 주말마다 전국에서 수천 명이 줄을 서는 곳이에요!',
          recommendedFoodOrMusic: '진미통닭 가마솥 후라이드 & 수원왕갈비통닭'
        }
      },
      {
        id: 's-4',
        name: '광교 호수공원',
        time: '20:30',
        address: '수원시 영통구 광교호수로 57',
        latitude: 37.2838,
        longitude: 127.0694,
        poiId: 'POI_GWANGGYO_LAKE',
        type: 'travel',
        memo: '운전자님, 오른쪽 창밖을 잠시 보세요! 과거 수원 시민들의 추억이 서린 원천유원지가 독일 iF 디자인 어워드 본상을 수상한 대한민국 최고 야경 수변공원으로 다시 태어난 곳입니다.',
        aiBriefing: {
          summaryPoints: [
            '과거 7080 원천유원지가 재탄생한 국내 최대 도심 호수공원',
            '독일 iF 디자인 어워드 본상 수상의 보석 같은 어번레비 야경 산책로',
            '원천호수와 신대호수 두 개의 호수가 빚어내는 환상적인 물빛 드라이브'
          ],
          contextStory: '운전자님, 오른쪽 창밖을 잠시 보세요! 저 멀리 반짝이는 물빛이 바로 광교 호수공원입니다. 이곳은 원래 70~80년대 오리배로 유명했던 원천유원지였는데, 세계적인 조경 디자인을 거쳐 독일 iF 디자인 어워드 본상을 수상한 명소가 되었어요. 밤이 되면 호수 위 데크길 어번레비에 무지개빛 LED 조명이 켜져 야간 드라이브 명소로 가장 사랑받는 곳이랍니다.',
          recommendedFoodOrMusic: '어번레비 수변 카페거리 아인슈페너 & 야경 드라이브 시티팝'
        }
      }
    ]
  },
  {
    id: 'route-suwon-trip',
    title: '수원여행 (수원화성 → 수원왕갈비통닭거리 → 집)',
    date: getTodayDateString(0),
    isActiveInCar: false,
    isTravel: true,
    stops: [
      {
        id: 'sw-1',
        name: '수원화성',
        time: '11:30',
        address: '경기도 수원시 팔달구 정조로 910',
        latitude: 37.2889,
        longitude: 127.0135,
        poiId: 'POI_JANGANMUN',
        type: 'travel',
        attachedFile: '수원여행_코스_가이드.pdf',
        memo: '운전자님, 수원화성 장안문 진입 500m 전입니다. 조선 정조대왕이 세운 유네스코 세계문화유산이자 정약용 선생의 거중기와 오성지 방어 설계가 담긴 성곽입니다.',
        aiBriefing: {
          summaryPoints: [
            '숭례문보다 큰 북문 장안문 & 용연 연못 위 방화수류정 피크닉 명당',
            '화성행궁 공영주차장 또는 창룡문(연무대) 주차장 이용 시 동선 최적',
            '관람 후 약 10분 거리 수원왕갈비통닭거리로 이동 예정'
          ],
          contextStory: '운전자님, 수원화성 장안문 진입 500m 전입니다. 정조대왕이 축조한 유네스코 세계문화유산으로, 둥근 옹성 위 오성지는 적의 화공을 막던 정약용 선생의 과학적 방어 설계예요. 화성행궁이나 연무대 공영주차장에 주차하시면 산책하기 좋습니다.'
        }
      },
      {
        id: 'sw-2',
        name: '수원왕갈비통닭거리',
        time: '14:00',
        address: '경기도 수원시 팔달구 수원천로 280',
        latitude: 37.2798,
        longitude: 127.0177,
        poiId: 'POI_SUWON_CHICKEN',
        type: 'travel',
        attachedFile: '수원여행_맛집_리스트.pdf',
        memo: '운전자님, 수원천 매향교 앞 수원왕갈비통닭거리입니다. 무쇠 가마솥 후라이드와 영화 극한직업 왕갈비통닭의 실제 배경이 된 50년 전통 먹자골목이에요!',
        aiBriefing: {
          summaryPoints: [
            '1970년대 무쇠 가마솥 후라이드 & 단짠 매력의 수원왕갈비통닭 대표 골목',
            '진미통닭·용성통닭·남문통닭 유명 — 주말엔 현장 웨이팅 또는 전화 포장 추천',
            '남수동·팔달구청 공영주차장 이용 후 마지막 목적지 집으로 귀가 예정'
          ],
          contextStory: '운전자님, 수원천 매향교를 지나면 바로 수원왕갈비통닭거리입니다. 무쇠 가마솥에 통째로 튀겨 겉바속촉한 전통 통닭과 달짝지근한 왕갈비통닭을 즐길 수 있어요. 식사 후 마지막 목적지 집으로 안내해 드릴게요!',
          recommendedFoodOrMusic: '진미통닭 가마솥 후라이드 & 수원왕갈비통닭'
        }
      },
      {
        id: 'sw-3',
        name: '집',
        time: '17:00',
        address: '서울특별시 구로구 중앙로12길 12',
        latitude: 37.4954,
        longitude: 126.8634,
        type: 'travel',
        memo: '수원여행을 마치고 집으로 돌아가는 마지막 구간입니다. 안전하게 귀가하세요!'
      }
    ]
  },
  {
    id: 'route-2',
    title: '수원 화성 가을 나들이 & 행궁동 카페 투어',
    date: getTodayDateString(0),
    isActiveInCar: false,
    isTravel: true,
    stops: [
      {
        id: 't-1',
        name: '수원화성 장안문',
        time: '11:00',
        address: '수원시 팔달구 정조로 910',
        latitude: 37.2889,
        longitude: 127.0135,
        poiId: 'POI_JANGANMUN',
        type: 'travel',
        memo: '운전자님, 정면 12시 방향을 보세요! 조선의 정문이자 국내 최대 성문인 장안문입니다. 옹성 위 오성지(물주머니 구멍)는 적의 화공을 막던 정약용의 혁신 설계예요!',
        aiBriefing: {
          summaryPoints: [
            '국보 숭례문보다 거대한 국내 최대 규모의 석축 성문',
            '정조대왕이 한양에서 내려올 때 가장 먼저 맞이하던 수도 수원의 북문',
            '옹성 문루 위에서 적의 불공격을 막아내던 물탱크 오성지의 과학적 방어 설계'
          ],
          contextStory: '운전자님, 정면 12시 방향을 보세요! 웅장하게 서 있는 장안문입니다. 한양의 숭례문보다도 더 큰 국내 최대 성문인데요, 정조대왕이 아버지 사도세자의 묘소를 찾을 때 가장 먼저 입성하던 문이에요. 성문 앞 둥근 옹성 위를 보시면 5개의 구멍인 오성지가 있는데, 적이 불을 질렀을 때 물을 쏟아부어 불을 끄도록 정약용 선생이 과학적으로 설계한 놀라운 방어 유적입니다.'
        }
      },
      {
        id: 't-2',
        name: '수원화성 방화수류정 & 용연',
        time: '12:40',
        address: '수원시 팔달구 수원천로 392번길 44-6',
        latitude: 37.2874,
        longitude: 127.0202,
        poiId: 'POI_BANGHWA',
        type: 'travel',
        memo: '운전자님, 오른쪽 창밖 언덕 위 정자와 연못을 보세요! 꽃을 찾고 버들을 따라간다는 방화수류정과 용이 승천했다는 용연 연못입니다. 피크닉 인생샷 성지로 손꼽혀요!',
        aiBriefing: {
          summaryPoints: [
            '꽃을 찾고 버들을 따라 노닌다는 조선 건축 미학의 절정',
            '용이 머물다 승천했다는 신비로운 전설을 품은 둥근 연못 용연',
            '연못에 비치는 보름달과 정자 처마가 어우러진 수원팔경 제1경 용지대월'
          ],
          contextStory: '운전자님, 오른쪽 창밖 언덕 위 정자와 둥근 연못을 보세요! 바로 방화수류정과 용연입니다. 군사 지휘소지만 꽃을 찾고 버들을 따라 노닌다는 시적인 이름을 가진 곳이에요. 아래 연못 용연에는 가뭄이 들었을 때 기우제를 지내면 비를 내려주는 신룡이 살았다는 설화가 전해집니다. 달밤에 연못에 비치는 정자의 자태가 너무 아름다워 전국에서 연인들이 돗자리를 펴고 피크닉을 즐기러 온답니다.'
        }
      },
      {
        id: 't-3',
        name: '행궁동 정지영커피로스터즈',
        time: '14:20',
        address: '수원시 팔달구 수화로 42',
        latitude: 37.2845,
        longitude: 127.0152,
        poiId: 'POI_JJY_COFFEE',
        type: 'travel',
        memo: '운전자님, 좌측 골목을 보세요! 수원화성 화서문 성곽이 바로 눈앞에 펼쳐지는 루프탑 명소로, 옛 주택을 개조해 행리단길 열풍을 이끈 원조 카페입니다.',
        aiBriefing: {
          summaryPoints: [
            '행궁동 구도심 주택가를 트렌디한 감성 골목으로 바꾼 1세대 주역',
            '성곽 처마와 노을을 바라보며 마시는 플랫화이트와 흑임자 라떼 명소',
            '조선 성곽과 현대적 빈티지 인테리어가 공존하는 행리단길의 상징'
          ],
          contextStory: '운전자님, 좌측 골목 안쪽을 보세요! 수원 행궁동 행리단길 열풍을 처음 일으킨 정지영커피로스터즈 본점입니다. 오래된 붉은 벽돌 주택을 개조해 루프탑에 올라가면 수원화성 성곽 능선이 한눈에 보여요. 성곽 노을을 배경으로 인생 사진을 남기려는 여행객들로 매일 붐비는 핫플레이스입니다.'
        }
      }
    ]
  },
  {
    id: 'route-3',
    title: '수도권 핵심 파트너사 순회 미팅',
    date: getTodayDateString(0),
    isActiveInCar: false,
    isBusiness: true,
    stops: [
      { id: 'b-1', name: 'A기업 (판교)', time: '11:00', address: '성남시 분당구 판교역로 166', latitude: 37.3948, longitude: 127.1119, poiId: 'POI_PANGYO_A', type: 'business' },
      { id: 'b-2', name: 'B기업 (강남)', time: '14:30', address: '서울시 강남구 테헤란로 152', latitude: 37.5000, longitude: 127.0364, poiId: 'POI_GANGNAM_B', type: 'business' },
      { id: 'b-3', name: 'C기업 (여의도)', time: '17:00', address: '서울시 영등포구 의사당대로 83', latitude: 37.5219, longitude: 126.9242, poiId: 'POI_YEOUIDO_C', type: 'business' }
    ]
  },
  {
    id: 'route-4',
    title: '판교 화랑공원 & 대왕판교로 가을 드라이브',
    date: getTodayDateString(0),
    isActiveInCar: false,
    isTravel: true,
    stops: [
      {
        id: 'p-1',
        name: '판교역 사거리',
        time: '14:00',
        address: '성남시 분당구 판교역로 160',
        latitude: 37.3948,
        longitude: 127.1119,
        type: 'travel',
        memo: '운전자님, 정면 교차로를 보세요! 과거 너더리(널빤지 다리) 시골길에서 첨단 IT 테크밸리로 상전벽해를 이룬 판교의 중심지입니다.'
      },
      {
        id: 'p-2',
        name: '화랑공원 산책로',
        time: '15:20',
        address: '성남시 분당구 삼평동 637',
        latitude: 37.3985,
        longitude: 127.1035,
        type: 'travel',
        memo: '운전자님, 우측 호수와 갈대밭을 보세요! 테크밸리 연구원들의 힐링 오아시스이자 메타세쿼이아 숲길이 감싸는 도심 생태공원입니다.'
      },
      {
        id: 'p-3',
        name: '백현동 카페거리',
        time: '17:00',
        address: '성남시 분당구 판교역로10번길 3',
        latitude: 37.3912,
        longitude: 127.1135,
        type: 'travel',
        memo: '운전자님, 우측 골목을 보세요! 유럽 노천 카페 분위기가 물씬 풍기는 백현동 카페거리입니다. 향긋한 핸드드립 커피와 브런치가 유명해요.'
      }
    ]
  }
];

// 2. [지난 루트 보관함]: 이미 지난 날짜에 완료했던 코스 목록 (사용자가 언제든 다시 불러오기 가능)
export const mockPastRoutes: SavedRoute[] = [
  {
    id: 'route-past-1',
    title: '판교 테크노밸리 & 광교 호수공원 야경 드라이브',
    date: '11.07 (지난 루트)',
    isActiveInCar: false,
    isTravel: true,
    stops: [
      { id: 'past-1-1', name: '카카오 판교아지트', time: '18:00', address: '성남시 분당구 판교역로 166', latitude: 37.3948, longitude: 127.1119, type: 'business' },
      { id: 'past-1-2', name: '수원 통닭거리', time: '19:30', address: '수원시 팔달구 수원천로 280', latitude: 37.2798, longitude: 127.0177, type: 'travel' },
      { id: 'past-1-3', name: '광교 호수공원', time: '21:00', address: '수원시 영통구 광교호수로 57', latitude: 37.2838, longitude: 127.0694, type: 'travel' }
    ]
  },
  {
    id: 'route-past-2',
    title: '서울 강남-여의도 비즈니스 파트너 미팅',
    date: '11.05 (지난 루트)',
    isActiveInCar: false,
    isBusiness: true,
    stops: [
      { id: 'past-2-1', name: '강남 파이낸스센터', time: '10:00', address: '서울 강남구 테헤란로 152', latitude: 37.5000, longitude: 127.0364, type: 'business' },
      { id: 'past-2-2', name: '여의도 IFC몰', time: '14:00', address: '서울 영등포구 국제금융로 10', latitude: 37.5251, longitude: 126.9254, type: 'business' }
    ]
  },
  {
    id: 'route-past-3',
    title: '강릉 안목해변 커피거리 주말 바다 드라이브',
    date: '10.28 (지난 루트)',
    isActiveInCar: false,
    isTravel: true,
    stops: [
      { id: 'past-3-1', name: '대관령 양떼목장', time: '11:00', address: '강원 평창군 대관령면 대관령마루길 483-32', latitude: 37.6895, longitude: 128.7523, type: 'travel' },
      { id: 'past-3-2', name: '강릉 안목해변 커피거리', time: '13:30', address: '강원 강릉시 창해로14번길 20-1', latitude: 37.7718, longitude: 128.9482, type: 'travel' },
      { id: 'past-3-3', name: '강릉 중앙시장 먹거리골목', time: '16:00', address: '강원 강릉시 금성로 21', latitude: 37.7538, longitude: 128.8986, type: 'travel' }
    ]
  },
  {
    id: 'route-past-4',
    title: '양평 두물머리 가을 힐링 출사 여행',
    date: '10.15 (지난 루트)',
    isActiveInCar: false,
    isTravel: true,
    stops: [
      { id: 'past-4-1', name: '양평 두물머리 연꽃마을', time: '09:30', address: '경기 양평군 양서면 양수리', latitude: 37.5348, longitude: 127.3175, type: 'travel' },
      { id: 'past-4-2', name: '세미원 정원', time: '11:30', address: '경기 양평군 양서면 양수로 93', latitude: 37.5375, longitude: 127.3198, type: 'travel' }
    ]
  }
];

export const initialDailyPlan: DailyPlan = {
  carPlateNumber: '22너 7043',
  carModel: '아이오닉 5',
  exteriorColor: '아틀라스 화이트',
  exteriorColorCode: 'SAW',
  batteryOrFuelPercent: 85,
  isEngineOn: true,
  isDoorLocked: true, // 차량 문 기본 잠김 상태
  activeRoute: mockSavedRoutes[0],
  savedRoutes: mockSavedRoutes,
  pastRoutes: mockPastRoutes,
  shortcuts: initialShortcuts
};
