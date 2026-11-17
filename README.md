# 우리 가족 기록장

가족용 기록 대시보드. `index.html` 단일 파일(HTML·CSS·JS 인라인) + Supabase 실시간 동기화.

- 라이브 주소: https://vpffl5854-alt.github.io/family-dashboard/
- 배포 소스: **`gh-pages` 브랜치 루트 (`/`)** — GitHub Pages가 이 브랜치를 서빙합니다.
- `main` 브랜치: 원본 보관용. `main`에만 푸시하면 사이트는 바뀌지 않습니다.
- 갱신하려면: `index.html`을 고친 뒤 `main`과 `gh-pages` **양쪽에** 반영하세요.

## 기능

1. 날씨·미세먼지 + **오늘 옷차림 추천**(기온·일교차·강수 확률 기반) + **5일 예보**(Open-Meteo, 키 없음)
2. **가족 공유 일정 · D-Day** — 월간 달력 배지/점, 날짜 클릭 → 그날 일정, D-Day 카운트다운
3. **학교 급식** — 나이스 교육정보 Open API(키 없음, CORS 허용). 학교 검색 → 저장(가족 공유), 오늘·이번 주 식단, 알레르기 번호 토글
4. **키 · 몸무게 · BMI 성장 기록** — BMI 자동 계산, 최신 수치 카드, 인라인 SVG 추이 그래프(키/몸무게/BMI), 구성원 필터
5. **학원·학교 숙제** — 과목·마감일(D-day 배지)·담당·완료 체크, 완료 시 도장 연동
6. **💡 집 조명 (Smart Life · Tuya)** — 거실 3구·주방 2구·큰방·소떠기 방♡ ON/OFF, 소비전력 표시, 오프라인 기기 구분, 스위치 이름(별명) 가족 공유, `전체 소등` (맥미니가 꽂힌 스마트플러그 `미니`는 목록·제어·전체 소등에서 제외)
   - **태블릿(820px~) 홈의 `집 조명` 카드**: 거실·큰방·주방·소떠기 방♡ **4개 방 스위치가 2×2로 바로 보입니다**(`#lightQuickGrid`). 탭 이동 없이 그 자리에서 켜고 끌 수 있고, 지프등·차고지 등·스마트 만능 리모컨은 여기서는 빠집니다(`💡 조명` 탭에는 7개 그대로). 제목줄을 누르면 예전처럼 `💡 조명` 탭으로 이동합니다. 폰(≤819px)에서는 이 그리드를 숨기고 기존 한 줄 요약 카드만 보입니다.
7. **📺 거실 태블릿 모드** — 설정 모달에서 이 기기에만 켜는 옵션. 켜면 30초마다 조명 상태를 자동 새로고침(화면이 보일 때만)하고 화면 꺼짐 방지(Wake Lock)를 유지합니다.
8. **📖 AI 독후활동** — 책 제목으로 검색 → 책 소개 확인(사진·메모 보조 입력) → AI 코치 질문 5~6개 → 답 점검(수정 유도) → 독서록 카드 정리·저장 (아래 「AI 독후활동」 절)
9. 기존 기능: 오늘의 미션 · 할 일 · 도장판 · 공부 타이머 · 기기 잠금 · 가족 채팅(스티커/15초 음성) · 용돈기입장 · 설정/공유 코드

## 화면 레이아웃 (반응형 · 태블릿 가로)

폰에서는 기존 세로 1열 그대로이고, 넓은 화면에서는 양옆 공백을 줄인 다단 대시보드로 바뀝니다. CSS는 `index.html` `<style>` 마지막의 `@media (min-width: 820px)` · `@media (min-width: 1120px)` 두 블록에만 들어 있어서 **819px 이하 화면은 예전과 100% 동일**합니다(폰 회귀 없음).

| 화면 폭 | `.app` 최대 폭 | 카드 배치 | 조명 그리드 |
| --- | --- | --- | --- |
| ~819px (폰) | 460px | 세로 1열 (기존 그대로) | 2열 |
| 820~1119px (태블릿 가로) | 1000px | 섹션 안 카드 2열 | 205px 기준 auto-fill (폭에 따라 3~4열) |
| 1120px~ (넓은 태블릿·PC) | 1280px | 섹션 안 카드 3열 | 4열 |

