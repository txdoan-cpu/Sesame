-- Round 10: generated lessons and teacher review (CLAUDE.md 7.9). Additive only;
-- the live demo (main) never reads these tables.

create table public.lessons (
  id text primary key check (id ~ '^gen-[a-z0-9-]{8,60}$'),
  outcome_code text not null references public.outcomes (code) on delete cascade,
  -- A real learner (automatic generation) or null for a teacher's sample-profile preview.
  learner_id uuid references public.profiles (id) on delete cascade,
  sample_profile text,
  -- What teachers see instead of the learner: a pseudonym and only the profile fields the lesson used.
  pseudonym text not null,
  profile_used jsonb not null default '{}'::jsonb,
  lesson jsonb,
  rationale jsonb not null default '{}'::jsonb,
  rubric_s jsonb,
  fit_score int check (fit_score between 0 and 100),
  status text not null default 'generating'
    check (status in ('generating', 'delivered', 'review', 'approved', 'rejected', 'failed')),
  attempts int not null default 0,
  error text,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((learner_id is null) <> (sample_profile is null))
);
create index lessons_learner_outcome_idx on public.lessons (learner_id, outcome_code, created_at desc);
create index lessons_status_idx on public.lessons (status, created_at desc);

create table public.lesson_reviews (
  id uuid primary key default gen_random_uuid(),
  lesson_id text not null references public.lessons (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  fit_score int,
  rubric_s jsonb,
  decision text not null check (decision in ('approve', 'revise', 'reject')),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index lesson_reviews_lesson_idx on public.lesson_reviews (lesson_id, created_at desc);

alter table public.lessons enable row level security;
alter table public.lesson_reviews enable row level security;

-- Learners read their own lessons once they may be played. Nobody else reads the base table:
-- teachers go through teacher_lessons_v, which has no learner_id.
create policy "lessons: learner reads own deliverable" on public.lessons
  for select to authenticated
  using (learner_id = (select auth.uid()) and status in ('delivered', 'approved'));
create policy "lesson_reviews: staff read" on public.lesson_reviews
  for select to authenticated using (public.is_staff());

revoke all on public.lessons, public.lesson_reviews from anon, authenticated;
grant select on public.lessons, public.lesson_reviews to authenticated;
grant all on public.lessons, public.lesson_reviews to service_role;

-- Pseudonymised view for teachers and admins (CLAUDE.md 2, 6).
create view public.teacher_lessons_v with (security_invoker = false) as
select l.id, l.outcome_code, l.pseudonym, l.sample_profile, l.profile_used, l.lesson, l.rationale,
       l.rubric_s, l.fit_score, l.status, l.attempts, l.error, l.created_at, l.updated_at
from public.lessons l
where public.is_staff();

revoke all on public.teacher_lessons_v from anon, public;
grant select on public.teacher_lessons_v to authenticated;
