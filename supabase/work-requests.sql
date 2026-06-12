alter table public.employees
add column if not exists is_admin boolean not null default false;

alter table public.employees
add column if not exists is_secretary boolean not null default false;

alter table public.employees
add column if not exists birth_date date;

alter table public.employees
add column if not exists mobile_carrier text;

alter table public.employees
add column if not exists phone_number text;

create table if not exists public.work_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null default 'CUSTOMER_REGISTRATION',
  requester_user_id uuid not null references public.employees(id) on delete cascade,
  requester_name text not null,
  requester_phone text,
  company_name text,
  customer_name text,
  rrn_front text,
  rrn_back text,
  phone1 text,
  phone2 text,
  phone3 text,
  address text,
  address_detail text,
  job text,
  driving_type text,
  memo text,
  status text not null default 'WAITING',
  assigned_secretary_id uuid references public.employees(id) on delete set null,
  assigned_secretary_name text,
  assigned_secretary_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_requests_type_check check (request_type in ('CUSTOMER_REGISTRATION', 'ENDORSEMENT')),
  constraint work_requests_status_check check (status in ('WAITING', 'ASSIGNED', 'COMPLETED'))
);

create index if not exists work_requests_requester_idx
on public.work_requests(requester_user_id, created_at desc);

create index if not exists work_requests_status_idx
on public.work_requests(status, created_at desc);

alter table public.work_requests enable row level security;

drop policy if exists work_requests_no_direct_access on public.work_requests;
create policy work_requests_no_direct_access
on public.work_requests
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.require_work_request_actor(session_token_input text)
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

create or replace function public.work_request_to_json(request_row public.work_requests)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', request_row.id,
    'requestType', request_row.request_type,
    'requesterUserId', request_row.requester_user_id,
    'requesterName', request_row.requester_name,
    'requesterPhone', request_row.requester_phone,
    'companyName', request_row.company_name,
    'customerName', request_row.customer_name,
    'rrnFront', request_row.rrn_front,
    'rrnBack', request_row.rrn_back,
    'phone1', request_row.phone1,
    'phone2', request_row.phone2,
    'phone3', request_row.phone3,
    'address', request_row.address,
    'addressDetail', request_row.address_detail,
    'job', request_row.job,
    'drivingType', request_row.driving_type,
    'memo', request_row.memo,
    'status', request_row.status,
    'assignedSecretaryId', request_row.assigned_secretary_id,
    'assignedSecretaryName', request_row.assigned_secretary_name,
    'assignedSecretaryPhone', request_row.assigned_secretary_phone,
    'createdAt', request_row.created_at,
    'updatedAt', request_row.updated_at
  );
$$;

