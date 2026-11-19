-- Round 8: teacher input (curriculum packs, outcomes, materials, Rubric R).
--
-- The database is shared with the live demo (owner decision), so this is
-- additive: existing rows keep working, and everything teachers create is
-- unpublished, i.e. visible only to teachers and admins. Learners and parents
-- keep seeing exactly the 17 published NL Grade 8 outcomes.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('teacher', 'admin'));
$$;

create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

revoke execute on function public.is_staff(), public.is_admin() from anon, public;
grant execute on function public.is_staff(), public.is_admin() to authenticated;

-- Admin createUser writes app_metadata after the insert; also sync teacher/admin.
-- The learner branch is unchanged.
create or replace function public.handle_user_app_metadata_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_role text := new.raw_app_meta_data ->> 'role';
begin
  if new_role is not distinct from (old.raw_app_meta_data ->> 'role') then
    return new;
  end if;
  if new_role = 'learner' then
    -- Only a fresh account with no family links can become a learner.
    if exists (select 1 from public.family_links where parent_id = new.id) then
      raise exception 'cannot turn a linked parent account into a learner';
    end if;
    update public.profiles
       set role = 'learner',
           username = new.raw_app_meta_data ->> 'username'
     where id = new.id;
  elsif new_role in ('teacher', 'admin') then
    -- Staff accounts are never part of a family (parent channel privacy).
    if exists (select 1 from public.family_links where parent_id = new.id or learner_id = new.id) then
      raise exception 'a family account cannot become staff';
    end if;
    update public.profiles set role = new_role::public.user_role, username = null where id = new.id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Curriculum packs
-- ---------------------------------------------------------------------------

create table public.curricula (
  id uuid primary key default gen_random_uuid(),
  province text not null check (char_length(province) between 2 and 40),
  grade int not null check (grade between 1 and 12),
  subject text not null check (char_length(subject) between 2 and 80),
  source_title text not null check (char_length(source_title) between 3 and 200),
  source_url text check (source_url ~ '^https?://'),
  published boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (province, grade, subject, source_title)
);

-- The pack the demo was built on (Appendix A).
insert into public.curricula (id, province, grade, subject, source_title, source_url, published)
values ('00000000-0000-4000-8000-000000000008', 'NL', 8, 'Mathematics',
        'Newfoundland and Labrador Grade 8 Mathematics',
        'https://ca.ixl.com/standards/newfoundland-and-labrador/math/grade-8', true);

-- ---------------------------------------------------------------------------
-- Outcomes, strands, indicators, misconceptions: new columns
-- ---------------------------------------------------------------------------

create sequence public.strands_sort_seq start 100;
create sequence public.outcomes_sort_seq start 1000;

alter table public.strands
  add column curriculum_id uuid references public.curricula (id) on delete cascade,
  add column published boolean not null default false,
  add column created_by uuid references public.profiles (id) on delete set null;
alter table public.strands alter column sort_order set default nextval('public.strands_sort_seq');
alter table public.strands alter column name_vi set default '';
update public.strands set published = true, curriculum_id = '00000000-0000-4000-8000-000000000008';

-- Codes are no longer tied to Grade 8 Math ("never hard-code Grade 8 Math").
alter table public.outcomes drop constraint outcomes_code_check;
alter table public.outcomes add constraint outcomes_code_format check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$');

alter table public.outcomes
  add column curriculum_id uuid references public.curricula (id) on delete cascade,
  add column bloom_level text check (bloom_level in ('remember', 'understand', 'apply', 'analyse', 'evaluate', 'create')),
  add column knowledge_type text check (knowledge_type in ('conceptual', 'procedural')),
  add column prerequisites text[] not null default '{}',
  add column status text not null default 'draft' check (status in ('draft', 'approved')),
  add column published boolean not null default false,
  add column created_by uuid references public.profiles (id) on delete set null,
  add column created_at timestamptz not null default now();
alter table public.outcomes alter column sort_order set default nextval('public.outcomes_sort_seq');
alter table public.outcomes alter column description_vi set default '';
alter table public.outcomes alter column parent_friendly set default '';
update public.outcomes
   set curriculum_id = '00000000-0000-4000-8000-000000000008', status = 'approved', published = true;
alter table public.outcomes alter column curriculum_id set not null;

-- Indicator and misconception codes repeat across outcomes (every LO has an M1).
alter table public.indicators drop constraint indicators_pkey;
alter table public.indicators add primary key (outcome_code, code);
alter table public.indicators add column published boolean not null default false;
update public.indicators set published = true;

alter table public.misconceptions drop constraint misconceptions_pkey;
alter table public.misconceptions add primary key (outcome_code, code);
alter table public.misconceptions alter column description_vi set default '';
alter table public.misconceptions add column published boolean not null default false;
update public.misconceptions set published = true;

-- ---------------------------------------------------------------------------
-- Guards: teachers work on drafts; approved items are read-only except for admins
-- ---------------------------------------------------------------------------

