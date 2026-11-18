-- Owner decision (Round 4): when a question suggests abuse, the parent is NOT
-- notified (the parent could be the source of harm). The event is recorded
-- here for a responsible adult (e.g. a school counsellor) to review.
-- No client policies: only server code (service role) can read or write.

create table public.safety_reviews (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  question_id uuid references public.questions (id) on delete set null,
  category text not null,
  lesson_id text,
  slide_no int,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_note text
);

create index safety_reviews_open_idx on public.safety_reviews (created_at desc) where reviewed_at is null;

alter table public.safety_reviews enable row level security;
revoke all on public.safety_reviews from anon, authenticated;
grant all on public.safety_reviews to service_role;