create or replace function public.get_work_request_state(session_token_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  can_manage_all boolean;
begin
  actor_row := public.require_work_request_actor(session_token_input);
  can_manage_all := coalesce(actor_row.is_admin, false) or coalesce(actor_row.is_secretary, false);

  return jsonb_build_object(
    'canManageWorkRequests', can_manage_all,
    'canHandleWorkRequests', coalesce(actor_row.is_secretary, false),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'employeeNo', e.employee_no,
          'active', e.active,
          'isAdmin', e.is_admin,
          'isSecretary', e.is_secretary,
          'birthDate', to_char(e.birth_date, 'YYYY-MM-DD'),
          'mobileCarrier', e.mobile_carrier,
          'phoneNumber', e.phone_number,
          'createdAt', e.created_at
        )
        order by e.name
      )
      from public.employees e
      where e.active = true
        and (can_manage_all or e.id = actor_row.id)
    ), '[]'::jsonb),
    'workRequests', coalesce((
      select jsonb_agg(
        public.work_request_to_json(wr)
        order by wr.created_at desc
      )
      from public.work_requests wr
      join public.employees e on e.id = wr.requester_user_id and e.active = true
      where can_manage_all or wr.requester_user_id = actor_row.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_work_request(
  session_token_input text,
  request_type_input text,
  company_name_input text,
  customer_name_input text,
  rrn_front_input text,
  rrn_back_input text,
  phone1_input text,
  phone2_input text,
  phone3_input text,
  address_input text,
  address_detail_input text,
  job_input text,
  driving_type_input text,
  memo_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  request_row public.work_requests;
  clean_request_type text := upper(trim(coalesce(request_type_input, 'CUSTOMER_REGISTRATION')));
  clean_company text := left(trim(coalesce(company_name_input, '')), 120);
  clean_customer text := left(regexp_replace(trim(coalesce(customer_name_input, '')), '\s+', ' ', 'g'), 80);
  clean_rrn_front text := regexp_replace(trim(coalesce(rrn_front_input, '')), '\D', '', 'g');
  clean_rrn_back text := regexp_replace(trim(coalesce(rrn_back_input, '')), '\D', '', 'g');
  clean_phone1 text := regexp_replace(trim(coalesce(phone1_input, '')), '\D', '', 'g');
  clean_phone2 text := regexp_replace(trim(coalesce(phone2_input, '')), '\D', '', 'g');
  clean_phone3 text := regexp_replace(trim(coalesce(phone3_input, '')), '\D', '', 'g');
begin
  actor_row := public.require_work_request_actor(session_token_input);

  if clean_request_type not in ('CUSTOMER_REGISTRATION', 'ENDORSEMENT') then
    raise exception '등록할 수 없는 업무 유형입니다.';
  end if;

  if clean_customer = '' then
    raise exception '고객명을 입력해 주세요.';
  end if;

  if clean_company = '' then
    raise exception '등록회사명을 선택해 주세요.';
  end if;

  insert into public.work_requests (
    request_type,
    requester_user_id,
    requester_name,
    requester_phone,
    company_name,
    customer_name,
    rrn_front,
    rrn_back,
    phone1,
    phone2,
    phone3,
    address,
    address_detail,
    job,
    driving_type,
    memo,
    status
  )
  values (
    clean_request_type,
    actor_row.id,
    actor_row.name,
    actor_row.phone_number,
    clean_company,
    clean_customer,
    left(clean_rrn_front, 6),
    left(clean_rrn_back, 7),
    left(clean_phone1, 3),
    left(clean_phone2, 4),
    left(clean_phone3, 4),
    left(trim(coalesce(address_input, '')), 300),
    left(trim(coalesce(address_detail_input, '')), 200),
    left(trim(coalesce(job_input, '')), 120),
    left(trim(coalesce(driving_type_input, '')), 80),
    left(trim(coalesce(memo_input, '')), 1000),
    'WAITING'
  )
  returning * into request_row;

  return public.work_request_to_json(request_row);
end;
$$;

create or replace function public.assign_work_request(
  session_token_input text,
  request_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  request_row public.work_requests;
begin
  actor_row := public.require_work_request_actor(session_token_input);

  if coalesce(actor_row.is_secretary, false) is not true then
    raise exception '비서 권한이 필요합니다.';
  end if;

  select * into request_row
  from public.work_requests
  where id = request_id_input
  for update;

  if request_row.id is null then
    raise exception '업무요청을 찾을 수 없습니다.';
  end if;

  if request_row.status <> 'WAITING' then
    raise exception '대기 중인 업무요청만 접수할 수 있습니다.';
  end if;

  update public.work_requests
  set
    status = 'ASSIGNED',
    assigned_secretary_id = actor_row.id,
    assigned_secretary_name = actor_row.name,
    assigned_secretary_phone = actor_row.phone_number,
    updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return public.work_request_to_json(request_row);
end;
$$;

create or replace function public.complete_work_request(
  session_token_input text,
  request_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  request_row public.work_requests;
begin
  actor_row := public.require_work_request_actor(session_token_input);

  if coalesce(actor_row.is_secretary, false) is not true then
    raise exception '비서 권한이 필요합니다.';
  end if;

  select * into request_row
  from public.work_requests
  where id = request_id_input
  for update;

  if request_row.id is null then
    raise exception '업무요청을 찾을 수 없습니다.';
  end if;

  if request_row.status <> 'ASSIGNED' or request_row.assigned_secretary_id is distinct from actor_row.id then
    raise exception '본인이 접수한 업무요청만 완료할 수 있습니다.';
  end if;

  update public.work_requests
  set
    status = 'COMPLETED',
    updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return public.work_request_to_json(request_row);
end;
$$;

create or replace function public.set_employee_role(
  session_token_input text,
  employee_id_input uuid,
  role_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  target_row public.employees;
  clean_role text := lower(trim(coalesce(role_input, 'member')));
begin
  actor_row := public.require_work_request_actor(session_token_input);

  if coalesce(actor_row.is_admin, false) is not true then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  if clean_role not in ('member', 'secretary', 'admin') then
    raise exception '선택할 수 없는 권한입니다.';
  end if;

  if employee_id_input = actor_row.id and clean_role <> 'admin' then
    raise exception '본인 관리자 권한은 해제할 수 없습니다.';
  end if;

  update public.employees
  set
    is_admin = clean_role = 'admin',
    is_secretary = clean_role = 'secretary'
  where id = employee_id_input
    and active = true
  returning * into target_row;

  if target_row.id is null then
    raise exception '지점원을 찾을 수 없습니다.';
  end if;

  return jsonb_build_object(
    'id', target_row.id,
    'name', target_row.name,
    'employeeNo', target_row.employee_no,
    'isAdmin', target_row.is_admin,
    'isSecretary', target_row.is_secretary
  );
end;
$$;

revoke all on table public.work_requests from anon, authenticated;
revoke execute on function public.require_work_request_actor(text) from public;
revoke execute on function public.work_request_to_json(public.work_requests) from public;

grant execute on function public.get_work_request_state(text) to anon, authenticated;
grant execute on function public.create_work_request(text, text, text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.assign_work_request(text, uuid) to anon, authenticated;
grant execute on function public.complete_work_request(text, uuid) to anon, authenticated;
grant execute on function public.set_employee_role(text, uuid, text) to anon, authenticated;
