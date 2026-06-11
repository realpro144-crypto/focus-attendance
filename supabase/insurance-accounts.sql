create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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

create table if not exists public.insurance_company_catalog (
  company_type text not null check (company_type in ('GA', 'LIFE', 'NONLIFE')),
  company_name text not null,
  display_order integer not null,
  primary key (company_type, company_name)
);

insert into public.insurance_company_catalog (company_type, company_name, display_order)
values
  ('GA', '에이플러스에셋', 1),
  ('LIFE', '라이나생명', 1),
  ('LIFE', '미래에셋생명', 2),
  ('LIFE', '흥국생명', 3),
  ('LIFE', 'DB생명', 4),
  ('LIFE', 'iM라이프', 5),
  ('LIFE', 'KDB생명', 6),
  ('LIFE', '동양생명', 7),
  ('LIFE', '푸르덴셜', 8),
  ('LIFE', '한화생명', 9),
  ('LIFE', '메트라이프', 10),
  ('LIFE', '삼성생명', 11),
  ('LIFE', 'ABL생명', 12),
  ('LIFE', 'BNP', 13),
  ('LIFE', 'NH농협생명', 14),
  ('LIFE', '신한라이프', 15),
  ('LIFE', 'IBK연금보험', 16),
  ('LIFE', 'KB생명보험', 17),
  ('LIFE', 'CHUBB', 18),
  ('LIFE', '교보생명', 19),
  ('LIFE', '푸본현대생명', 20),
  ('LIFE', '하나생명', 21),
  ('LIFE', 'AIA생명', 22),
  ('NONLIFE', '메리츠화재', 1),
  ('NONLIFE', '현대해상', 2),
  ('NONLIFE', 'DB손해보험', 3),
  ('NONLIFE', '삼성화재', 4),
  ('NONLIFE', '롯데손해보험', 5),
  ('NONLIFE', 'KB손해보험', 6),
  ('NONLIFE', '한화손해보험', 7),
  ('NONLIFE', 'NH농협손해보험', 8),
  ('NONLIFE', 'MG손해보험', 9),
  ('NONLIFE', '하나손해보험', 10),
  ('NONLIFE', '흥국화재', 11),
  ('NONLIFE', 'AIG손해보험', 12),
  ('NONLIFE', 'CHUBB손해보험', 13)
on conflict (company_type, company_name) do update
set display_order = excluded.display_order;

update public.insurance_accounts
set company_name = 'BNP',
    updated_at = now()
where company_type = 'LIFE'
  and company_name = 'BNP PARIBAS';

delete from public.insurance_company_catalog
where company_type = 'LIFE'
  and company_name = 'BNP PARIBAS';

create table if not exists public.insurance_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.employees(id) on delete cascade,
  company_type text not null check (company_type in ('GA', 'LIFE', 'NONLIFE')),
  company_name text not null,
  employee_number text not null default '',
  password_value text not null default '',
  extra_auth text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, company_type, company_name),
  foreign key (company_type, company_name)
    references public.insurance_company_catalog(company_type, company_name)
);

alter table public.insurance_company_catalog enable row level security;
alter table public.insurance_accounts enable row level security;

drop policy if exists insurance_accounts_no_direct_access on public.insurance_accounts;
create policy insurance_accounts_no_direct_access
on public.insurance_accounts
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists insurance_catalog_no_direct_write on public.insurance_company_catalog;
create policy insurance_catalog_no_direct_write
on public.insurance_company_catalog
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.require_insurance_actor(session_token_input text)
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

create or replace function public.insurance_account_to_json(account_row public.insurance_accounts)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', account_row.id,
    'ownerUserId', account_row.owner_user_id,
    'companyType', account_row.company_type,
    'companyName', account_row.company_name,
    'employeeNumber', account_row.employee_number,
    'password', account_row.password_value,
    'extraAuth', account_row.extra_auth,
    'createdAt', account_row.created_at,
    'updatedAt', account_row.updated_at
  );
$$;

