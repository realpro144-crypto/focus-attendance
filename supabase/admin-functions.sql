create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.employees
add column if not exists is_admin boolean not null default false;

update public.employees
set name = '임동춘',
    is_admin = true,
    active = true
where employee_no = public.normalize_employee_no('80025346');

create or replace function public.require_admin_employee(session_token_input text)
returns public.employees
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_row public.employees;
begin
  select e.* into admin_row
  from public.employee_sessions s
  join public.employees e on e.id = s.employee_id
  where s.token = coalesce(session_token_input, '')
    and e.active = true
    and e.is_admin = true;

  if admin_row.id is null then
    raise exception '관리자만 이용할 수 있습니다.';
  end if;

  update public.employee_sessions
  set last_seen_at = now()
  where token = session_token_input;

  return admin_row;
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
      'isAdmin', employee_row.is_admin,
      'createdAt', employee_row.created_at
    )
  );
end;
$$;

create or replace function public.get_employee_state(session_token_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.branch_settings;
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

  select * into settings_row
  from public.branch_settings
  where id = true;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'branchName', settings_row.branch_name,
      'timezone', settings_row.timezone
    ),
    'employees', jsonb_build_array(jsonb_build_object(
      'id', employee_row.id,
      'name', employee_row.name,
      'employeeNo', employee_row.employee_no,
      'active', employee_row.active,
      'isAdmin', employee_row.is_admin,
      'createdAt', employee_row.created_at
    )),
    'records', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'employeeId', employee_row.id,
          'employeeName', employee_row.name,
          'employeeNo', employee_row.employee_no,
          'checkedInAt', r.checked_in_at,
          'dateKey', to_char(r.date_key, 'YYYY-MM-DD'),
          'localTime', r.local_time,
          'source', r.source
        )
        order by r.date_key desc, r.local_time asc
      )
      from public.attendance_records r
      where r.employee_id = employee_row.id
    ), '[]'::jsonb),
    'today', jsonb_build_object(
      'dateKey', to_char((now() at time zone settings_row.timezone)::date, 'YYYY-MM-DD'),
      'localTime', to_char(now() at time zone settings_row.timezone, 'HH24:MI')
    )
  );
end;
$$;

create or replace function public.get_admin_state(session_token_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.branch_settings;
  admin_row public.employees;
begin
  admin_row := public.require_admin_employee(session_token_input);

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
          'isAdmin', e.is_admin,
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
      where e.active = true
    ), '[]'::jsonb),
    'today', jsonb_build_object(
      'dateKey', to_char((now() at time zone settings_row.timezone)::date, 'YYYY-MM-DD'),
      'localTime', to_char(now() at time zone settings_row.timezone, 'HH24:MI')
    )
  );
end;
$$;

create or replace function public.set_branch_name_admin(
  session_token_input text,
  branch_name_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_row public.employees;
  clean_name text := trim(coalesce(branch_name_input, ''));
  settings_row public.branch_settings;
begin
  admin_row := public.require_admin_employee(session_token_input);

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

create or replace function public.set_employee_password(
  session_token_input text,
  employee_id_input uuid,
  new_password_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  admin_row public.employees;
  clean_password text := coalesce(new_password_input, '');
begin
  admin_row := public.require_admin_employee(session_token_input);

  if length(clean_password) < 4 then
    raise exception '비밀번호는 4자 이상 입력해 주세요.';
  end if;

  update public.employees
  set password_hash = crypt(clean_password, gen_salt('bf'))
  where id = employee_id_input
    and active = true;

  if not found then
    raise exception '해당 지점원을 찾을 수 없습니다.';
  end if;

  delete from public.employee_sessions
  where employee_id = employee_id_input
    and token <> session_token_input;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_employee(
  session_token_input text,
  employee_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_row public.employees;
begin
  admin_row := public.require_admin_employee(session_token_input);

  if admin_row.id = employee_id_input then
    raise exception '현재 로그인한 관리자 계정은 삭제할 수 없습니다.';
  end if;

  update public.employees
  set active = false
  where id = employee_id_input
    and active = true;

  if not found then
    raise exception '해당 지점원을 찾을 수 없습니다.';
  end if;

  delete from public.employee_sessions
  where employee_id = employee_id_input;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.get_public_state() from public;
revoke execute on function public.get_public_state() from anon, authenticated;
revoke execute on function public.set_branch_name(text) from public;
revoke execute on function public.set_branch_name(text) from anon, authenticated;
revoke execute on function public.require_admin_employee(text) from public;

grant usage on schema public to anon, authenticated;
grant execute on function public.get_checkin_public_state() to anon, authenticated;
grant execute on function public.register_employee(text, text, text) to anon, authenticated;
grant execute on function public.login_employee(text, text) to anon, authenticated;
grant execute on function public.session_employee(text) to anon, authenticated;
grant execute on function public.get_employee_state(text) to anon, authenticated;
grant execute on function public.check_in(text, text) to anon, authenticated;
grant execute on function public.get_admin_state(text) to anon, authenticated;
grant execute on function public.set_branch_name_admin(text, text) to anon, authenticated;
grant execute on function public.set_employee_password(text, uuid, text) to anon, authenticated;
grant execute on function public.delete_employee(text, uuid) to anon, authenticated;
