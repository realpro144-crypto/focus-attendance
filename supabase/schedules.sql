create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  created_by uuid not null references public.employees(id) on delete cascade,
  title text not null,
  memo text not null default '',
  date_key date not null,
  end_date_key date not null default current_date,
  start_time text,
  end_time text,
  schedule_type text not null default 'personal',
  color text not null default '#F97316',
  is_official boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_events
add column if not exists end_date_key date;

alter table public.schedule_events
add column if not exists schedule_type text not null default 'personal';

update public.schedule_events
set end_date_key = coalesce(end_date_key, date_key)
where end_date_key is null;

alter table public.schedule_events
alter column end_date_key set not null;

alter table public.schedule_events
alter column end_date_key set default current_date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_events_scope_check'
      and conrelid = 'public.schedule_events'::regclass
  ) then
    alter table public.schedule_events
    add constraint schedule_events_scope_check
    check (
      (is_official = true and employee_id is null)
      or
      (is_official = false and employee_id is not null)
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_events_type_check'
      and conrelid = 'public.schedule_events'::regclass
  ) then
    alter table public.schedule_events
    add constraint schedule_events_type_check
    check (schedule_type in ('customer', 'education', 'personal', 'vacation'));
  end if;
end;
$$;

alter table public.schedule_events enable row level security;

create index if not exists schedule_events_date_idx
on public.schedule_events(date_key);

create index if not exists schedule_events_end_date_idx
on public.schedule_events(end_date_key);

create index if not exists schedule_events_employee_date_idx
on public.schedule_events(employee_id, date_key, end_date_key);

create or replace function public.normalize_schedule_type(type_input text)
returns text
language plpgsql
immutable
as $$
declare
  clean_type text := lower(trim(coalesce(type_input, '')));
begin
  if clean_type in ('customer', 'education', 'personal', 'vacation') then
    return clean_type;
  end if;

  return 'personal';
end;
$$;

create or replace function public.default_schedule_color(type_input text)
returns text
language plpgsql
immutable
as $$
declare
  clean_type text := public.normalize_schedule_type(type_input);
begin
  if clean_type = 'customer' then
    return '#22C55E';
  elsif clean_type = 'education' then
    return '#8B5CF6';
  elsif clean_type = 'vacation' then
    return '#6B7280';
  end if;

  return '#F97316';
end;
$$;

create or replace function public.normalize_schedule_color(color_input text, type_input text)
returns text
language plpgsql
immutable
as $$
declare
  clean_color text := upper(trim(coalesce(color_input, '')));
begin
  if clean_color ~ '^#[0-9A-F]{6}$' then
    return clean_color;
  end if;

  return public.default_schedule_color(type_input);
end;
$$;

create or replace function public.require_schedule_actor(session_token_input text)
returns public.employees
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

  return employee_row;
end;
$$;

create or replace function public.schedule_event_to_json(event_row public.schedule_events)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  target_row public.employees;
  creator_row public.employees;
