create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.branch_settings (
  id boolean primary key default true check (id),
  branch_name text not null default 'FOCUS 지점',
  timezone text not null default 'Asia/Seoul',
  attendance_code text not null default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.branch_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  employee_no text not null unique,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.employee_sessions (
  token text primary key default encode(gen_random_bytes(32), 'hex'),
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  date_key date not null,
  local_time text not null,
  source text not null default 'qr',
  unique (employee_id, date_key)
);

alter table public.branch_settings enable row level security;
alter table public.employees enable row level security;
alter table public.employee_sessions enable row level security;
alter table public.attendance_records enable row level security;

create or replace function public.normalize_employee_no(input text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(trim(coalesce(input, '')), '\s+', '', 'g'));
$$;

create or replace function public.get_public_state()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings_row public.branch_settings;
begin
  insert into public.branch_settings (id)
  values (true)
  on conflict (id) do nothing;

  select * into settings_row
  from public.branch_settings
  where id = true;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'branchName', settings_row.branch_name,
      'timezone', settings_row.timezone
    ),
    'attendanceCode', settings_row.attendance_code,
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'employeeNo', e.employee_no,
          'active', e.active,
          'createdAt', e.created_at
        )
        order by e.name
      )
      from public.employees e
      where e.active = true
    ), '[]'::jsonb),
    'records', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'employeeId', e.id,
          'employeeName', e.name,
          'employeeNo', e.employee_no,
          'checkedInAt', r.checked_in_at,
          'dateKey', to_char(r.date_key, 'YYYY-MM-DD'),
          'localTime', r.local_time,
          'source', r.source
        )
        order by r.date_key desc, r.local_time asc
      )
      from public.attendance_records r
      join public.employees e on e.id = r.employee_id
    ), '[]'::jsonb),
    'today', jsonb_build_object(
      'dateKey', to_char((now() at time zone settings_row.timezone)::date, 'YYYY-MM-DD'),
      'localTime', to_char(now() at time zone settings_row.timezone, 'HH24:MI')
    )
  );
end;
$$;

create or replace function public.set_branch_name(branch_name_input text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_name text := trim(coalesce(branch_name_input, ''));
  settings_row public.branch_settings;
begin
  if clean_name = '' then
    raise exception '지점명을 입력해 주세요.';
  end if;

  insert into public.branch_settings (id)
  values (true)
  on conflict (id) do nothing;

  update public.branch_settings
  set branch_name = clean_name,
      updated_at = now()
  where id = true
  returning * into settings_row;

  return jsonb_build_object(
    'branchName', settings_row.branch_name,
    'timezone', settings_row.timezone
  );
end;
$$;

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

  insert into public.employees (name, employee_no, password_hash)
  values (clean_name, clean_no, crypt(clean_password, gen_salt('bf')))
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
      'createdAt', employee_row.created_at
    ),
    'token', session_token
  );
end;
$$;

create or replace function public.session_employee(session_token_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_row public.employees;
begin
  select e.* into employee_row
  from public.employee_sessions s
  join public.employees e on e.id = s.employee_id
  where s.token = coalesce(session_token_input, '')
    and e.active = true;

  if employee_row.id is null then
    raise exception '다시 로그인해 주세요.';
  end if;

  update public.employee_sessions
  set last_seen_at = now()
  where token = session_token_input;

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', employee_row.id,
      'name', employee_row.name,
      'employeeNo', employee_row.employee_no,
      'active', employee_row.active,
      'createdAt', employee_row.created_at
    )
  );
end;
$$;

create or replace function public.check_in(
  session_token_input text,
  qr_code_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.branch_settings;
  employee_row public.employees;
  scanned_code text := trim(coalesce(qr_code_input, ''));
  code_match text[];
  matched_code text;
  today_date date;
  local_time_value text;
  record_row public.attendance_records;
  duplicate_found boolean := false;
begin
  select * into settings_row
  from public.branch_settings
  where id = true;

  matched_code := scanned_code;
  code_match := regexp_match(scanned_code, '[?&](qr|code|attendanceCode)=([^&#]+)');
  if code_match is not null then
    matched_code := code_match[2];
  end if;

  if matched_code = '' then
    raise exception '벽에 붙은 출근 QR을 스캔해야 출근할 수 있습니다.';
  end if;

  if matched_code <> settings_row.attendance_code then
    raise exception '등록된 출근 QR이 아닙니다. 지점의 QR 코드를 다시 스캔해 주세요.';
  end if;

  select e.* into employee_row
  from public.employee_sessions s
  join public.employees e on e.id = s.employee_id
  where s.token = coalesce(session_token_input, '')
    and e.active = true;

  if employee_row.id is null then
    raise exception '다시 로그인해 주세요.';
  end if;

  today_date := (now() at time zone settings_row.timezone)::date;
  local_time_value := to_char(now() at time zone settings_row.timezone, 'HH24:MI');

  select * into record_row
  from public.attendance_records
  where employee_id = employee_row.id
    and date_key = today_date;

  if record_row.id is not null then
    duplicate_found := true;
  else
    insert into public.attendance_records (employee_id, date_key, local_time)
    values (employee_row.id, today_date, local_time_value)
    returning * into record_row;
  end if;

  return jsonb_build_object(
    'duplicate', duplicate_found,
    'record', jsonb_build_object(
      'id', record_row.id,
      'employeeId', employee_row.id,
      'employeeName', employee_row.name,
      'employeeNo', employee_row.employee_no,
      'checkedInAt', record_row.checked_in_at,
      'dateKey', to_char(record_row.date_key, 'YYYY-MM-DD'),
      'localTime', record_row.local_time,
      'source', record_row.source
    )
  );
end;
$$;

grant usage on schema public to anon, authenticated;
grant execute on function public.get_public_state() to anon, authenticated;
grant execute on function public.set_branch_name(text) to anon, authenticated;
grant execute on function public.register_employee(text, text, text) to anon, authenticated;
grant execute on function public.login_employee(text, text) to anon, authenticated;
grant execute on function public.session_employee(text) to anon, authenticated;
grant execute on function public.check_in(text, text) to anon, authenticated;
