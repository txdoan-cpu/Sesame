-- Round 2: curriculum reference data (NL Grade 8 Mathematics), learner
-- profiles (§9 contract) and outcome status. Synthetic demo data only.

-- ---------------------------------------------------------------------------
-- Curriculum tables (reference data, read-only for signed-in users)
-- ---------------------------------------------------------------------------

create table public.strands (
  code text primary key,
  name_en text not null,
  name_vi text not null,
  sort_order int not null unique
);

create table public.outcomes (
  code text primary key check (code ~ '^8(N|PR|SS|SP)[0-9]+$'),
  strand text not null references public.strands (code),
  sort_order int not null unique,
  description_en text not null,
  description_vi text not null,
  parent_friendly text not null
);

create table public.indicators (
  code text primary key,
  outcome_code text not null references public.outcomes (code),
  description text not null
);

create table public.misconceptions (
  code text primary key,
  outcome_code text not null references public.outcomes (code),
  description text not null,
  description_vi text not null
);

create index indicators_outcome_code_idx on public.indicators (outcome_code);
create index misconceptions_outcome_code_idx on public.misconceptions (outcome_code);

alter table public.strands enable row level security;
alter table public.outcomes enable row level security;
alter table public.indicators enable row level security;
alter table public.misconceptions enable row level security;

create policy "strands: readable when signed in" on public.strands for select to authenticated using (true);
create policy "outcomes: readable when signed in" on public.outcomes for select to authenticated using (true);
create policy "indicators: readable when signed in" on public.indicators for select to authenticated using (true);
create policy "misconceptions: readable when signed in" on public.misconceptions for select to authenticated using (true);

revoke all on public.strands, public.outcomes, public.indicators, public.misconceptions from anon, authenticated;
grant select on public.strands, public.outcomes, public.indicators, public.misconceptions to authenticated;
grant all on public.strands, public.outcomes, public.indicators, public.misconceptions to service_role;

-- ---------------------------------------------------------------------------
-- Learner profile: same shape as the future Assessment Agent output (§9).
-- ---------------------------------------------------------------------------

