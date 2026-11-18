# CLAUDE.md — AI Instructor demo (Grade 8 Math, St. John's, NL)

This file is the project spec for Claude Code. Read it fully before every task.
Source proposal (Vietnamese): https://claude.ai/artifact/5xvnE52GCmLRCCirzuVn2c

## 1. What we are building

A web demo of an **AI Instructor** for one Grade 8 learner and their parent ("channel 1").
It introduces the idea and basic features. It is **not** a production system and will **not**
be used with real students yet. All learner data is synthetic.

Three learner-facing solutions:
1. **Personalised lesson**: slides + spoken narration for outcome 8PR2 (linear equations),
   chosen for the learner's profile.
2. **Voice Q&A during the lesson**: the learner presses the mic button, the lesson pauses,
   Claude answers in the context of the current slide, checks understanding, then resumes.
3. **Parent portal**: outcome progress, parent-set rewards, study schedule, engagement
   (really studying vs. idle), all filtered by what the learner chooses to share.

Out of scope for this demo: school channel (teachers, school admin, LMS), automatic
barge-in (we use push-to-talk), the 6-agent lesson-generation pipeline (lesson 8PR2 is
pre-authored JSON), the Assessment Agent (we seed a sample learner profile), gift-card
purchasing, payments, native mobile apps, avatars.

## 2. Users and language

- **Learner**: Grade 8, age 13–14, St. John's. UI and lesson content in **English (Canada)**.
  Reading level around grade 6: short sentences, plain words.
- **Parent**: UI in **English with a Vietnamese toggle** (strings in `/messages/en.json`
  and `/messages/vi.json`). Outcome descriptions have a `parent_friendly` version.
- Must work on desktop, tablet and phone (responsive, touch-friendly, min tap target 44px).

## 3. Stack

