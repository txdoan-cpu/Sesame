-- Round 3: exit-ticket and retention results.

create type public.assessment_kind as enum ('exit', 'retention');

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  outcome_code text not null references public.outcomes (code),
  lesson_id text,
  kind public.assessment_kind not null,
  score numeric not null check (score between 0 and 1),
  -- Per-item results, incl. the misconception behind each wrong choice and
  -- whether the explanation mentioned keeping the equation balanced.
  item_results jsonb not null default '{}'::jsonb,
  taken_at timestamptz not null default now()
);

create index assessments_learner_outcome_idx on public.assessments (learner_id, outcome_code, taken_at desc);

alter table public.assessments enable row level security;

create policy "assessments: learner reads own" on public.assessments
  for select to authenticated using (learner_id = (select auth.uid()));

revoke all on public.assessments from anon, authenticated;
grant select on public.assessments to authenticated;
grant all on public.assessments to service_role;
