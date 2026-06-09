# 개발 환경 준비

이 문서는 회사 데스크톱, 집 컴퓨터, 노트북 어디에서든 포커스앱 개발을 이어가기 위한 순서입니다.

## 1. 처음 한 번만 설치

아래 프로그램을 설치합니다.

- Git
- Node.js 20 LTS 이상
- VS Code 또는 Cursor 같은 코드 편집기

설치가 끝나면 터미널에서 확인합니다.

```powershell
git --version
node --version
npm --version
```

## 2. GitHub에서 프로젝트 가져오기

작업할 폴더로 이동한 뒤 아래 명령을 실행합니다.

```powershell
git clone https://github.com/realpro144-crypto/focus-attendance.git
cd focus-attendance
npm install
```

이미 받아둔 컴퓨터라면 새로 복사하지 않고 아래만 실행하면 됩니다.

```powershell
git pull
npm install
```

## 3. .env 만들기

프로젝트 폴더 안에서 `.env.example` 파일을 복사해서 `.env` 파일을 만듭니다.

```powershell
copy .env.example .env
```

`.env` 파일 안에는 Supabase 값 2개가 들어가야 합니다.

```text
VITE_SUPABASE_URL=https://pnevqxowjooicxfnfxql.supabase.co
VITE_SUPABASE_ANON_KEY=Supabase Publishable key 전체값
```

주의: `.env`는 내 컴퓨터 전용 비밀 설정 파일입니다. GitHub에 올리지 않습니다.

## 4. 개발 서버 켜기

컴퓨터에서만 확인할 때:

```powershell
npm run dev
```

같은 와이파이 휴대폰에서도 개발 화면을 확인할 때:

```powershell
npm run dev:lan
```

단, QR 카메라는 실제 운영처럼 HTTPS 주소에서 확인하는 것이 가장 안정적입니다.

## 5. 수정 후 점검

수정이 끝나면 배포 전에 아래 명령을 실행합니다.

```powershell
npm run check
```

이 명령은 기본 개발 환경을 확인하고 앱이 정상 빌드되는지 검사합니다.

## 6. GitHub에 저장하고 Vercel 배포

수정한 내용을 GitHub에 올리면 Vercel이 자동으로 새 배포를 시작합니다.

```powershell
git status
git add .
git commit -m "수정 내용 짧게 적기"
git push
```

배포 주소:

- 직원 화면: https://focus-attendance.vercel.app/checkin
- 관리자 화면: https://focus-attendance.vercel.app/dashboard

## 추천 작업 순서

1. 작업 시작 전 `git pull`
2. 수정
3. `npm run check`
4. 브라우저에서 화면 확인
5. `git add .`
6. `git commit -m "작업 내용"`
7. `git push`
8. Vercel 배포 확인

## 자주 막히는 부분

`npm install`이 실패하면 Node.js 버전이 20 이상인지 먼저 확인합니다.

`.env` 오류가 나오면 `.env` 파일이 있는지, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 이름이 정확한지 확인합니다.

다른 컴퓨터에서 관리자 버튼이 안 보이면 Supabase에 `supabase/admin-functions.sql`이 적용되어 있는지 확인하고, 임동춘 / 80025346 계정으로 다시 로그인합니다.
