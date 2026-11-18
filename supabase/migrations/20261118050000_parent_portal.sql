-- Round 5: parent portal. Sharing settings (§7.3), sharing-aware views,
-- reward rules (§7.4), schedules and change requests (§7.6), sessions table
-- (written from Round 6). Synthetic demo data only.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_parent_of(p_learner uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.family_links
    where parent_id = (select auth.uid()) and learner_id = p_learner
  );
$$;

-- The learner themself, or a linked parent. Views use this so the learner's
-- "What my parent sees" page reads exactly what the parent reads.
create function public.can_view_learner(p_learner uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_learner = (select auth.uid()) or public.is_parent_of(p_learner);
$$;

-- ---------------------------------------------------------------------------
-- Sharing (single source of truth in lib/sharing.ts; a test checks parity)
-- ---------------------------------------------------------------------------

create table public.sharing_defaults (
  item text primary key,
  default_shared boolean not null,
  locked boolean not null
);

insert into public.sharing_defaults (item, default_shared, locked) values
  ('attendance',         true,  true),
  ('safety_alerts',      true,  true),
  ('reward_progress',    true,  true),
  ('outcome_status',     true,  false),
  ('scores',             true,  false),
  ('question_summaries', false, false),
  ('misconceptions',     false, false);

create table public.sharing_settings (
  learner_id uuid not null references public.profiles (id) on delete cascade,
  item text not null references public.sharing_defaults (item),
  shared boolean not null,
  locked boolean not null,
  updated_at timestamptz not null default now(),
  primary key (learner_id, item)
);

-- Effective sharing: locked items are always shared.
create function public.is_shared(p_learner uuid, p_item text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when d.locked then true else coalesce(s.shared, d.default_shared) end
  from public.sharing_defaults d
  left join public.sharing_settings s on s.learner_id = p_learner and s.item = d.item
  where d.item = p_item;
$$;

-- Every learner gets the default rows (also when a profile becomes a learner).
create function public.seed_sharing_settings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'learner' then
    insert into public.sharing_settings (learner_id, item, shared, locked)
    select new.id, d.item, d.default_shared, d.locked from public.sharing_defaults d
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger profiles_seed_sharing
  after insert or update of role on public.profiles
  for each row execute function public.seed_sharing_settings();

insert into public.sharing_settings (learner_id, item, shared, locked)
select p.id, d.item, d.default_shared, d.locked
from public.profiles p cross join public.sharing_defaults d
where p.role = 'learner'
on conflict do nothing;

-- Locked items can never be turned off, by anyone.
create function public.guard_sharing_settings()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.locked and (new.shared is distinct from old.shared or new.locked is distinct from old.locked) then
    raise exception 'sharing item % is locked', old.item;
  end if;
  if new.locked is distinct from old.locked then
    raise exception 'locked cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger sharing_settings_guard
  before update on public.sharing_settings
  for each row execute function public.guard_sharing_settings();

alter table public.sharing_defaults enable row level security;
alter table public.sharing_settings enable row level security;

create policy "sharing_defaults: readable when signed in" on public.sharing_defaults
  for select to authenticated using (true);
create policy "sharing_settings: learner reads own" on public.sharing_settings
  for select to authenticated using (learner_id = (select auth.uid()));
create policy "sharing_settings: learner changes unlocked items" on public.sharing_settings
  for update to authenticated
  using (learner_id = (select auth.uid()) and not locked)
  with check (learner_id = (select auth.uid()) and not locked);

revoke all on public.sharing_defaults, public.sharing_settings from anon, authenticated;
grant select on public.sharing_defaults, public.sharing_settings to authenticated;
grant update (shared) on public.sharing_settings to authenticated;
grant all on public.sharing_defaults, public.sharing_settings to service_role;

-- ---------------------------------------------------------------------------
-- Sessions (engagement logic arrives in Round 6)
-- ---------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id text,
  scheduled_for timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  active_seconds int not null default 0 check (active_seconds >= 0),
  idle_seconds int not null default 0 check (idle_seconds >= 0),
  engagement text check (engagement in ('active', 'passive', 'away')),
  created_at timestamptz not null default now()
);

create index sessions_learner_idx on public.sessions (learner_id, created_at desc);

alter table public.sessions enable row level security;
create policy "sessions: learner reads own" on public.sessions
  for select to authenticated using (learner_id = (select auth.uid()));
revoke all on public.sessions from anon, authenticated;
grant select on public.sessions to authenticated;
grant all on public.sessions to service_role;

-- ---------------------------------------------------------------------------
-- Reward rules (§7.4). Never based on time online.
-- ---------------------------------------------------------------------------

create type public.reward_status as enum ('active', 'unlocked', 'fulfilled', 'expired');

create table public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles (id) on delete cascade,
  learner_id uuid not null references public.profiles (id) on delete cascade,
  outcomes text[] not null check (cardinality(outcomes) between 1 and 17),
  min_score numeric not null check (min_score between 0.5 and 1),
  retention_days int not null default 7 check (retention_days between 1 and 60),
  deadline date not null,
  reward_text text not null check (char_length(reward_text) between 1 and 120),
  value numeric check (value >= 0 and value <= 10000),
  currency text not null default 'CAD' check (currency in ('CAD')),
  co_set boolean not null default false,
  learner_note text check (char_length(learner_note) <= 300),
  status public.reward_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unlocked_at timestamptz,
  fulfilled_at timestamptz
);

