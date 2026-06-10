create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  created_by uuid not null references public.employees(id) on delete cascade,
  title text not null,
  memo text not null default '',
  date_key date not null,
  start_time text,
  end_time text,
  color text not null default '#007D74',
  is_official boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
end;
$$;

alter table public.schedule_events enable row level security;

create index if not exists schedule_events_date_idx
on public.schedule_events(date_key);

create index if not exists schedule_events_employee_date_idx
on public.schedule_events(employee_id, date_key);

create or replace function public.normalize_schedule_color(color_input text)
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

  return '#007D74';
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
    'startTime', event_row.start_time,
    'endTime', event_row.end_time,
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

create or replace function public.upsert_schedule_event(
  session_token_input text,
  schedule_id_input uuid,
  title_input text,
  date_key_input text,
  start_time_input text,
  end_time_input text,
  memo_input text,
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
  clean_title text := regexp_replace(trim(coalesce(title_input, '')), '\s+', ' ', 'g');
  clean_memo text := left(trim(coalesce(memo_input, '')), 300);
  clean_date date;
  clean_start text := nullif(trim(coalesce(start_time_input, '')), '');
  clean_end text := nullif(trim(coalesce(end_time_input, '')), '');
  clean_color text := public.normalize_schedule_color(color_input);
  new_is_official boolean := coalesce(is_official_input, false);
  target_employee_id uuid;
begin
  actor_row := public.require_schedule_actor(session_token_input);

  if clean_title = '' then
    raise exception '일정명을 입력해 주세요.';
  end if;

  if date_key_input !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception '날짜 형식이 올바르지 않습니다.';
  end if;

  clean_date := date_key_input::date;

  if clean_start is not null and clean_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception '시작 시간이 올바르지 않습니다.';
  end if;

  if clean_end is not null and clean_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception '종료 시간이 올바르지 않습니다.';
  end if;

  if clean_start is not null and clean_end is not null and clean_end < clean_start then
    raise exception '종료 시간은 시작 시간보다 늦어야 합니다.';
  end if;

  if schedule_id_input is null then
    if new_is_official then
      if actor_row.is_admin is not true then
        raise exception '공식 일정은 관리자만 등록할 수 있습니다.';
      end if;
      target_employee_id := null;
    else
      target_employee_id := actor_row.id;
      if employee_id_input is not null and employee_id_input <> actor_row.id then
        raise exception '개인 일정은 본인 일정만 등록할 수 있습니다.';
      end if;
    end if;

    insert into public.schedule_events (
      employee_id,
      created_by,
      title,
      memo,
      date_key,
      start_time,
      end_time,
      color,
      is_official
    )
    values (
      target_employee_id,
      actor_row.id,
      clean_title,
      clean_memo,
      clean_date,
      clean_start,
      clean_end,
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

  if existing_row.is_official then
    if actor_row.is_admin is not true then
      raise exception '공식 일정은 관리자만 수정할 수 있습니다.';
    end if;
    target_employee_id := null;
    new_is_official := true;
  else
    if existing_row.employee_id <> actor_row.id then
      raise exception '개인 일정은 본인 일정만 수정할 수 있습니다.';
    end if;
    target_employee_id := actor_row.id;
    new_is_official := false;
  end if;

  update public.schedule_events
  set employee_id = target_employee_id,
      title = clean_title,
      memo = clean_memo,
      date_key = clean_date,
      start_time = clean_start,
      end_time = clean_end,
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

  if existing_row.is_official then
    if actor_row.is_admin is not true then
      raise exception '공식 일정은 관리자만 삭제할 수 있습니다.';
    end if;
  elsif existing_row.employee_id <> actor_row.id then
    raise exception '개인 일정은 본인 일정만 삭제할 수 있습니다.';
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
