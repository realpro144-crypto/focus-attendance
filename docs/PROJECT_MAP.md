# 프로젝트 지도

자주 만지는 파일만 빠르게 찾기 위한 지도입니다.

## 화면

- `src/app.js`
  - 로그인, 지점원 등록, QR 출근, 캘린더, 관리자 화면의 동작이 들어 있습니다.
- `public/styles.css`
  - 모바일 화면 모양, 버튼, 캘린더, 관리자 목록 디자인이 들어 있습니다.
- `index.html`
  - 앱 제목과 기본 HTML입니다.

## 데이터베이스

- `supabase/schema.sql`
  - Supabase를 처음 만들 때 실행하는 기본 테이블/함수입니다.
- `supabase/admin-functions.sql`
  - 관리자 계정, 관리자 페이지, 계정 삭제, 비밀번호 변경 기능입니다.
- `supabase/fix-password-functions.sql`
  - 비밀번호 암호화 함수 보정용 SQL입니다. 보통은 `admin-functions.sql`까지 적용되어 있으면 다시 실행할 일이 많지 않습니다.

## 배포

- `vercel.json`
  - `/checkin`, `/calendar`, `/dashboard` 주소가 새로고침해도 열리게 하는 설정입니다.
- `.env.example`
  - 새 컴퓨터에서 `.env`를 만들 때 참고하는 환경변수 예시입니다.
- `package.json`
  - `npm run dev`, `npm run check` 같은 작업 명령어가 들어 있습니다.

## 문서

- `README.md`
  - 앱 전체 소개와 배포 요약입니다.
- `docs/DEVELOPMENT.md`
  - 다른 컴퓨터에서 개발 환경을 준비하는 순서입니다.
- `docs/RELEASE_CHECKLIST.md`
  - 배포 전 확인 목록입니다.
