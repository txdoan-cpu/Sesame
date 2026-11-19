-- Round 6: engagement tracking, events, reward evaluation support.

-- Sessions: link to the schedule slot and keep what the away check needs.
alter table public.sessions
  add column schedule_id uuid references public.schedules (id) on delete set null,
  add column last_heartbeat_at timestamptz,
  add column slide_no int,
  add column paused_at timestamptz,
  add column away_alert_sent_at timestamptz;

create index sessions_open_idx on public.sessions (last_heartbeat_at) where ended_at is null;

-- Learning events (xAPI style). Text only, never audio.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  learner_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'checkpoint_answer', 'question', 'idle_start', 'idle_end', 'tab_hidden', 'tab_visible', 'resume', 'paused'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_session_idx on public.events (session_id, created_at);

alter table public.events enable row level security;
create policy "events: learner reads own" on public.events
  for select to authenticated using (learner_id = (select auth.uid()));
revoke all on public.events from anon, authenticated;
grant select on public.events to authenticated;
grant all on public.events to service_role;

-- Reward rules: remember the mistakes the learner had when the goal was set
-- (for a specific praise sentence on unlock) and which milestones were sent.
alter table public.reward_rules
  add column misconceptions_at_start text[] not null default '{}',
  add column milestones_notified text[] not null default '{}';

-- Runs as owner: the parent cannot read learner_profiles, but the snapshot is
-- only used by server code to suggest praise.
create function public.snapshot_reward_misconceptions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.misconceptions_at_start := coalesce(
    (select lp.misconceptions from public.learner_profiles lp where lp.learner_id = new.learner_id),
    '{}'
  );
  new.milestones_notified := '{}';
  return new;
end;
$$;

create trigger reward_rules_snapshot
  before insert on public.reward_rules
  for each row execute function public.snapshot_reward_misconceptions();

-- Parents and learners must not edit these server-only columns.
create function public.guard_reward_server_columns()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (
       new.misconceptions_at_start is distinct from old.misconceptions_at_start
       or new.milestones_notified is distinct from old.milestones_notified) then
    raise exception 'not allowed';
  end if;
  return new;
end;
$$;

create trigger reward_rules_server_columns
  before update on public.reward_rules
  for each row execute function public.guard_reward_server_columns();

-- Learners may mark their own notifications read (milestones, rewards).
-- The existing "recipient marks read" policy already covers any recipient.