- 섹션(`section[data-section]`) 하나하나가 `display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr))` 입니다. 그래서 카드가 1장뿐인 섹션(`💡 조명`, `💬 가족채팅`, `🐷 용돈기입장`, `🌱 성장`)은 자동으로 한 줄 전체를 쓰고, 2장이면 2열, 여러 장이면 3열까지 나란히 놓입니다.
- `전체` 탭에서 가족 할 일 카드들도 같은 그리드에 섞이도록 `#todoCardsWrap`은 넓은 화면에서만 `display: contents`를 씁니다(폰에서는 기존 div 그대로).
- `가족채팅`·`용돈기입장`·`성장` 카드는 글줄이 너무 길어지지 않게 `max-width: 920px`로 가운데 정렬하고, 모달은 넓은 화면에서도 `max-width: 520px`을 지킵니다.
- `가족채팅`의 스크롤 영역은 넓은 화면에서 `min-height: 260px; max-height: 52vh`로 늘립니다.
- 헤더 오른쪽 액션(설정·동기화 배지·태블릿 배지)은 넓은 화면에서 한 줄로 가로 정렬되고, 탭 바는 가운데 정렬로 펴지며 폭이 모자라면 두 줄로 감쌉니다.
- 넓은 화면에서는 버튼이 카드 폭만큼 늘어나지 않고(`flex: 0 0 auto; white-space: nowrap`) 글자 폭에 맞춰 서고, `btn-full` 버튼은 가운데 `max-width: 480px`까지만, `전체 소등`·`새로고침` 같은 `btn-row` 버튼은 최대 320px까지 커집니다. 모달 내부 버튼은 예전처럼 반씩 나뉩니다.
- 모바일 폭 확인한계: 이 환경의 브라우저 뷰포트는 1919×992 하나라, 좁은 폭 검증은 동일 출처 iframe을 1280×800·1024×768·820·390×844로 띄워 그 안의 실제 렌더 박스를 쟀습니다(미디어쿼리는 iframe 뷰포트 기준으로 평가됨). 819px 이하에서는 `.app` 460px·padding 14px·섹션 `display: block`·조명 2열이 그대로 나오는 것을 확인했습니다.

### 홈(전체) 태블릿 정돈 (2026-11-17)

- **같은 줄 카드 높이 맞춤**: 820px 이상에서 `section[data-section="home"]`만 `align-items: stretch` + 카드 `display:flex; flex-direction:column`으로 바꿔 한 줄의 카드들이 같은 높이로 끝납니다(다른 탭·폰은 그대로).
- **할 일 카드 내부 스크롤**: 넓은 화면에서 `.item-list.todo-scroll-list`는 `max-height: 196px; overflow-y: auto`(3.5~4개 높이)라 항목이 늘어도 카드가 계속 커지지 않고, 넘치는 항목은 카드 안에서만 스크롤됩니다. 넘칠 때만 `.is-overflowing`이 붙어 아래쪽이 부드럽게 사라지는 페이드 + 얇은 스크롤바가 보입니다. `+ {이름} 할 일 추가` 버튼은 스크롤 영역 밖 카드 맨 아래(`margin-top:auto`)에 고정됩니다. 폰(≤819px)은 `overflow-y: visible; max-height: none`으로 예전처럼 전부 펼쳐 보입니다.
- **`#lightQuickGrid`**: `#lightSummaryCard` 안 `.light-summary-inner`의 **형제 요소**라서 방 스위치를 눌러도 `switchTab('lights')`가 실행되지 않습니다. 기기 선택은 ID 우선(`eb3d7596e5372a9a0fytj3` 거실 · `7808227470039f384916` 큰방 · `1400380470039f38bfc2` 주방 · `1400380470039f38be2f` 소떠기 방♡), 없으면 이름(`거실`/`큰방`/`주방`/`소떠기`·`윤이`)으로 찾습니다. `renderLights()`가 매번 함께 다시 그려 스위치 토글·30초 자동 갱신·`전체 소등` 후에도 두 화면 상태가 같습니다.

## 데이터 동기화 (Supabase)

- 프로젝트: `family-dashboard` (ref `hwhrvamjypamuesueouc`, 리전 `ap-northeast-2` 서울)
- 브라우저는 공개용 anon(publishable) 키만 사용합니다. `service_role` 키와 DB 비밀번호는 코드·깃에 넣지 않습니다.
- 테이블(항목 단위, 모두 `room_id` 기준):
  - 기본: `family_rooms`, `family_members`, `family_todos`, `family_studies`, `family_study_logs`, `family_stamps`, `family_missions`, `family_chat_messages`, `family_allowance_tx`
  - v2(2026-11-17): `family_events`(일정·D-Day), `family_growth`(키·몸무게·BMI), `family_homeworks`(숙제)
  - v4(2026-11-17): `family_book_reports`(AI 독후활동 독서록 — `qa_json`에 책 정보·문답·카드, `final_report`에 본문)
  - `family_rooms`에 급식 학교 설정 컬럼: `school_office_code`, `school_code`, `school_name` (기본값 대구 경명여자중학교 = `D10` / `7261037`)
