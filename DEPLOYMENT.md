# 초보자용 배포 순서

## 1. Supabase 프로젝트 만들기

1. <https://supabase.com>에 로그인합니다.
2. `New project`를 누릅니다.
3. 프로젝트 이름은 예를 들어 `focus-attendance`로 입력합니다.
4. Region은 가까운 곳을 고릅니다.
5. 프로젝트가 만들어질 때까지 기다립니다.

## 2. 데이터베이스 만들기

1. Supabase 왼쪽 메뉴에서 `SQL Editor`를 엽니다.
2. 이 프로젝트 폴더의 `supabase/schema.sql` 파일을 엽니다.
3. 내용을 전부 복사합니다.
4. Supabase SQL Editor에 붙여넣고 `Run`을 누릅니다.

## 3. Supabase 환경변수 값 찾기

1. Supabase 왼쪽 아래 `Project Settings`를 엽니다.
2. `API` 메뉴를 엽니다.
3. 아래 두 값을 복사해 둡니다.
   - Project URL
   - anon public key

## 4. Vercel에 올리기

1. <https://vercel.com>에 로그인합니다.
2. `Add New...` > `Project`를 누릅니다.
3. GitHub에 올린 이 프로젝트를 선택합니다.
4. 설정은 이렇게 둡니다.
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Environment Variables에 아래 두 개를 추가합니다.
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. `Deploy`를 누릅니다.

## 5. 배포 후 확인

1. Vercel이 만들어 준 `https://...vercel.app` 주소를 엽니다.
2. `/dashboard`로 들어가 관리자 화면이 보이는지 확인합니다.
3. `/checkin`으로 들어가 직원 등록 화면이 보이는지 확인합니다.
4. 관리자 화면의 QR을 휴대폰으로 스캔해 봅니다.

## 6. 문제가 생겼을 때

- `Supabase 환경변수가 없습니다`가 보이면 Vercel 환경변수 이름을 다시 확인합니다.
- 직원 등록이 실패하면 Supabase에서 `supabase/schema.sql`을 실행했는지 확인합니다.
- 카메라가 안 켜지면 주소가 `https://`로 시작하는지 확인합니다.
