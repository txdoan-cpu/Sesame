-- Round 9: automatic learner model (CLAUDE.md 7.8). Additive only: the live
-- demo (main) does not read or write these tables or columns.

-- BKT state per learner per skill ("8PR2.two_step", "8N7.integers", ...).
create table public.knowledge_state (
  learner_id uuid not null references public.profiles (id) on delete cascade,
  skill_id text not null check (skill_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  p_init numeric not null check (p_init between 0 and 1),
  p_mastery numeric not null check (p_mastery between 0 and 1),
  p_transit numeric not null check (p_transit between 0 and 1),
  p_slip numeric not null check (p_slip between 0 and 1),
  p_guess numeric not null check (p_guess between 0 and 1),
  attempts int not null default 0 check (attempts >= 0),
  correct int not null default 0 check (correct >= 0),
  updated_at timestamptz not null default now(),
  primary key (learner_id, skill_id)
);

-- Every scored answer, in order (needed to re-estimate the learning rate).
create table public.skill_answers (
  id bigint generated always as identity primary key,
  learner_id uuid not null references public.profiles (id) on delete cascade,
  skill_id text not null,
  correct boolean not null,
  source text not null check (source in ('checkpoint', 'diagnostic', 'exit', 'retention')),
  lesson_id text,
  item_id text,
  created_at timestamptz not null default now()
);
create index skill_answers_learner_idx on public.skill_answers (learner_id, id);

alter table public.learner_profiles
  add column if not exists readiness numeric check (readiness between 0 and 1),
  add column if not exists learning_rate jsonb not null default '{}'::jsonb;

-- Learners read their own rows; only server code writes. Parents and teachers
-- never read these tables (parents see outcome status through the sharing views).
alter table public.knowledge_state enable row level security;
alter table public.skill_answers enable row level security;

create policy "knowledge_state: learner reads own" on public.knowledge_state
  for select to authenticated using (learner_id = (select auth.uid()));
create policy "skill_answers: learner reads own" on public.skill_answers
  for select to authenticated using (learner_id = (select auth.uid()));

revoke all on public.knowledge_state, public.skill_answers from anon, authenticated;
grant select on public.knowledge_state, public.skill_answers to authenticated;
grant all on public.knowledge_state, public.skill_answers to service_role;

-- readiness = mean mastery of the LO's prerequisites. For 8PR2 these are the
-- one-step and integer skills from the demo profile (CLAUDE.md 9). Only fills
-- the column if nobody set it yet; learners and parents never read it.
update public.outcomes
  set prerequisites = array['8PR2.one_step', '8N7.integers']
  where code = '8PR2' and prerequisites = '{}';