begin
  if event_row.employee_id is not null then
    select * into target_row
    from public.employees
    where id = event_row.employee_id;
  end if;

  select * into creator_row
  from public.employees
  where id = event_row.created_by;

  return jsonb_build_object(
    'id', event_row.id,
    'employeeId', event_row.employee_id,
    'employeeName', case when event_row.is_official then '전체 지점원' else target_row.name end,
    'employeeNo', target_row.employee_no,
    'createdBy', event_row.created_by,
    'createdByName', creator_row.name,
    'title', event_row.title,
    'memo', event_row.memo,
    'dateKey', to_char(event_row.date_key, 'YYYY-MM-DD'),
    'startDateKey', to_char(event_row.date_key, 'YYYY-MM-DD'),
    'endDateKey', to_char(event_row.end_date_key, 'YYYY-MM-DD'),
    'startTime', event_row.start_time,
    'endTime', event_row.end_time,
    'type', event_row.schedule_type,
    'color', event_row.color,
    'isOfficial', event_row.is_official,
    'createdAt', event_row.created_at,
    'updatedAt', event_row.updated_at
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
  employee_row := public.require_schedule_actor(session_token_input);

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
    'schedules', coalesce((
      select jsonb_agg(
        public.schedule_event_to_json(ev)
        order by ev.date_key asc, coalesce(ev.start_time, '99:99'), ev.title
      )
      from public.schedule_events ev
      where ev.is_official = true
         or ev.employee_id = employee_row.id
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
    'schedules', coalesce((
      select jsonb_agg(
        public.schedule_event_to_json(ev)
        order by ev.date_key asc, coalesce(ev.start_time, '99:99'), ev.title
      )
      from public.schedule_events ev
      left join public.employees target_employee on target_employee.id = ev.employee_id
      where ev.is_official = true
         or target_employee.active = true
    ), '[]'::jsonb),
    'today', jsonb_build_object(
      'dateKey', to_char((now() at time zone settings_row.timezone)::date, 'YYYY-MM-DD'),
      'localTime', to_char(now() at time zone settings_row.timezone, 'HH24:MI')
    )
  );
end;
$$;

drop function if exists public.upsert_schedule_event(text, uuid, text, text, text, text, text, text, boolean, uuid);

create or replace function public.upsert_schedule_event(
  session_token_input text,
  schedule_id_input uuid,
  title_input text,
  start_datetime_input text,
  end_datetime_input text,
  memo_input text,
  type_input text,
  color_input text,
  is_official_input boolean,
  employee_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  existing_row public.schedule_events;
  event_row public.schedule_events;
  target_employee public.employees;
  clean_title text := regexp_replace(trim(coalesce(title_input, '')), '\s+', ' ', 'g');
  clean_memo text := left(trim(coalesce(memo_input, '')), 300);
  clean_type text := public.normalize_schedule_type(type_input);
  clean_color text := public.normalize_schedule_color(color_input, type_input);
  start_ts timestamp;
  end_ts timestamp;
  new_is_official boolean := coalesce(is_official_input, false);
  target_employee_id uuid;
begin
  actor_row := public.require_schedule_actor(session_token_input);

  if clean_title = '' then
    raise exception '제목을 입력해 주세요.';
  end if;

  begin
    start_ts := replace(trim(coalesce(start_datetime_input, '')), 'T', ' ')::timestamp;
  exception when others then
    raise exception '시작일시가 올바르지 않습니다.';
  end;

  if nullif(trim(coalesce(end_datetime_input, '')), '') is null then
    end_ts := start_ts + interval '1 hour';
  else
    begin
      end_ts := replace(trim(end_datetime_input), 'T', ' ')::timestamp;
    exception when others then
      raise exception '종료일시가 올바르지 않습니다.';
    end;
  end if;

  if end_ts <= start_ts then
    raise exception '종료일시는 시작일시보다 늦어야 합니다.';
  end if;

  if new_is_official then
    if actor_row.is_admin is not true then
      raise exception '공식 일정은 관리자만 등록할 수 있습니다.';
    end if;
    target_employee_id := null;
  elsif actor_row.is_admin is true then
    target_employee_id := coalesce(employee_id_input, actor_row.id);

    select * into target_employee
    from public.employees
    where id = target_employee_id
      and active = true;

    if target_employee.id is null then
      raise exception '대상 지점원을 찾을 수 없습니다.';
    end if;
  else
    target_employee_id := actor_row.id;
    if employee_id_input is not null and employee_id_input <> actor_row.id then
      raise exception '개인 일정은 본인 일정만 등록할 수 있습니다.';
    end if;
  end if;

  if schedule_id_input is null then
    insert into public.schedule_events (
      employee_id,
      created_by,
      title,
      memo,
      date_key,
      end_date_key,
      start_time,
      end_time,
      schedule_type,
      color,
      is_official
    )
    values (
      target_employee_id,
      actor_row.id,
      clean_title,
      clean_memo,
      start_ts::date,
      end_ts::date,
      to_char(start_ts, 'HH24:MI'),
      to_char(end_ts, 'HH24:MI'),
      clean_type,
      clean_color,
      new_is_official
    )
    returning * into event_row;

    return public.schedule_event_to_json(event_row);
  end if;

  select * into existing_row
  from public.schedule_events
  where id = schedule_id_input;

  if existing_row.id is null then
    raise exception '일정을 찾을 수 없습니다.';
  end if;

  if actor_row.is_admin is not true then
    if existing_row.is_official or existing_row.employee_id <> actor_row.id then
      raise exception '본인 일정만 수정할 수 있습니다.';
    end if;
    new_is_official := false;
    target_employee_id := actor_row.id;
  end if;

  update public.schedule_events
  set employee_id = target_employee_id,
      title = clean_title,
      memo = clean_memo,
      date_key = start_ts::date,
      end_date_key = end_ts::date,
      start_time = to_char(start_ts, 'HH24:MI'),
      end_time = to_char(end_ts, 'HH24:MI'),
      schedule_type = clean_type,
      color = clean_color,
      is_official = new_is_official,
      updated_at = now()
  where id = existing_row.id
  returning * into event_row;

  return public.schedule_event_to_json(event_row);
end;
$$;

create or replace function public.delete_schedule_event(
  session_token_input text,
  schedule_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  existing_row public.schedule_events;
begin
  actor_row := public.require_schedule_actor(session_token_input);

  select * into existing_row
  from public.schedule_events
  where id = schedule_id_input;

  if existing_row.id is null then
    raise exception '일정을 찾을 수 없습니다.';
  end if;

  if actor_row.is_admin is not true then
    if existing_row.is_official or existing_row.employee_id <> actor_row.id then
      raise exception '본인 일정만 삭제할 수 있습니다.';
    end if;
  end if;

  delete from public.schedule_events
  where id = existing_row.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.require_schedule_actor(text) from public;
revoke execute on function public.schedule_event_to_json(public.schedule_events) from public;

grant usage on schema public to anon, authenticated;
grant execute on function public.get_employee_state(text) to anon, authenticated;
grant execute on function public.get_admin_state(text) to anon, authenticated;
grant execute on function public.upsert_schedule_event(text, uuid, text, text, text, text, text, text, boolean, uuid) to anon, authenticated;
grant execute on function public.delete_schedule_event(text, uuid) to anon, authenticated;
