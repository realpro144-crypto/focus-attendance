create or replace function public.get_checkin_public_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.branch_settings;
begin
  insert into public.branch_settings (id)
  values (true)
  on conflict (id) do nothing;
  select * into settings_row from public.branch_settings where id = true;
  return jsonb_build_object(
    'settings', jsonb_build_object('branchName', settings_row.branch_name, 'timezone', settings_row.timezone),
    'employees', '[]'::jsonb,
    'records', '[]'::jsonb,
    'today', jsonb_build_object(
      'dateKey', to_char((now() at time zone settings_row.timezone)::date, 'YYYY-MM-DD'),
      'localTime', to_char(now() at time zone settings_row.timezone, 'HH24:MI')
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
  update public.employee_sessions set last_seen_at = now() where token = session_token_input;
  select * into settings_row from public.branch_settings where id = true;
  return jsonb_build_object(
    'settings', jsonb_build_object('branchName', settings_row.branch_name, 'timezone', settings_row.timezone),
    'employees', jsonb_build_array(jsonb_build_object(
      'id', employee_row.id,
      'name', employee_row.name,
      'employeeNo', employee_row.employee_no,
      'active', employee_row.active,
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

grant execute on function public.get_checkin_public_state() to anon, authenticated;
grant execute on function public.get_employee_state(text) to anon, authenticated;
