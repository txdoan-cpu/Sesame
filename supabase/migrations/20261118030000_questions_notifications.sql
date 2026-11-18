-- Round 4: learner questions (text only, never audio) and notifications.

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  -- sessions arrive in Round 6; link then.
  session_id uuid,
  lesson_id text,
  slide_no int,
  text text not null check (char_length(text) between 1 and 500),
  answer text,
  indicator text,
  misconception text,
  helpful boolean,
  safety_category text,
  -- true when the model answer failed a check and a safe fallback was shown
  fallback boolean not null default false,
  provider text,
  created_at timestamptz not null default now()
);

create index questions_learner_idx on public.questions (learner_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  -- safety, idle, milestone, reward_unlocked, missed_session, weekly_summary, ...
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

alter table public.questions enable row level security;
alter table public.notifications enable row level security;

-- Learners read their own questions. Parents see question summaries only
-- through sharing-aware views (Round 5); default is private.
create policy "questions: learner reads own" on public.questions
  for select to authenticated using (learner_id = (select auth.uid()));

-- Each user reads their own notifications and may mark them read.
create policy "notifications: recipient reads own" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy "notifications: recipient marks read" on public.notifications
  for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

revoke all on public.questions, public.notifications from anon, authenticated;
grant select on public.questions to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.questions, public.notifications to service_role;