- Next.js (App Router) + TypeScript (strict) + Tailwind CSS
- Supabase: Postgres, Auth, Row Level Security. Project region: Canada.
- Claude API via `@anthropic-ai/sdk`, **server-side only** (route handlers in `app/api/**`).
  All model calls go through `lib/llm/index.ts`, which picks the provider from `LLM_PROVIDER`
  so Gemini can stand in temporarily if no Claude key is available yet (synthetic data only).
  Default model: `claude-sonnet-5-5` (set in env `ANTHROPIC_MODEL`; verify current model
  names at https://docs.claude.com before changing).
- Voice: browser Web Speech API (`speechSynthesis` for narration, `SpeechRecognition`
  for questions). If unsupported (e.g. iOS Safari), show text and a typed-question box.
- Math: KaTeX for rendering, mathjs for checking answers by substitution.
- Email: Resend (or Supabase email) for parent notifications; in-app notifications first.
- Tests: Vitest (unit), Playwright (end-to-end). Hosting: Vercel.

## 4. Commands

```
npm run dev        # local dev server
npm run build      # production build — must pass before a round is "done"
npm run lint
npm run test       # Vitest
npm run test:e2e   # Playwright
npx supabase db push --remote   # apply migrations to the linked Supabase cloud project (newer CLI targets local Docker without --remote)
```

Environment variables (never commit; list them in `.env.example`):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(server only), `ANTHROPIC_API_KEY` (server only), `ANTHROPIC_MODEL`, `LLM_PROVIDER`
(`claude` default, or `gemini`), `GEMINI_API_KEY` (server only, optional fallback), `RESEND_API_KEY`.
The owner types keys into `.env.local` themselves. Never ask for a key in chat and never print one.

## 5. Project structure

```
app/
  (auth)/login, (auth)/signup          parent sign-up / login, learner login
  learner/                              learner home, lesson player, sharing settings
  parent/                               dashboard, rewards, schedule, notifications
  api/ask/route.ts                      voice/typed question -> Claude
  api/session/route.ts                  session start/heartbeat/end, engagement events
  api/health/claude/route.ts            Round 0 smoke test: sends one short prompt, returns {ok, model, reply}
lib/
  supabase/ (client.ts, server.ts)
  llm/ (index.ts provider switch, claude.ts, gemini.ts, prompts.ts, safety.ts)
  math/check.ts                         mathjs substitution checks
  engagement.ts                         idle detection logic
  rewards.ts                            reward-rule evaluation
  sharing.ts                            sharing rules (single source of truth)
content/lessons/8PR2-demo-A.json        pre-authored lesson (slides, narration, checkpoints)
supabase/migrations/, supabase/seed.sql
messages/en.json, messages/vi.json
tests/
```

## 6. Data model (Supabase / Postgres)

| Table | Key columns | Notes |
| --- | --- | --- |
| profiles | id (= auth.users.id), role ('parent' \| 'learner'), display_name | |
| family_links | parent_id, learner_id, relationship | Allow many parents per learner later |
| outcomes | code ('8PR2'), strand, description_en, description_vi, parent_friendly | 17 NL Grade 8 outcomes (Appendix A) |
| indicators | code ('PR2.1'), outcome_code, description | |
| misconceptions | code ('M2'), outcome_code, description | |
| learner_profiles | learner_id, mastery jsonb, misconceptions text[], affect jsonb, reading_level, interests text[], confidence numeric, updated_at | Same shape as future Assessment Agent output (see §9) |
| lessons | id, outcome_code, learner_id, slides jsonb, rationale jsonb, fit_score int | |
| sessions | id, learner_id, lesson_id, scheduled_for, started_at, ended_at, active_seconds, idle_seconds, engagement ('active' \| 'passive' \| 'away') | |
| events | id, session_id, type, payload jsonb, created_at | types: checkpoint_answer, question, idle_start, idle_end, tab_hidden, tab_visible, resume |
| questions | id, session_id, slide_no, text, answer, indicator, misconception, helpful bool | |
| assessments | id, learner_id, outcome_code, kind ('exit' \| 'retention'), score numeric, item_results jsonb, taken_at | |
| outcome_status | learner_id, outcome_code, status, mastery, achieved_at, retained_at | status: not_started, learning (<0.60), nearly (0.60–0.79), achieved (>=0.80), retained (>=0.80 again after >=14 days) |
| reward_rules | id, parent_id, learner_id, outcomes text[], min_score, retention_days, deadline, reward_text, value, currency, co_set bool, status ('active' \| 'unlocked' \| 'fulfilled' \| 'expired') | |
| schedules | id, learner_id, weekday, start_time, duration_min, active | |
| sharing_settings | learner_id, item, shared bool, locked bool | see §7.3 |
| notifications | id, recipient_id, type, payload jsonb, read_at | |

### Row Level Security (required, with tests)
- A learner reads/writes only their own rows.
- A parent reads a linked learner's data **only through SQL views that apply
  `sharing_settings`** (e.g. `parent_outcome_status_v`, `parent_questions_v`). Parents never
  select from base learner tables directly.
- Parents write `reward_rules`, `schedules`; learners write `sharing_settings` where
  `locked = false`.
- Service-role key is used only in server code, never in the browser.

## 7. Domain rules (do not change without asking)

### 7.1 Lesson player
- Lesson = JSON array of slides: `{ no, title, body_md, narration, visual, checkpoint? }`.
- Narration plays per slide; slide text must not just repeat narration.
- A checkpoint appears every 2–3 minutes; the learner answers by voice or tap/typing.
- Exit ticket at the end: 3 multiple-choice items with diagnostic distractors (each wrong
  option maps to a misconception code) + 1 "explain in your own words" item.
- On finish: write `assessments`, update `outcome_status` and `learner_profiles.mastery`.

### 7.2 Voice Q&A (`/api/ask`)
- Mic press: stop narration immediately, save position, listen.
- Send to Claude: current slide (title, body, narration), lesson outcome and indicators,
  learner profile (reading level, interests, misconceptions), last 3 Q&A turns.
- Answer rules (put in the system prompt, `lib/llm/prompts.ts`):
  - Max ~80 words, grade-6 reading level, Canadian English, warm and encouraging.
  - Clarify the current step; if "I don't get it", switch representation (balance scale,
    algebra tiles) and break into smaller steps.
  - Never give the final answer to an exit-ticket item; give a hint instead.
  - Off-topic: answer briefly and kindly, return to the lesson.
  - End with one short check question, then the UI offers "Continue lesson".
- Any numeric result Claude states about an equation must be checked with `lib/math/check.ts`
  before it is shown or spoken; if the check fails, show a safe fallback and log it.
- Tag each question with indicator and misconception (ask Claude for JSON tags in a
  separate small call, or in the same call with a structured section; parse safely).
- **Safety**: if the question suggests self-harm, abuse, bullying or danger, do not continue
  the lesson; show a calm, supportive message and a "talk to a trusted adult" prompt, create a
  `safety` notification for the parent (locked, always shared). Keep this logic in
  `lib/llm/safety.ts` and cover it with tests. Do not store raw audio, only text.

### 7.3 Sharing (learner controls) — single source of truth in `lib/sharing.ts`
| item | default shared | locked (learner cannot turn off) |
| --- | --- | --- |
| attendance (studied on schedule, active time, idle alerts) | yes | yes |
| safety_alerts | yes | yes |
| reward_progress (achieved / not, % progress only) | yes | yes |
| outcome_status | yes | no |
| scores (lesson scores, exit tickets) | yes | no |
| question_summaries | no | no |
| misconceptions | no | no |

When an item is not shared, the parent UI shows "Your child is keeping this private"
instead of data. The learner sees exactly what the parent sees on a "What my parent sees" page.

### 7.4 Rewards (`lib/rewards.ts`)
- Parent creates a rule: outcomes, min_score, retention_days (default 7), deadline,
  reward text and value (e.g. 50 CAD). Learner co-sets (accepts/edits the goal) → `co_set`.
- Unlock only when every listed outcome is `achieved` with score >= min_score **and** a
  retention check taken >= retention_days later is also >= min_score.
- Milestones notify both sides. On unlock, notify the parent with a suggested specific
  praise sentence. Parent marks "fulfilled". No payments, no gift-card purchase in the demo.
- Warn the parent when a goal is very unlikely to be met before the deadline.
- Rewards are never based on minutes online.

### 7.5 Engagement (`lib/engagement.ts`)
- Count active time only while the tab is visible and the learner has interacted within
  the last 60 s or is listening to narration that started after their last interaction.
- No response to a checkpoint for 60 s → pause lesson, speak "Are you still there?".
- Away > 5 min during a scheduled session → `idle` notification to parent.
- Session engagement: active (>= 80% active), passive (50–79%), away (< 50%).
- No camera, no continuous microphone recording.

### 7.6 Schedule
- Parent sets weekly slots. Learner can request a change (parent approves).
- Missed session → notify parent and propose a make-up slot.

## 8. Build rounds (do one round at a time; stop and report at the end of each)

| Round | Scope | Done when |
| --- | --- | --- |
| 0 Setup | Repo, Next.js, Tailwind, Supabase cloud project, `.env.example`, deploy blank page; Claude API smoke test route `/api/health/claude` + page `/health` | Vercel URL loads (deploy can wait until the owner has a Vercel account); `/health` shows a short reply from Claude, **or** a clear "API key not set yet" message when no key exists — both pass; `npm run build` passes |
| 1 Accounts | Parent sign-up/login; parent creates learner account (username + password); family link; RLS | E2E test: learner sees only own data; parent sees only linked child |
| 2 Curriculum data | Migrations + seed from Appendix A: 17 outcomes (4 strands), 8PR2 indicators PR2.1–PR2.6, misconceptions M1–M5, sample profile demo-A (§9) | Outcome board renders grouped by strand |
| 3 Lesson player | Write and load `content/lessons/8PR2-demo-A.json` from Appendix B (9 slides), narration, checkpoints, exit ticket, save results | Finishing the lesson updates outcome_status and mastery (test) |
| 4 Voice Q&A | Mic button, `/api/ask`, spoken answer, resume, question tagging, math check, safety | 9/10 scripted test questions answered in slide context; 0 math errors; safety test passes |
| 5 Parent portal | Dashboard, reward rules, schedule, learner sharing settings, "What my parent sees", parent resets a linked child's password (learners have no email) | Sharing tests pass for every item in §7.3 |
| 6 Engagement & notifications | Sessions, idle detection, alerts, weekly summary, reward evaluation | Demo scenarios B (reward) and C (idle) run end to end |
| 7 Polish | Responsive check on phone/tablet/desktop, demo accounts, demo script in `DEMO.md` | All demo targets in the proposal's roadmap table met |

Round 0 smoke test details: `GET /api/health/claude` calls Claude with the prompt
"Reply with exactly: Claude API connected." and `max_tokens` 50, returns
`{ok: true, model, reply}` or `{ok: false, error}` with a readable message (missing key,
invalid key, no credit, network). The `/health` page shows the result. Never log or return the key.

At the end of each round: run lint, unit and e2e tests, `npm run build`, then summarise
what changed, what to test manually, and any open question. Do not start the next round
until the owner approves.

## 9. Learner profile schema (contract with the future Assessment Agent)

```json
{
  "learner_id": "demo-A",
  "grade": 8,
  "school_context": "St. John's, NL (English program)",
  "target_outcome": "8PR2",
  "mastery": {"8PR2.one_step": 0.85, "8PR2.two_step": 0.45, "8PR2.distributive": 0.20, "8N7.integers": 0.70},
  "misconceptions": ["M2", "M3"],
  "affect": {"math_anxiety": "moderate", "confidence_self_report": 2},
  "reading_level": "grade 6",
  "language": {"primary": "English", "ell": false},
  "accessibility": [],
  "interests": ["hockey", "video games"],
  "evidence": ["diagnostic_quiz_2026-10-15", "homework_set_12"],
  "confidence_of_estimate": 0.7
}
```
Validate with zod at every boundary. If `confidence_of_estimate < 0.6`, the lesson starts
with 3–4 short diagnostic questions.

## 10. Conventions

- TypeScript strict; no `any` without a comment explaining why.
- Validate all API input/output with zod. Parse Claude JSON defensively (strip code fences,
  catch errors, fall back gracefully).
- All user-facing strings in `/messages`. Learner strings in English; parent strings EN + VI.
- Accessibility: semantic HTML, keyboard navigable, captions/text always shown alongside
  speech, colour contrast AA.
- Small, focused commits with clear messages. Never commit secrets.
- Prefer existing libraries over custom code for auth, validation, dates (date-fns), math.

## 11. Do not

- Do not call the Claude API from the browser or expose any key client-side.
- Do not store raw audio or video. Do not use the camera.
- Do not let parents bypass sharing views. Do not let learners unlock `locked` items.
- Do not base rewards on time spent.
- Do not add real student data. Do not add payments or gift-card purchases yet.
- Do not use "learning styles" (visual/auditory) to adapt content.
- Do not change the rules in §7 without asking the owner first.

## 12. No API key yet

Rounds 0–3 must not depend on any LLM key. Code that needs a model (Round 4 on) must check
for the key and show a friendly "AI not connected yet" state instead of crashing.

## Appendix A — NL Grade 8 Mathematics outcomes (17)

Paraphrased from the NL curriculum (source: https://ca.ixl.com/standards/newfoundland-and-labrador/math/grade-8).
Write `parent_friendly` (EN) and `description_vi` versions in plain language when seeding.

| Code | Strand | Outcome (short) |
| --- | --- | --- |
| 8N1 | Number | Understand perfect squares and square roots, concretely, pictorially and symbolically (whole numbers) |
| 8N2 | Number | Estimate square roots of whole numbers that are not perfect squares |
| 8N3 | Number | Understand percents greater than or equal to 0% (including over 100%) |
| 8N4 | Number | Understand ratio and rate |
| 8N5 | Number | Solve problems involving rates, ratios and proportional reasoning |
| 8N6 | Number | Multiply and divide positive fractions and mixed numbers, concretely, pictorially and symbolically |
| 8N7 | Number | Multiply and divide integers, concretely, pictorially and symbolically |
| 8PR1 | Patterns and Relations | Graph and analyse two-variable linear relations |
| 8PR2 | Patterns and Relations | Model and solve problems with linear equations ax = b, x/a = b, ax + b = c, x/a + b = c, a(x + b) = c (a, b, c integers, a ≠ 0) |
| 8SS1 | Shape and Space | Develop and apply the Pythagorean theorem to solve problems |
| 8SS2 | Shape and Space | Draw and construct nets for 3-D objects |
| 8SS3 | Shape and Space | Find the surface area of right rectangular prisms, right triangular prisms and right cylinders |
| 8SS4 | Shape and Space | Develop and apply volume formulas for right prisms and right cylinders |
| 8SS5 | Shape and Space | Draw and interpret top, front and side views of 3-D objects made of right rectangular prisms |
| 8SS6 | Shape and Space | Understand tessellation: properties, creating tessellations, finding them in the environment |
| 8SP1 | Statistics and Probability | Critique ways in which data is presented |
| 8SP2 | Statistics and Probability | Solve problems involving the probability of independent events |

8PR2 indicators:
- PR2.1 Model a problem with concrete or pictorial representations (balance scale, algebra tiles) and record it symbolically.
- PR2.2 Verify a solution by substitution.
- PR2.3 Solve each equation form using inverse operations, keeping the equation balanced.
- PR2.4 Apply the distributive property to solve a(x + b) = c.
- PR2.5 Identify and correct an error in a given solution.
- PR2.6 Write and solve an equation for a real-world problem and explain the solution in context.

8PR2 misconceptions:
- M1 Operates on one side of the equation only.
- M2 Distributes wrongly: a(x + b) = ax + b.
- M3 Sign errors when moving negative numbers.
- M4 Solves ax + b = c by dividing before subtracting.
- M5 Reads "=" as "the answer is" instead of "balanced".

## Appendix B — Lesson 8PR2-demo-A (about 15 minutes, 9 slides)

Learner demo-A (profile in §9): one-step mastered, two-step and distributive weak, misconceptions M2
and M3, moderate math anxiety, likes hockey, grade-6 reading level. Narration: short sentences,
warm, Canadian English. Slide text must not repeat narration word for word.

| # | Slide | Method | Checkpoint / notes |
| --- | --- | --- | --- |
| 1 | Warm-up: 2 one-step equations (e.g. 4x = 20, x + 7 = 12) | Retrieval, early win | Learner answers both |
| 2 | Balance scale: "=" means balanced; same action on both sides | Concrete (CRA), targets M5 | "What happens if we add 2 to only one side?" |
| 3 | Worked example: skate rental $4 + $3 per hour, paid $19 → 3x + 4 = 19, x = 5 | Worked example, hockey context | — |
| 4 | Faded example: 5x − 7 = 18, learner fills the missing step (x = 5) | Faded example | Fill the missing step |
| 5 | Algebra tiles for 2(x + 3) = 14 → 2x + 6 = 14, x = 4 | Pictorial, PR2.4 | Count the 1-tiles |
| 6 | "Who's right?" Two students solve 2(x + 3) = 14; one writes 2x + 3 | Cognitive conflict, M2, PR2.5 | Pick the correct student and say why |
| 7 | Negatives: −3x + 5 = −10 → −3x = −15, x = 5 | Worked example, M3 | Check by substitution (PR2.2) |
| 8 | 3 practice items with tiered hints (e.g. 2x + 9 = 1; x/3 + 4 = 6; 4(x − 2) = 12) | Supported practice | Answers: x = −4, x = 6, x = 5 |
| 9 | Exit ticket: 3 multiple-choice items with diagnostic distractors (each wrong option maps to M1–M5) + 1 "explain in your own words" item | Formative, ungraded | Mastery threshold: ≥ 80% and explains "keep it balanced" |

Narration example for slide 3: "Picture your local rink here in St. John's. Skate rental is four
dollars, plus three dollars for every hour. You paid nineteen dollars. How many hours did you
skate? Let's turn that story into a balance. On one side: three x plus four. On the other: nineteen."

Every equation and answer in this lesson must pass `lib/math/check.ts` (substitution) in a unit test.
