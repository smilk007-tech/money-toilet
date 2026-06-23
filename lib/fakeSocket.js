/* ===================================================================
   FakeToiletSocket — 프로토타입용 "가짜" 실시간 소켓
   -------------------------------------------------------------------
   ⚠️  실제 서버 없음. 봇들이 채팅 / 접속자수 / 정산(물내림)을 위조한다.

   👉 나중에 진짜 채팅서버 붙일 때:
      - 이 파일을 RealToiletSocket 으로 교체.
      - 인터페이스(on / send / flush / connect / disconnect)만 동일하게 유지하면
        app.js 는 거의 손 안 대도 됨.

   발생 이벤트:
      'presence' { count }                  현재 이용중인 인원(=동접)            [실시간]
      'global'   { total }                  "오늘 모두 누적" 스냅샷
                                            → 입장 시 1회 + 물내림 때만 갱신
      'chat'     { name, text, kind }       누군가 한마디                          [실시간]
      'flush'    { name, amount, total, me } 누군가 물내림 → 누적금액(total) 동봉

   서버가 누적금액(_global)의 단일 소유자다. 클라는 받아서 표시만 한다.
   =================================================================== */

export class FakeToiletSocket {
  constructor() {
    this._handlers = {};
    this._timers = [];
    this._count = 60 + Math.floor(Math.random() * 50);
    this._global = this._seedGlobal();

    const NAMES_BASE = [
      "12시퇴근각",
      "1사로",
      "1초에 4원",
      "화장실(3층)",
      "약속의 아홉시",
      "감사팀",
      "경력첫출근",
      "경비원",
      "차트확인중",
      "감봉2회차",
      "김대리",
      "낙하산",
      "옆자리동기",
      "노조위원장",
      "다음달퇴사",
      "단타맨",
      "대표이사",
      "두시간째",
      "황상무",
      "막내",
      "맞선임",
      "물티슈왕",
      "박과장",
      "발표끝난 인턴",
      "백두혈통",
      "변비왕",
      "복도끝화장실",
      "비데전용칸",
      "내달계약만료",
      "최저임금",
      "사내변호사",
      "사무보조",
      "사장님피셜",
      "사측대변인",
      "상급닌자",
      "숨바꼭질 마스터",
      "신입사원",
      "업비트중",
      "엠보싱필수",
      "옆칸님",
      "옥상화장실",
      "외근보고자",
      "월급300",
      "월급루팡",
      "변기7",
      "익명의똥손",
      "인사팀",
      "인턴3",
      "장그래",
      "감사팀",
      "전무라인",
      "점심뭐먹지",
      "정규직대상자",
      "준비된사수",
      "첫번째칸",
      "출장보고함",
      "파업왕",
      "파트장",
      "푸세식칸",
      "항의원 3년차",
      "회의불참러",
      "최하위고과",
      "전층순방중",
      "이달의사원",
      "진급누락자",
      "다크템플러",
      "불법체류자",
      "피난민",
    ];

    const LINES_BASE = [
      "지금 회의 째고 옴ㅋㅋ",
      "여기가 내 진짜 사무실",
      "벌써 8분째 앉아있는 중",
      "최소 5분임",
      "새벽부터 온 사람 누구냐?",
      "(속보)내 신기록 1시간",
      "와 자리 꽉 찬거 봐라",
      "모두 같은 생각임",
      "자체 유급휴가 중",
      "호캉스가 따로 없네",
      "넷플 정주행 중",
      "쿠키 떨어졌다",
      "이 스킬은 AI로 대체불가임",
      "벌써 백만원 벌었다!",
      "이게 바로 업무혁신이지",
      "돈이 복사된다",
      "내 전용칸이야",
      "완전 범죄다 진짜",
      "이 맛에 회사 다닌다",
      "어제 뭐 먹었어요 형님?",
      "아따 줄 길다",
      "이럴 줄 알고 휴지챙김ㅋㅋ",
      "이 정도면 화장실 안에도 CCTV 달아야됨",
      "엉뜨는 필수에요",
      "여기 수압 되게 쎄네",
      "걸리면 징계받음?",
      "왔다 내 월급",
      "시간 엄청 빨리감",
      "25분 달성ㅋㅋ",
      "40분은 너무한가?",
      "같이 모아봐요 우리!",
      "그래도 불법은 아니잖아?",
      "안누리면 바보지",
      "빨리 나가면 개손해",
      "솔직히 회사도 이건 인정해줘야 됨",
      "내 특권 못잃어",
      "30분 넘긴 용자 있음?",
      "불끄지마 사람있어요!",
      "이거 진짜 돈이야",
      "커피 값 개꿀ㅎㅎ",
      "난 밥 값 벌었지ㅋㅋ",
      "옵션설정 있네",
      "다들 많이 모았구나",
      "물내리면 체증도 쑥 내려가",
      "이어폰 소리좀 줄여요",
      "축구 시청중",
      "커뮤니티 해야지",
      "급하면 전화하겠지 뭐",
      "자리비움 해놨어?",
      "이 순간을 기다렸다",
      "역시 회사가 최고야",
      "집에서 이틀 참음!!",
      "일부러 모아왔지롱",
      "응 돈벌게~",
      "죄송해도 벌긴 해야지",
      "솔직히 별로 안미안함ㅋㅋ",
      "다리 저려 죽겠다",
      "휴지 떨어지면 진짜 끝장임",
      "부장님 나 어디갔는지 모름ㅋㅋ",
      "누가 물 안내렸어?",
      "야근할 때 자주 이용해요",
      "점심시간에 출입금지",
      "내 마음의 안식처",
      "다들 여기 있을 줄 알았다",
      "시끄러워서 잘 안나옴",
      "뚫어뻥 좀 주세요",
      "한 대 피고싶네..",
      "밖에서 내 욕하는데?",
      "오늘만 세번째 출근했다",
      "월급 들어오는 소리 들린다~",
      "옆칸 너 누구냐",
      "여기 변기 막혔어요!",
      "청소여사님 옴",
      "소리내지마!",
      "오전 오후 1회씩 필수",
      "숏츠 시간순삭ㅎㅎ",
      "이건 이재용도 못참음",
      "노크하지마세요 제발",
      "여기 에어컨이 제일 시원함",
      "사장님 이거 다 업무시간입니다",
      "똑똑똑",
      "아래로 휴지좀 줘~",
      "퇴근까지 4시간 여기서 버틴다",
      "변기에 앉아서 돈 버는 중ㅋㅋ",
      "와 옆칸 너무 오래 있는데",
      "평생 천만원 번대",
      "여기 와이파이 왜 이렇게 빠름",
      "이게 진짜 워라밸이지",
      "점심메뉴 정해주실 분",
      "그만 좀 찾아라",
      "아홉시만 되면 다 모이네",
      "이 안에선 모두 평등해짐",
      "앉아서 퇴사생각 중..",
      "밖에 환풍기 좀 틀어주세요",
      "엉덩이에 감각이 없어졌어",
      "방금 밖에서 나 부른 것 같은데",
      "저 지금 심오한 기획 중입니다",
      "회사 내 유일한 자유구역",
      "노크 세 번은 거절의 뜻입니다",
      "다들 발끝만 들고 조용히 있는 거 봐ㅋㅋ",
      "출근하자마자 직행함ㅋㅋ",
      "배터리 5% 남았다..",
      "슬슬 나가야 하나",
      "자리 비운 지 얼마나 됐지?",
      "옆이랑 암묵적인 배틀중",
      "앉아만 있어도 시급이 나오는 기적",
      "누가 밖에서 한숨 크게 쉬고 나감ㅋㅋ",
      "유튜브 소리 다 들려요 형님",
      "이직 사이트 보는 중",
      "보금자리란 이런걸까?",
      "아늑하다",
      "적어도 월요일은 필수임",
      "이 때만 애사심 생김",
      "이게 복지지",
      "지금 문 두드린 사람 팀장 확실함",
      "모든 요일이 필수임",
    ];
    const dedupeSortKo = (arr) =>
      [...new Set(arr)].sort((a, b) => a.localeCompare(b, "ko"));
    this._names = dedupeSortKo(NAMES_BASE);
    this._lines = dedupeSortKo(LINES_BASE);
  }