create index reward_rules_learner_idx on public.reward_rules (learner_id);

create function public.guard_reward_rules()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  terms_changed boolean;
begin
  if exists (select 1 from unnest(new.outcomes) o where o not in (select code from public.outcomes)) then
    raise exception 'unknown outcome code in reward rule';
  end if;

  if tg_op = 'INSERT' then
    if uid is not null then
      -- A new goal starts active and waits for the learner to accept it.
      new.co_set := false;
      new.status := 'active';
      new.unlocked_at := null;
      new.fulfilled_at := null;
    end if;
    return new;
  end if;

  terms_changed := (new.outcomes, new.min_score, new.retention_days, new.deadline, new.reward_text, new.value, new.currency)
    is distinct from (old.outcomes, old.min_score, old.retention_days, old.deadline, old.reward_text, old.value, old.currency);

  if uid is null then
    null; -- service role (server code, Round 6 evaluation) may change anything
  elsif uid = old.learner_id then
    if terms_changed or (new.parent_id, new.learner_id, new.status, new.unlocked_at, new.fulfilled_at)
        is distinct from (old.parent_id, old.learner_id, old.status, old.unlocked_at, old.fulfilled_at) then
      raise exception 'a learner can only accept a goal or suggest a change';
    end if;
  elsif uid = old.parent_id then
    if (new.parent_id, new.learner_id, new.unlocked_at) is distinct from (old.parent_id, old.learner_id, old.unlocked_at) then
      raise exception 'not allowed';
    end if;
    if new.co_set and not old.co_set then
      raise exception 'only the learner can accept a goal';
    end if;
    if terms_changed then
      new.co_set := false; -- changed terms need the learner's agreement again
    end if;
    if new.status is distinct from old.status then
      if not (old.status = 'unlocked' and new.status = 'fulfilled') then
        raise exception 'a parent can only mark an unlocked reward as fulfilled';
      end if;
      new.fulfilled_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger reward_rules_guard
  before insert or update on public.reward_rules
  for each row execute function public.guard_reward_rules();

alter table public.reward_rules enable row level security;

create policy "reward_rules: parent manages own rules for linked child" on public.reward_rules
  for all to authenticated
  using (parent_id = (select auth.uid()) and public.is_parent_of(learner_id))
  with check (parent_id = (select auth.uid()) and public.is_parent_of(learner_id));
create policy "reward_rules: learner reads own" on public.reward_rules
  for select to authenticated using (learner_id = (select auth.uid()));
create policy "reward_rules: learner accepts or comments" on public.reward_rules
  for update to authenticated
  using (learner_id = (select auth.uid()))
  with check (learner_id = (select auth.uid()));

revoke all on public.reward_rules from anon, authenticated;
grant select, insert, update, delete on public.reward_rules to authenticated;
grant all on public.reward_rules to service_role;