- 스키마·RLS·Realtime 설정 SQL: `supabase-schema.sql` (여러 번 실행해도 안전 — `add column if not exists` / `create table if not exists`만 사용)
- 모든 테이블에 RLS를 켜고, 요청 헤더 `x-room-code`와 `room_id`가 일치할 때만 읽기/쓰기를 허용합니다.
- Realtime(`postgres_changes`) 구독으로 다른 기기의 변경이 즉시 화면에 반영됩니다. `localStorage`는 캐시·오프라인 폴백으로만 씁니다.
- 가족 공유 코드(기본 `our-family`)가 같으면 같은 기록장을 함께 씁니다. 설정 모달에서 코드를 확인·변경할 수 있습니다.
- 음성 메시지는 15초 안쪽(약 150KB 이하)으로 제한해 DB·Realtime 부하를 막습니다.

## 📺 거실 태블릿 모드 (기기별 설정)

- 저장 위치: **이 브라우저의 `localStorage`만** — 키 `family_dashboard_tablet_mode`(`'1'`이면 ON, 키가 없으면 OFF가 기본). Supabase(`family_rooms`)에는 넣지 않습니다. 폰과 거실 태블릿의 설정이 서로 달라야 하기 때문입니다.
- ON일 때: ① 30초(30000ms)마다 `tuya-lights` 조명 상태 자동 새로고침 — `document.visibilityState === 'visible'`이고 `LIGHTS.loading`이 아닐 때만 호출, OFF로 바꾸면 타이머 즉시 해제 ② `navigator.wakeLock.request('screen')`으로 화면 꺼짐 방지(미지원·거절은 조용히 무시하고 설정 문구만 바꿈)
- 화면이 다시 보이면(`visibilitychange`) ON이면 즉시 1회 갱신 + Wake Lock 재요청, OFF면 마지막 조회 후 20초가 지났고 `전체`·`조명` 탭일 때만 `ensureLights(false)`.
- 표시: 헤더의 `📺 태블릿 모드 · 30초 자동 갱신` 배지와 `💡 집 조명` 카드의 같은 문구는 ON인 기기에서만 보입니다(OFF면 기존 화면과 동일).
- OFF 상태에서도 기존 60초 조용한 새로고침(`전체`·`조명` 탭, 화면 보일 때)은 그대로 동작합니다.

## 집 조명 연동 (Smart Life / Tuya)

- 브라우저는 직접 Tuya에 요청하지 않습니다(CORS·서명키 노출). 대신 Supabase Edge Function **`tuya-lights`**(`supabase/functions/tuya-lights/index.ts`)가 tuya-device-sharing-sdk 프로토콜(MD5 + HMAC-SHA256 + AES-128-GCM)로 서명해 중계합니다.
- Smart Life 토큰은 `public.tuya_connections`에만 있습니다. 이 테이블은 RLS를 켜고 `anon`·`authenticated` 권한을 **회수**해 브라우저 키로는 읽을 수도 쓸 수도 없습니다(service_role 전용).
- 호출: `POST /functions/v1/tuya-lights` + `x-room-code` 헤더 + `apikey/Authorization`(anon)
  - `{"action":"list"}` → 기기·스위치 상태
  - `{"action":"command","device_id":"...","code":"switch_1","value":true}` → 제어 후 최신 상태
  - `{"action":"all_off"}` → 켜진 채널 일괄 소등
  - `{"action":"save_label","device_id":"...","code":"switch_1","label":"거실 메인등"}` → 별명 저장(`family_rooms.light_labels`)
- 액세스 토큰 만료 60초 전이거나 Tuya가 만료를 알리면 Edge Function이 `GET /v1.0/m/token/{refresh_token}`으로 스스로 갱신해 DB에 다시 저장합니다(사람 손 필요 없음).
- 스위치 별명은 `family_rooms.light_labels`(키 `기기ID.채널`, 예 `eb3d7596e5372a9a0fytj3.switch_1`)에 들어가고 Realtime으로 가족 전원에게 즉시 반영됩니다.
- **보호된 기기**: `EXCLUDED_DEVICE_IDS`(현재 맥미니가 꽂힌 스마트플러그 `미니` = `eb1f8a6820f472f854knoa`)는 `list` 응답에서 빠지고, `command`로 제어하면 HTTP 403(`보호된 기기라 제어할 수 없어요.`)으로 거부되며, `all_off`에서도 건너뜁니다. 식구가 실수로 꺼서 맥미니 전원이 나가는 일을 막기 위한 장치입니다.

## 📖 AI 독후활동 (2026-11-17)

소윤이용 독서록 탭. `📖 독후활동` 탭 → 책 제목 검색 → 책 확인 → 질문 5~6개 문답 → 독서록 카드 저장.

### 흐름

