# 집에서 이어서 작업하기

이 문서는 회사 데스크톱에서 진행한 최신 작업을 집 컴퓨터나 노트북에서 그대로 이어받기 위한 요약입니다.

## 현재 최신 상태

- GitHub 저장소: `https://github.com/realpro144-crypto/focus-attendance.git`
- 운영 주소: `https://focus-attendance.vercel.app/`
- 최신 커밋: `4216522 Refine mobile calendar scheduling UI`
- 현재 작업 폴더는 GitHub와 동기화되어 있습니다.

## 집 컴퓨터에서 처음 시작할 때

아래 프로그램을 먼저 설치합니다.

- Git
- Node.js 20 이상
- VS Code 또는 Cursor

원하는 작업 폴더에서 실행합니다.

```powershell
git clone https://github.com/realpro144-crypto/focus-attendance.git
cd focus-attendance
npm install
```

이미 집 컴퓨터에 받아둔 적이 있다면 새로 복사하지 않고 아래만 실행합니다.

```powershell
cd focus-attendance
git pull
npm install
```

## .env 준비

프로젝트 폴더에 `.env` 파일이 필요합니다.

```powershell
copy .env.example .env
```

`.env` 파일에 아래 두 값을 넣습니다.

```text
VITE_SUPABASE_URL=Supabase Project URL
VITE_SUPABASE_ANON_KEY=Supabase Publishable key 전체값
```

이 값은 Supabase 프로젝트의 `Project Settings > API`에서 확인합니다. `.env`는 내 컴퓨터 전용 설정 파일이라 GitHub에 올리지 않습니다.

## 실행과 점검

내 컴퓨터에서 개발 화면을 켭니다.

```powershell
npm run dev
```

수정 후 배포 전에 점검합니다.

```powershell
npm run check
```

## Supabase에서 꼭 확인할 것

캘린더 일정 기능은 `supabase/schedules.sql`이 운영 Supabase에 적용되어 있어야 정상 작동합니다.

Supabase SQL Editor에서 아래 파일 내용을 전체 복사해서 실행합니다.

```text
supabase/schedules.sql
```

성공하면 `Success. No rows returned`가 표시됩니다. Supabase가 `Potential issue detected` 경고를 보여도 이 저장소의 `schedules.sql`을 그대로 실행하는 경우에는 의도된 경고입니다.

## 작업 후 GitHub/Vercel 반영

수정이 끝나면 아래 순서로 올립니다.

```powershell
git status
npm run check
git add .
git commit -m "수정 내용"
git push
```

`git push`가 끝나면 Vercel이 자동으로 새 배포를 시작합니다. 보통 1~2분 뒤 운영 주소에 반영됩니다.

## 자주 여는 주소

- 직원 화면: `https://focus-attendance.vercel.app/checkin`
- 내 캘린더: `https://focus-attendance.vercel.app/calendar`
- 관리자 화면: `https://focus-attendance.vercel.app/dashboard`

관리자 화면은 임동춘 / 80025346 계정으로 로그인했을 때만 열립니다.
