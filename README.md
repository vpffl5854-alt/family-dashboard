# 우리 가족 기록장

가족용 기록 대시보드. `index.html` 단일 파일(HTML·CSS·JS 인라인) + Supabase 실시간 동기화.

- 라이브 주소: https://vpffl5854-alt.github.io/family-dashboard/
- 배포 소스: **`gh-pages` 브랜치 루트 (`/`)** — GitHub Pages가 이 브랜치를 서빙합니다.
- `main` 브랜치: 원본 보관용. `main`에만 푸시하면 사이트는 바뀌지 않습니다.
- 갱신하려면: `index.html`을 고친 뒤 `main`과 `gh-pages` **양쪽에** 반영하세요.

## 데이터 동기화 (Supabase)

- 프로젝트: `family-dashboard` (ref `hwhrvamjypamuesueouc`, 리전 `ap-northeast-2` 서울)
- 브라우저는 공개용 anon(publishable) 키만 사용합니다. `service_role` 키와 DB 비밀번호는 코드·깃에 넣지 않습니다.
- 테이블(항목 단위, 모두 `room_id` 기준): `family_rooms`, `family_members`, `family_todos`, `family_studies`, `family_study_logs`, `family_stamps`, `family_missions`, `family_chat_messages`, `family_allowance_tx`
- 스키마·RLS·Realtime 설정 SQL: `supabase-schema.sql` (Supabase SQL Editor에서 그대로 실행)
- 모든 테이블에 RLS를 켜고, 요청 헤더 `x-room-code`와 `room_id`가 일치할 때만 읽기/쓰기를 허용합니다.
- Realtime(`postgres_changes`) 구독으로 다른 기기의 변경이 즉시 화면에 반영됩니다. `localStorage`는 캐시·오프라인 폴백으로만 씁니다.
- 가족 공유 코드(기본 `our-family`)가 같으면 같은 기록장을 함께 씁니다. 설정 모달에서 코드를 확인·변경할 수 있습니다.
- 음성 메시지는 15초 안쪽(약 150KB 이하)으로 제한해 DB·Realtime 부하를 막습니다.
