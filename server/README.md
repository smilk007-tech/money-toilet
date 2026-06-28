# 돈버는 화장실 · 실시간 소켓 서버

`socket.io` 기반 실시간 채팅/물내림/presence 서버. **Railway 단일 인스턴스**로 배포.

- 실시간 흐름·presence·밴캐시·rate-limit = **메모리** (Redis 안 씀)
- 통계·7일 채팅로그·밴·공유 = **Upstash Redis**, 이벤트 때만 기록
- 어드민 REST = **Bearer 토큰** 인증(크로스오리진), 로그인 5회 실패 시 15분 잠금

## 로컬 실행
```bash
cd server
npm install
KV_REST_API_URL=... KV_REST_API_TOKEN=... ADMIN_SECRET=... ALLOWED_ORIGIN=http://localhost:3000 \
  npm start          # :4000
```

## Railway 배포
- **Root Directory**: `server`
- **Start Command**: `npm start` (자동 감지됨)
- **Variables**: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `ADMIN_SECRET`, `ALLOWED_ORIGIN`
- `PORT`는 Railway가 자동 주입

## 엔드포인트
- `GET /` 헬스체크
- socket.io: `hello / chat / flush / disconnect` ↔ `presence / global / chat / flush / backfill`
- 어드민 REST(`Authorization: Bearer <token>`): `POST /admin/login`, `GET /admin/{me,stats,chats,bans,warned}`, `POST /admin/{ban,unban,warn,clearchat,reset,broadcast,config,logout}`