  /* ---- 이벤트 ---- */
  on(type, cb) {
    (this._handlers[type] ||= []).push(cb);
    return this;
  }
  _emit(type, payload) {
    (this._handlers[type] || []).forEach((cb) => cb(payload));
  }

  /* ---- 내가 보낸 채팅 ---- */
  send(text) {
    setTimeout(() => this._emit("chat", { name: "나", text, kind: "me" }), 60);
    if (Math.random() < 0.5) {
      const reply = [
        "ㅋㅋㅋㅋ",
        "인정",
        "ㄹㅇ",
        "님 누구임?",
        "어디 칸이세요",
        "공감합니다 동지여",
      ];
      this._after(900 + Math.random() * 1600, () =>
        this._emit("chat", {
          name: this._pick(this._names),
          text: this._pick(reply),
          kind: "bot",
        }),
      );
    }
  }

  /* ---- 내가 물내림(정산) ---- 서버가 누적에 합산 후 새 total을 내려줌
     broadcast=false 면 채팅엔 안 올리고 누적금액만 갱신(자랑하기 OFF)
     text가 주어지면 그 문구를 그대로 사용(자동물내림 변비멘트 등) */
  flush(amount, broadcast = true, text = null) {
    this._global += amount;
    this._after(80, () =>
      this._emit("flush", {
        name: "나",
        amount,
        total: this._global,
        me: true,
        chat: broadcast,
        text,
      }),
    );
  }