create or replace function public.get_insurance_account_state(session_token_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  can_manage_all boolean;
begin
  actor_row := public.require_insurance_actor(session_token_input);
  can_manage_all := coalesce(actor_row.is_admin, false) or coalesce(actor_row.is_secretary, false);

  return jsonb_build_object(
    'canManageAllAccounts', can_manage_all,
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
    'insuranceAccounts', coalesce((
      select jsonb_agg(
        public.insurance_account_to_json(ia)
        order by c.company_type, c.display_order
      )
      from public.insurance_accounts ia
      join public.employees e on e.id = ia.owner_user_id and e.active = true
      join public.insurance_company_catalog c
        on c.company_type = ia.company_type
       and c.company_name = ia.company_name
      where can_manage_all or ia.owner_user_id = actor_row.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_insurance_accounts(
  session_token_input text,
  owner_user_id_input uuid,
  accounts_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.employees;
  target_employee public.employees;
  can_manage_all boolean;
  account_item jsonb;
  clean_type text;
  clean_company text;
  clean_employee_number text;
  clean_password text;
  clean_extra_auth text;
begin
  actor_row := public.require_insurance_actor(session_token_input);
  can_manage_all := coalesce(actor_row.is_admin, false) or coalesce(actor_row.is_secretary, false);

  if can_manage_all then
    select * into target_employee
    from public.employees
    where id = owner_user_id_input
      and active = true;

    if target_employee.id is null then
      raise exception '선택한 지점원을 찾을 수 없습니다.';
    end if;
  else
    if owner_user_id_input is not null and owner_user_id_input <> actor_row.id then
      raise exception '본인 계정 정보만 수정할 수 있습니다.';
    end if;
    target_employee := actor_row;
  end if;

  for account_item in
    select value from jsonb_array_elements(coalesce(accounts_input, '[]'::jsonb))
  loop
    clean_type := upper(trim(coalesce(account_item ->> 'companyType', '')));
    clean_company := trim(coalesce(account_item ->> 'companyName', ''));
    clean_employee_number := left(trim(coalesce(account_item ->> 'employeeNumber', '')), 120);
    clean_password := left(trim(coalesce(account_item ->> 'password', '')), 120);
    clean_extra_auth := left(trim(coalesce(account_item ->> 'extraAuth', '')), 300);

    if not exists (
      select 1
      from public.insurance_company_catalog c
      where c.company_type = clean_type
        and c.company_name = clean_company
    ) then
      raise exception '등록되지 않은 보험회사입니다: %', clean_company;
    end if;

    insert into public.insurance_accounts (
      owner_user_id,
      company_type,
      company_name,
      employee_number,
      password_value,
      extra_auth
    )
    values (
      target_employee.id,
      clean_type,
      clean_company,
      clean_employee_number,
      clean_password,
      clean_extra_auth
    )
    on conflict (owner_user_id, company_type, company_name)
    do update set
      employee_number = excluded.employee_number,
      password_value = excluded.password_value,
      extra_auth = excluded.extra_auth,
      updated_at = now();
  end loop;

  return public.get_insurance_account_state(session_token_input);
end;
$$;

create or replace function public.register_employee(
  name_input text,
  employee_no_input text,
  password_input text,
  birth_date_input text,
  mobile_carrier_input text,
  phone_number_input text
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
  clean_birth_date date;
  clean_mobile_carrier text := trim(coalesce(mobile_carrier_input, ''));
  clean_phone_number text := regexp_replace(trim(coalesce(phone_number_input, '')), '\s+', '', 'g');
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

  begin
    clean_birth_date := trim(coalesce(birth_date_input, ''))::date;
  exception when others then
    raise exception '생년월일을 입력해 주세요.';
  end;

  if clean_mobile_carrier not in ('SKT', 'KT', 'LGU+', 'SKT(알뜰)', 'KT(알뜰)', 'LGU+(알뜰)') then
    raise exception '통신사를 선택해 주세요.';
  end if;

  if clean_phone_number = '' then
    raise exception '핸드폰번호를 입력해 주세요.';
  end if;

  update public.employees
  set employee_no = employee_no || '_DELETED_' || replace(id::text, '-', '')
  where employee_no = clean_no
    and active = false;

  if exists (select 1 from public.employees where employee_no = clean_no and active = true) then
    raise exception '이미 등록된 사번입니다. 로그인해 주세요.';
  end if;

  insert into public.employees (
    name,
    employee_no,
    password_hash,
    is_admin,
    birth_date,
    mobile_carrier,
    phone_number
  )
  values (
    clean_name,
    clean_no,
    crypt(clean_password, gen_salt('bf')),
    clean_name = '임동춘' and clean_no = public.normalize_employee_no('80025346'),
    clean_birth_date,
    clean_mobile_carrier,
    clean_phone_number
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
      'isSecretary', employee_row.is_secretary,
      'birthDate', to_char(employee_row.birth_date, 'YYYY-MM-DD'),
      'mobileCarrier', employee_row.mobile_carrier,
      'phoneNumber', employee_row.phone_number,
      'createdAt', employee_row.created_at
    ),
    'token', session_token
  );
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
  set active = false,
      employee_no = employee_no || '_DELETED_' || replace(id::text, '-', '')
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

revoke all on table public.insurance_accounts from anon, authenticated;
revoke all on table public.insurance_company_catalog from anon, authenticated;
revoke execute on function public.require_insurance_actor(text) from public;

grant usage on schema public to anon, authenticated;
grant execute on function public.register_employee(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_employee(text, uuid) to anon, authenticated;
grant execute on function public.get_insurance_account_state(text) to anon, authenticated;
grant execute on function public.upsert_insurance_accounts(text, uuid, jsonb) to anon, authenticated;