create function public.guard_teacher_outcome()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or public.is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    new.created_by := uid;
    new.status := 'draft';
    new.published := false;
    return new;
  end if;
  if old.created_by is distinct from uid or old.status <> 'draft' then
    raise exception 'only your own draft outcomes can be changed';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.published or new.created_by is distinct from old.created_by or new.code is distinct from old.code then
    raise exception 'not allowed';
  end if;
  return new;
end;
$$;

create trigger outcomes_teacher_guard
  before insert or update or delete on public.outcomes
  for each row execute function public.guard_teacher_outcome();

-- Indicators and misconceptions follow their outcome.
create function public.guard_teacher_outcome_child()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target text := coalesce(new.outcome_code, old.outcome_code);
begin
  if uid is null or public.is_admin() then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.outcomes o where o.code = target and o.created_by = uid and o.status = 'draft'
  ) then
    raise exception 'indicators and misconceptions can only be changed on your own draft outcomes';
  end if;
  if tg_op <> 'DELETE' then
    new.published := false;
    return new;
  end if;
  return old;
end;
$$;

create trigger indicators_teacher_guard
  before insert or update or delete on public.indicators
  for each row execute function public.guard_teacher_outcome_child();
create trigger misconceptions_teacher_guard
  before insert or update or delete on public.misconceptions
  for each row execute function public.guard_teacher_outcome_child();

create function public.guard_teacher_curriculum()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or public.is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    new.created_by := uid;
    new.published := false;
    return new;
  end if;
  if old.created_by is distinct from uid or old.published then
    raise exception 'only your own unpublished packs can be changed';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.published or new.created_by is distinct from old.created_by then
    raise exception 'not allowed';
  end if;
  return new;
end;
$$;

create trigger curricula_teacher_guard
  before insert or update or delete on public.curricula
  for each row execute function public.guard_teacher_curriculum();

create function public.guard_teacher_strand()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or public.is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    new.created_by := uid;
    new.published := false;
    return new;
  end if;
  raise exception 'strands can only be changed by an admin';
end;
$$;

create trigger strands_teacher_guard
  before insert or update or delete on public.strands
  for each row execute function public.guard_teacher_strand();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Learners and parents: published rows only (the live demo sees no change).
-- Teachers and admins: everything in the curriculum tables.
-- ---------------------------------------------------------------------------

alter table public.curricula enable row level security;

drop policy "strands: readable when signed in" on public.strands;
drop policy "outcomes: readable when signed in" on public.outcomes;
drop policy "indicators: readable when signed in" on public.indicators;
drop policy "misconceptions: readable when signed in" on public.misconceptions;

create policy "curricula: published, or staff" on public.curricula
  for select to authenticated using (published or public.is_staff());
create policy "strands: published, or staff" on public.strands
  for select to authenticated using (published or public.is_staff());
create policy "outcomes: published, or staff" on public.outcomes
  for select to authenticated using (published or public.is_staff());
create policy "indicators: published, or staff" on public.indicators
  for select to authenticated using (published or public.is_staff());
create policy "misconceptions: published, or staff" on public.misconceptions
  for select to authenticated using (published or public.is_staff());

-- Staff write; the guards above decide what a teacher may change.
create policy "curricula: staff write" on public.curricula for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "strands: staff write" on public.strands for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "outcomes: staff write" on public.outcomes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "indicators: staff write" on public.indicators for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "misconceptions: staff write" on public.misconceptions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

revoke all on public.curricula from anon, authenticated;
grant select, insert, update, delete on public.curricula to authenticated;
grant insert, update, delete on public.strands, public.outcomes, public.indicators, public.misconceptions to authenticated;
grant all on public.curricula to service_role;
grant usage on sequence public.strands_sort_seq, public.outcomes_sort_seq to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Materials (files in a private Storage bucket; written by server code only)
-- ---------------------------------------------------------------------------

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula (id) on delete cascade,
  outcome_codes text[] not null check (cardinality(outcome_codes) between 1 and 20),
  title text not null check (char_length(title) between 3 and 200),
  source_url text check (source_url ~ '^https?://'),
  storage_path text,
  mime_type text,
  licence text not null check (licence in ('cc_by', 'cc_by_sa', 'cc_by_nc', 'cc_by_nc_sa', 'cc0', 'public_domain', 'public_document', 'fair_dealing', 'other')),
  licence_note text check (char_length(licence_note) <= 500),
  extracted_text text,
  rubric_r jsonb,
  score numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  override_reason text check (char_length(override_reason) <= 1000),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path is not null or source_url is not null)
);

create index materials_curriculum_idx on public.materials (curriculum_id);

alter table public.materials enable row level security;
create policy "materials: staff read" on public.materials
  for select to authenticated using (public.is_staff());
revoke all on public.materials from anon, authenticated;
grant select on public.materials to authenticated;
grant all on public.materials to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/markdown', 'text/csv'])
on conflict (id) do nothing;
