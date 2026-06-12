# Supabase SQL 적용 순서

Supabase 프로젝트를 새로 만들었거나 데이터베이스 구조를 다시 세팅할 때 이 순서로 실행합니다.

## 새 프로젝트

1. SQL Editor에서 `schema.sql` 전체 실행
2. SQL Editor에서 `admin-functions.sql` 전체 실행
3. SQL Editor에서 `schedules.sql` 전체 실행
4. SQL Editor에서 `insurance-accounts.sql` 전체 실행
5. SQL Editor에서 `work-requests.sql` 전체 실행

## 이미 운영 중인 프로젝트

관리자 기능, 계정 관리, 출근 기록 함수만 수정했다면 보통 `admin-functions.sql`만 다시 실행하면 됩니다.

일정 추가/수정/삭제, 공식 일정, 캘린더 권한을 수정했다면 `schedules.sql`을 다시 실행합니다.

사번/비밀번호 기능을 수정했다면 `insurance-accounts.sql`을 다시 실행합니다.

업무요청 저장, 접수, 완료, 비서 권한 기능을 수정했다면 `work-requests.sql`을 다시 실행합니다.

## 현재 관리자 계정

- 이름: 임동춘
- 사번: 80025346

`admin-functions.sql`을 실행하면 이 사번의 계정이 관리자 계정으로 설정됩니다.

## 주의

Supabase가 destructive operation 경고를 보여줄 수 있습니다. 함수 교체, 권한 변경, 관리자 표시 업데이트가 들어 있기 때문입니다.

이 저장소의 SQL 파일을 그대로 실행하는 경우에는 의도된 경고입니다.