1. **책 찾기** — 제목(+지은이 선택). 서버(Edge Function)가 **알라딘 검색·상세 페이지를 실제로 조회**해 제목·지은이·출판사·출간월·분류·ISBN·쪽수·표지·출판사 소개문을 확인한다. 결과가 없으면 교보문고 검색으로 한 번 더 확인하고, 그래도 없으면 `found:false`로 정직하게 돌려준다(클라이언트가 사진·메모 입력을 안내).
2. **보조 입력(선택)** — 책 뒤표지·목차·본문 사진 최대 3장(브라우저에서 최대 1100px JPEG로 줄여 전송) 또는 2~3줄 메모. 사진이나 메모를 넣으면 질문이 5개 → **6개**로 늘어난다(사진에서 읽은 내용도 근거로 쓴다).
3. **생각 나누기** — AI 코치가 한 번에 질문 하나. 답을 보내면 서버가 ① 인물·사건 착각, ② 단답/근거 부족을 점검해 `revise`(같은 질문에 다시 답) / `pass`(다음 질문) / `complete`(마지막 통과)로 답한다. 같은 단계에서 두 번째 제출은 막히지 않도록 무조건 통과시킨다.
   - 검색으로 확인한 책 정보와 **명백히** 어긋날 때만 "틀렸다"고 짚고, 확인되지 않은 세부 내용은 논리·근거를 묻는 방식으로 유도한다.
4. **독서록 카드** — 통과한 문답을 모아 소윤이 말투를 살린 3~5문단 독서록 + 한 줄 생각 + 인상 깊은 장면 + 남은 질문 + 태그를 만든다. 별점(1~5)과 본문은 화면에서 직접 고칠 수 있고, `💾 기록장에 저장`하면 `family_book_reports`에 들어간다.
5. **저장된 독서록** — 목록에서 펼쳐 보기 / 수정 / 삭제. `family_book_reports`는 Realtime 게시되어 있어 다른 기기에서 저장해도 목록이 바로 갱신된다.

### 서버 (Supabase Edge Function `book-mentor`)

- 위치: `supabase/functions/book-mentor/index.ts` — `verify_jwt: true`, `x-room-code` 헤더 필수.
- actions: `lookup`(도서 검색) / `start`(책 요약 + 1번 질문) / `answer`(점검·다음 질문) / `summarize`(독서록 카드).
- 모델: **`gemini-3.8-flash` 우선 → 실패(429/5xx)하면 `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`** 순서로 자동 폴백. 같은 모델은 혼잡(503)일 때 한 번 더 재시도한다.
- 무료 티어 실측(AI Studio > 비율 제한, 2026-11-17): `gemini-3.8-flash` 5 RPM / 20 RPD, `gemini-3.5-flash-lite` 15 RPM / 500 RPD, `gemini-3.1-flash-lite` 15 RPM / 500 RPD. 일일 한도(20 RPD)는 세션 2번이면 차므로 실제로는 폴백 모델이 주로 쓰인다(자동 전환, 사용자는 모름).
- 키: `GEMINI_API_KEY`는 Supabase **Edge Function Secret**에만 있다. `index.html`·깃·로그에는 없다.
- 안전장치: 방 코드당 시간당 40회(AI)·60회(검색) 호출 제한, 이미지 3장·본문 3000자 등 입력 길이 제한, 응답 `Cache-Control: no-store`.
- 배포: Supabase Management API의 `POST /v1/projects/<ref>/functions`(body=소스)로 올린다. **같은 슬러그를 `PATCH`로 갱신하면 소스가 바뀌지 않으므로**(버전 그대로) `DELETE` 후 `POST`로 다시 만든다.

## 초파(에이전트)가 학원 숙제를 DB에 직접 넣는 법

`family_homeworks`에 행을 넣으면 열려 있는 대시보드에 실시간으로 나타납니다(`source: 'pickle'`이면 화면에 `✨ 초파가 넣음` 배지).

```bash
curl -X POST "https://hwhrvamjypamuesueouc.supabase.co/rest/v1/family_homeworks" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -H "x-room-code: our-family" \
  -d '{"room_id":"our-family","id":"hw-pickle-20261117-1","member_id":"m1","subject":"수학","title":"익힘책 32~35쪽","due_date":"2026-11-19","done":false,"source":"pickle","position":100}'
```

- `id`는 방 안에서만 겹치지 않으면 됩니다(예: `hw-pickle-<날짜>-<번호>`).
- `member_id`는 `family_members.id`(m1·m2·m3) 또는 `all`.
- `due_date`는 `YYYY-MM-DD` 문자열, 비우면 `''`.
- 같은 방식으로 `family_events`(일정), `family_growth`(성장 기록)도 넣을 수 있습니다.
