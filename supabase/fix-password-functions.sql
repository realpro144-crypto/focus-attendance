create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.employees
add column if not exists is_admin boolean not null default false;

update public.employees
set name = '임동춘',
    is_admin = true,
    active = true
where employee_no = public.normalize_employee_no('80025346');

create or replace function public.register_employee(
  name_input text,
  employee_no_input text,
  password_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_name text := regexp_replace(trim(coalesce(name_input, '')), '\s+', ' ', 'g');
  clean_no text := public.normalize_employee_no(employee_no_input);
  clean_password text := coalesce(password_input, '');
  employee_row public.employees;
  session_token text;
begin
  if clean_name = '' then
    raise exception '이름을 입력해 주세요.';
  end if;
  if clean_no !~ '^[A-Z0-9._-]{2,24}$' then
    raise exception '사번은 영문, 숫자, 점, 밑줄, 하이픈으로 2~24자까지 입력할 수 있습니다.';
  end if;
  if length(clean_password) < 4 then
    raise exception '비밀번호는 4자 이상 입력해 주세요.';
  end if;
  if exists (select 1 from public.employees where employee_no = clean_no) then
    raise exception '이미 등록된 사번입니다. 로그인해 주세요.';
  end if;
  insert into public.employees (name, employee_no, password_hash, is_admin)
  values (
    clean_name,
    clean_no,
    crypt(clean_password, gen_salt('bf')),
    clean_name = '임동춘' and clean_no = public.normalize_employee_no('80025346')
  )
  returning * into employee_row;
  insert into public.employee_sessions (employee_id)
  values (employee_row.id)
  returning token into session_token;
  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', employee_row.id,
      'name', employee_row.name,
      'employeeNo', employee_row.employee_no,
      'active', employee_row.active,
      'isAdmin', employee_row.is_admin,
      'createdAt', employee_row.created_at
    ),
    'token', session_token
  );
end;
$$;
create or replace function public.login_employee(
  employee_no_input text,
  password_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_no text := public.normalize_employee_no(employee_no_input);
  clean_password text := coalesce(password_input, '');
  employee_row public.employees;
  session_token text;
begin
  select * into employee_row
  from public.employees
  where employee_no = clean_no
    and active = true;
  if employee_row.id is null or employee_row.password_hash <> crypt(clean_password, employee_row.password_hash) then
    raise exception '사번 또는 비밀번호가 올바르지 않습니다.';
  end if;
  update public.employees
  set last_login_at = now()
  where id = employee_row.id;
  insert into public.employee_sessions (employee_id)
  values (employee_row.id)
  returning token into session_token;
  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', employee_row.id,
      'name', employee_row.name,
      'employeeNo', employee_row.employee_no,
      'active', employee_row.active,
      'isAdmin', employee_row.is_admin,
      'createdAt', employee_row.created_at
    ),
    'token', session_token
  );
end;
$$;
grant execute on function public.register_employee(text, text, text) to anon, authenticated;
grant execute on function public.login_employee(text, text) to anon, authenticated;
