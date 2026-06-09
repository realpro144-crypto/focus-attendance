# 포커스앱

Vercel + Supabase 클라우드 배포용 출근부 앱입니다.

직원은 휴대폰에서 HTTPS 주소로 접속해 로그인/등록하고, 벽에 붙은 QR을 카메라로 스캔해서 출근 기록을 남깁니다.

## 현재 구조

- 화면: Vite + React
- 데이터 저장: Supabase 클라우드
- 배포: Vercel
- 필수 환경변수:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## 로컬 확인

```powershell
npm install
npm run build
```

빌드가 성공하면 Vercel에 올릴 준비가 된 것입니다.

## Supabase 준비

1. Supabase에서 새 클라우드 프로젝트를 만듭니다.
2. Supabase 프로젝트의 SQL Editor를 엽니다.
3. `supabase/schema.sql` 파일 내용을 전체 복사해서 실행합니다.
4. Project Settings > API에서 아래 값을 확인합니다.
   - Project URL
   - anon public key

## Vercel 환경변수

Vercel 프로젝트 설정의 Environment Variables에 아래 이름 그대로 추가합니다.

```text
VITE_SUPABASE_URL=Supabase Project URL
VITE_SUPABASE_ANON_KEY=Supabase anon public key
```

## Vercel 빌드 설정

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

## 배포 후 사용

1. Vercel 배포가 끝나면 `https://...vercel.app` 주소가 생깁니다.
2. 관리자 화면은 `https://...vercel.app/dashboard`입니다.
3. 직원 화면은 `https://...vercel.app/checkin`입니다.
4. 관리자 화면의 벽 부착 QR을 인쇄해서 지점에 붙입니다.
5. 직원은 휴대폰에서 직원 화면으로 접속 후 등록/로그인하고 QR을 스캔합니다.

## 주의

- 더 이상 `localhost`나 같은 와이파이 주소를 실제 운영 주소로 쓰지 않습니다.
- QR 카메라는 HTTPS에서 가장 안정적으로 작동합니다.
- 현재 앱은 빠른 운영 MVP입니다. 외부 공개 전 관리자 화면 비밀번호 보호를 추가하는 것을 권장합니다.