-- ---------------------------------------------------------------------------
-- Schedules (§7.6)
-- ---------------------------------------------------------------------------

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  duration_min int not null check (duration_min between 10 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index schedules_learner_idx on public.schedules (learner_id);

create table public.schedule_change_requests (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  -- null = ask for a new slot
  schedule_id uuid references public.schedules (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_min int not null check (duration_min between 10 and 120),
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create function public.guard_schedule_requests()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if uid is not null then
      new.status := 'pending';
      new.decided_at := null;
    end if;
    if new.schedule_id is not null and not exists (
      select 1 from public.schedules s where s.id = new.schedule_id and s.learner_id = new.learner_id
    ) then
      raise exception 'schedule does not belong to this learner';
    end if;
    return new;
  end if;
  -- Parents only decide; they cannot rewrite what the learner asked for.
  if (new.learner_id, new.schedule_id, new.weekday, new.start_time, new.duration_min, new.note)
      is distinct from (old.learner_id, old.schedule_id, old.weekday, old.start_time, old.duration_min, old.note) then
    raise exception 'a change request cannot be edited';
  end if;
  if old.status <> 'pending' and uid is not null then
    raise exception 'this request was already decided';
  end if;
  new.decided_at := now();
  return new;
end;
$$;

create trigger schedule_requests_guard
  before insert or update on public.schedule_change_requests
  for each row execute function public.guard_schedule_requests();

alter table public.schedules enable row level security;
alter table public.schedule_change_requests enable row level security;

create policy "schedules: parent manages linked child" on public.schedules
  for all to authenticated
  using (public.is_parent_of(learner_id))
  with check (public.is_parent_of(learner_id));
create policy "schedules: learner reads own" on public.schedules
  for select to authenticated using (learner_id = (select auth.uid()));

create policy "schedule requests: learner asks" on public.schedule_change_requests
  for insert to authenticated with check (learner_id = (select auth.uid()));
create policy "schedule requests: learner reads own" on public.schedule_change_requests
  for select to authenticated using (learner_id = (select auth.uid()));
create policy "schedule requests: parent reads linked child" on public.schedule_change_requests
  for select to authenticated using (public.is_parent_of(learner_id));
create policy "schedule requests: parent decides" on public.schedule_change_requests
  for update to authenticated
  using (public.is_parent_of(learner_id))
  with check (public.is_parent_of(learner_id) and status in ('approved', 'declined'));

revoke all on public.schedules, public.schedule_change_requests from anon, authenticated;
grant select, insert, update, delete on public.schedules to authenticated;
grant select, insert on public.schedule_change_requests to authenticated;
grant update (status) on public.schedule_change_requests to authenticated;
grant all on public.schedules, public.schedule_change_requests to service_role;

-- ---------------------------------------------------------------------------
-- Sharing-aware views. Parents never select from base learner tables;
-- the learner reads the same views for "What my parent sees".
-- Views run with the owner's rights and filter rows themselves.
-- ---------------------------------------------------------------------------

create view public.sharing_v with (security_invoker = false) as
select s.learner_id, s.item, public.is_shared(s.learner_id, s.item) as shared, s.locked
from public.sharing_settings s
where public.can_view_learner(s.learner_id);

create view public.parent_outcome_status_v with (security_invoker = false) as
select o.learner_id, o.outcome_code, o.status, o.mastery, o.achieved_at, o.retained_at, o.updated_at
from public.outcome_status o
where public.can_view_learner(o.learner_id) and public.is_shared(o.learner_id, 'outcome_status');

create view public.parent_scores_v with (security_invoker = false) as
select a.id, a.learner_id, a.outcome_code, a.lesson_id, a.kind, a.score,
       coalesce((a.item_results ->> 'mastered')::boolean, false) as mastered, a.taken_at
from public.assessments a
where public.can_view_learner(a.learner_id) and public.is_shared(a.learner_id, 'scores');

-- Safety-flagged questions never appear here (they follow the safety rules instead).
create view public.parent_questions_v with (security_invoker = false) as
select q.id, q.learner_id, q.lesson_id, q.slide_no, q.text, q.indicator, q.created_at
from public.questions q
where q.safety_category is null
  and public.can_view_learner(q.learner_id) and public.is_shared(q.learner_id, 'question_summaries');

create view public.parent_misconceptions_v with (security_invoker = false) as
select lp.learner_id, lp.misconceptions, lp.updated_at
from public.learner_profiles lp
where public.can_view_learner(lp.learner_id) and public.is_shared(lp.learner_id, 'misconceptions');

create view public.parent_attendance_v with (security_invoker = false) as
select s.id, s.learner_id, s.scheduled_for, s.started_at, s.ended_at, s.active_seconds, s.idle_seconds, s.engagement
from public.sessions s
where public.can_view_learner(s.learner_id) and public.is_shared(s.learner_id, 'attendance');

-- Reward progress: achieved / not per goal outcome only (locked, always shared),
-- even when the learner keeps outcome status private.
create view public.parent_reward_progress_v with (security_invoker = false) as
select r.id as rule_id, r.learner_id, oc.code as outcome_code,
       coalesce(os.status in ('achieved', 'retained'), false) as achieved
from public.reward_rules r
cross join lateral unnest(r.outcomes) as oc(code)
left join public.outcome_status os on os.learner_id = r.learner_id and os.outcome_code = oc.code
where public.can_view_learner(r.learner_id) and public.is_shared(r.learner_id, 'reward_progress');

revoke all on public.sharing_v, public.parent_outcome_status_v, public.parent_scores_v, public.parent_questions_v,
  public.parent_misconceptions_v, public.parent_attendance_v, public.parent_reward_progress_v from anon, public;
grant select on public.sharing_v, public.parent_outcome_status_v, public.parent_scores_v, public.parent_questions_v,
  public.parent_misconceptions_v, public.parent_attendance_v, public.parent_reward_progress_v to authenticated;

revoke execute on function public.is_parent_of(uuid), public.can_view_learner(uuid), public.is_shared(uuid, text) from anon, public;
grant execute on function public.is_parent_of(uuid), public.can_view_learner(uuid), public.is_shared(uuid, text) to authenticated;