create table public.learner_profiles (
  learner_id uuid primary key references public.profiles (id) on delete cascade,
  grade int not null default 8,
  school_context text,
  target_outcome text references public.outcomes (code),
  mastery jsonb not null default '{}'::jsonb,
  misconceptions text[] not null default '{}',
  affect jsonb not null default '{}'::jsonb,
  reading_level text,
  language jsonb not null default '{}'::jsonb,
  accessibility text[] not null default '{}',
  interests text[] not null default '{}',
  evidence text[] not null default '{}',
  confidence numeric not null default 0 check (confidence between 0 and 1),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Outcome status per learner (written by the lesson player from Round 3).
-- ---------------------------------------------------------------------------

create type public.outcome_status_kind as enum ('not_started', 'learning', 'nearly', 'achieved', 'retained');

create table public.outcome_status (
  learner_id uuid not null references public.profiles (id) on delete cascade,
  outcome_code text not null references public.outcomes (code),
  status public.outcome_status_kind not null default 'not_started',
  mastery numeric check (mastery between 0 and 1),
  achieved_at timestamptz,
  retained_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (learner_id, outcome_code)
);

-- Learners read their own rows. Writes go through server code.
-- Parents get these through sharing-aware views in Round 5, never directly.
alter table public.learner_profiles enable row level security;
alter table public.outcome_status enable row level security;

create policy "learner_profiles: learner reads own" on public.learner_profiles
  for select to authenticated using (learner_id = (select auth.uid()));
create policy "outcome_status: learner reads own" on public.outcome_status
  for select to authenticated using (learner_id = (select auth.uid()));

revoke all on public.learner_profiles, public.outcome_status from anon, authenticated;
grant select on public.learner_profiles, public.outcome_status to authenticated;
grant all on public.learner_profiles, public.outcome_status to service_role;

-- ---------------------------------------------------------------------------
-- Seed: strands and the 17 NL Grade 8 outcomes (Appendix A, paraphrased).
-- ---------------------------------------------------------------------------

insert into public.strands (code, name_en, name_vi, sort_order) values
  ('N',  'Number',                     'Số',                      1),
  ('PR', 'Patterns and Relations',     'Quy luật và quan hệ',     2),
  ('SS', 'Shape and Space',            'Hình học và không gian',  3),
  ('SP', 'Statistics and Probability', 'Thống kê và xác suất',    4);

insert into public.outcomes (code, strand, sort_order, description_en, description_vi, parent_friendly) values
  ('8N1', 'N', 1,
   'Understand perfect squares and square roots, concretely, pictorially and symbolically (whole numbers).',
   'Hiểu số chính phương và căn bậc hai của số nguyên, bằng đồ vật, hình vẽ và ký hiệu.',
   'Knows square numbers like 49 = 7 × 7, and that the square root of 49 is 7.'),
  ('8N2', 'N', 2,
   'Estimate square roots of whole numbers that are not perfect squares.',
   'Ước lượng căn bậc hai của số không phải số chính phương (ví dụ: căn 50 gần bằng 7,1).',
   'Can estimate a square root that is not a whole number, like √50 is a bit more than 7.'),
  ('8N3', 'N', 3,
   'Understand percents greater than or equal to 0% (including over 100%).',
   'Hiểu phần trăm từ 0% trở lên, kể cả trên 100%.',
   'Understands percents, including ones over 100%, like a price that went up 150%.'),
  ('8N4', 'N', 4,
   'Understand ratio and rate.',
   'Hiểu tỉ số và tỉ suất (ví dụ: 3 phần nước cho 1 phần nước cam, 60 km mỗi giờ).',
   'Understands ratios (3 cups water to 1 cup juice) and rates (60 km per hour).'),
  ('8N5', 'N', 5,
   'Solve problems involving rates, ratios and proportional reasoning.',
   'Giải bài toán về tỉ số, tỉ suất và tỉ lệ thuận.',
   'Uses ratios and rates to solve real problems, like finding the better buy.'),
  ('8N6', 'N', 6,
   'Multiply and divide positive fractions and mixed numbers, concretely, pictorially and symbolically.',
   'Nhân và chia phân số dương và hỗn số.',
   'Multiplies and divides fractions and mixed numbers, like 1½ × ⅔.'),
  ('8N7', 'N', 7,
   'Multiply and divide integers, concretely, pictorially and symbolically.',
   'Nhân và chia số nguyên, kể cả số âm.',
   'Multiplies and divides positive and negative whole numbers, like (−3) × 4 = −12.'),
  ('8PR1', 'PR', 8,
   'Graph and analyse two-variable linear relations.',
   'Vẽ và phân tích đồ thị của quan hệ tuyến tính hai biến.',
   'Makes and reads graphs of straight-line patterns, like cost going up by the same amount each hour.'),
  ('8PR2', 'PR', 9,
   'Model and solve problems with linear equations ax = b, x/a = b, ax + b = c, x/a + b = c, a(x + b) = c (a, b, c integers, a ≠ 0).',
   'Giải phương trình bậc nhất như 3x + 4 = 19 hoặc 2(x + 3) = 14, và dùng chúng để giải bài toán thực tế.',
   'Solves equations like 3x + 4 = 19 by keeping both sides balanced, and uses them for real problems.'),
  ('8SS1', 'SS', 10,
   'Develop and apply the Pythagorean theorem to solve problems.',
   'Hiểu và dùng định lý Pythagore để giải bài toán.',
   'Uses the Pythagorean theorem to find a missing side of a right triangle.'),
  ('8SS2', 'SS', 11,
   'Draw and construct nets for 3-D objects.',
   'Vẽ và dựng hình khai triển (net) của vật thể 3 chiều.',
   'Draws the flat pattern (net) that folds up into a 3-D shape like a box.'),
  ('8SS3', 'SS', 12,
   'Find the surface area of right rectangular prisms, right triangular prisms and right cylinders.',
   'Tính diện tích bề mặt của hình hộp chữ nhật, lăng trụ tam giác và hình trụ.',
   'Finds the total outside area of boxes, triangular prisms and cylinders.'),
  ('8SS4', 'SS', 13,
   'Develop and apply volume formulas for right prisms and right cylinders.',
   'Hiểu và dùng công thức thể tích của hình lăng trụ đứng và hình trụ.',
   'Finds how much a prism or a cylinder holds (its volume).'),
  ('8SS5', 'SS', 14,
   'Draw and interpret top, front and side views of 3-D objects made of right rectangular prisms.',
   'Vẽ và đọc hình chiếu từ trên, từ trước và từ bên của vật thể 3 chiều.',
   'Draws and reads top, front and side views of shapes built from blocks.'),
  ('8SS6', 'SS', 15,
   'Understand tessellation: properties, creating tessellations, finding them in the environment.',
   'Hiểu về lát phẳng (tessellation): tính chất, cách tạo và tìm trong đời sống.',
   'Understands tiling patterns with no gaps or overlaps, like floor tiles.'),
  ('8SP1', 'SP', 16,
   'Critique ways in which data is presented.',
   'Đánh giá cách trình bày dữ liệu, ví dụ biểu đồ có gây hiểu lầm hay không.',
   'Can spot when a graph or chart is misleading.'),
  ('8SP2', 'SP', 17,
   'Solve problems involving the probability of independent events.',
   'Giải bài toán xác suất của các sự kiện độc lập.',
   'Finds the chance of two separate things both happening, like two coin flips both landing heads.');

insert into public.indicators (code, outcome_code, description) values
  ('PR2.1', '8PR2', 'Model a problem with concrete or pictorial representations (balance scale, algebra tiles) and record it symbolically.'),
  ('PR2.2', '8PR2', 'Verify a solution by substitution.'),
  ('PR2.3', '8PR2', 'Solve each equation form using inverse operations, keeping the equation balanced.'),
  ('PR2.4', '8PR2', 'Apply the distributive property to solve a(x + b) = c.'),
  ('PR2.5', '8PR2', 'Identify and correct an error in a given solution.'),
  ('PR2.6', '8PR2', 'Write and solve an equation for a real-world problem and explain the solution in context.');

insert into public.misconceptions (code, outcome_code, description, description_vi) values
  ('M1', '8PR2', 'Operates on one side of the equation only.',
   'Chỉ làm phép tính ở một vế của phương trình.'),
  ('M2', '8PR2', 'Distributes wrongly: a(x + b) = ax + b.',
   'Nhân phân phối sai: a(x + b) = ax + b.'),
  ('M3', '8PR2', 'Sign errors when moving negative numbers.',
   'Sai dấu khi chuyển số âm.'),
  ('M4', '8PR2', 'Solves ax + b = c by dividing before subtracting.',
   'Giải ax + b = c bằng cách chia trước rồi mới trừ.'),
  ('M5', '8PR2', 'Reads "=" as "the answer is" instead of "balanced".',
   'Hiểu dấu "=" là "kết quả là" thay vì "hai bên cân bằng".');
