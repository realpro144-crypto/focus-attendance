# 배포 전 체크리스트

수정 후 운영 주소에 반영하기 전에 아래만 확인하면 됩니다.

## 코드 확인

```powershell
npm run check
```

성공하면 기본 빌드 검사는 통과입니다.

## 화면 확인

- 직원 화면: http://localhost:5173/checkin
- 내 캘린더: http://localhost:5173/calendar
- 관리자 화면: http://localhost:5173/dashboard

관리자 화면은 임동춘 / 80025346 계정으로 로그인해야 볼 수 있습니다.

## Supabase SQL을 바꿨을 때

SQL 파일을 수정한 경우에는 Supabase SQL Editor에서 해당 파일을 실행해야 실제 운영 데이터베이스에 반영됩니다.

보통 실행 순서:

1. `supabase/schema.sql`
2. `supabase/admin-functions.sql`

이미 운영 중인 프로젝트에서 관리자 기능만 바꾼 경우에는 `supabase/admin-functions.sql`만 다시 실행하면 됩니다.

## GitHub/Vercel 배포

```powershell
git status
git add .
git commit -m "변경 내용"
git push
```

GitHub에 올라가면 Vercel이 자동 배포합니다.

## 운영 주소 확인

- https://focus-attendance.vercel.app/checkin
- https://focus-attendance.vercel.app/calendar
- https://focus-attendance.vercel.app/dashboard

배포 직후에는 1~2분 정도 이전 화면이 보일 수 있습니다.