  connect() {
    // 입장 스냅샷
    this._emit("presence", { count: this._count });
    this._emit("global", { total: this._global });

    // 동접 랜덤워크 (실시간)
    this._loop(2600, 4200, () => {
      this._count = Math.max(
        18,
        Math.min(180, this._count + Math.round((Math.random() - 0.46) * 6)),
      );
      this._emit("presence", { count: this._count });
    });

    // 봇 채팅 (실시간)
    this._loop(2200, 5200, () => {
      if (Math.random() < 0.16) {
        this._emit("chat", {
          name: "시스템",
          text: `${this._pick(this._names)} 님이 입장했습니다 🚽`,
          kind: "system",
        });
      } else {
        this._emit("chat", {
          name: this._pick(this._names),
          text: this._pick(this._lines),
          kind: "bot",
        });
      }
    });

    // 봇 물내림 → 누적금액 갱신 (이때만 global 갱신)
    this._loop(5000, 11000, () => {
      const amount = 600 + Math.floor(Math.random() * 14000);
      this._global += amount;
      this._emit("flush", {
        name: this._pick(this._names),
        amount,
        total: this._global,
        me: false,
      });
    });
  }

  disconnect() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }

  /* ---- 내부 헬퍼 ---- */
  _seedGlobal() {
    // 아침 9시부터 쌓인 척하는 초기 누적금액
    const now = new Date(),
      start = new Date(now);
    start.setHours(9, 0, 0, 0);
    let hrs = (now - start) / 3_600_000;
    hrs = Math.max(0.25, Math.min(hrs, 9));
    const avgUsers = 78,
      avgRate = 3_000_000 / (22 * 8 * 3600); // ≈4.73원/초/인
    return Math.floor(
      hrs * 3600 * avgUsers * avgRate * (0.8 + Math.random() * 0.25),
    );
  }
  _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  _after(ms, fn) {
    const t = setTimeout(fn, ms);
    this._timers.push(t);
  }
  _loop(min, max, fn) {
    const step = () => {
      fn();
      this._after(min + Math.random() * (max - min), step);
    };
    this._after(min + Math.random() * (max - min), step);
  }
}
