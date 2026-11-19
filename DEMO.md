# Sesame demo script

How to run and present the AI Instructor demo (Grade 8 Math, St. John's, NL).

**Live demo:** https://sesame-seven-chi.vercel.app (Vercel, deployed from `main` on GitHub; every push to `main` redeploys).
All accounts, profiles and answers are **synthetic**. Never use real student data, especially with the free Gemini key.

About 25 minutes in total: tour 3 min, scenario A 5 min, scenario B 7 min, scenario C 8 min (mostly waiting), sharing 2 min.

---

## 1. Before the demo (10 minutes, the day before)

1. `.env.local` has the Supabase keys, `DEMO_PASSWORD`, `CRON_SECRET`, and an LLM:
   - `LLM_PROVIDER=claude` with `ANTHROPIC_API_KEY` (access via Aidan or Kristen), or
   - `LLM_PROVIDER=gemini` with `GEMINI_API_KEY` (free tier, synthetic data only), or
   - `LLM_PROVIDER=mock` to run without internet (answers are canned).
2. Reset the demo family: `npm run demo:reset`.
3. Start the app: `npm run build` then `npm run start` (or `npm run dev`). Open http://localhost:3000/health and check the AI is connected.
4. Use **Chrome or Edge** for voice. Allow the microphone when asked. Turn the sound on.
5. Open two windows side by side:
   - **Parent**: a normal window, logged in as the parent.
   - **Learner**: a private window (Ctrl+Shift+N), logged in as Alex.

### Accounts

| Who | Log in at | Name | Password |
| --- | --- | --- | --- |
| Parent | **Parents** box | `parent.demo@example.com` | `DEMO_PASSWORD` in `.env.local` |
| Learner (Alex, profile demo-A) | **Students** box | `demo_a` | same |

After `demo:reset`, Alex has: 8PR2 *learning*, 8N7 *nearly there*, misconceptions M2 and M3, likes hockey; study times Mon and Wed 19:00, Sat 10:00 (30 min); one reward goal from the parent: 8PR1 + 8PR2, 85%, re-check after 7 days, 50 CAD, waiting for Alex to accept.

---

## 2. Quick tour (3 min)

1. **Parent**: dashboard → **Open Alex's page**. Show the tabs Progress, Rewards, Schedule, Account.
2. Press **Tiếng Việt**, then **English**: the parent side is bilingual.
3. On Progress, show the outcome board grouped by the 4 strands, and "This week".
4. **Learner**: home page shows "My math goals" with 8PR2 marked **Next lesson**.

---

## 3. Scenario A: Alex interrupts on slide 6 (5 min)

1. **Learner**: **Start today's lesson** → **Start lesson**. Narration plays; the words are always on screen.
2. Move through the slides. Answers, if you want to be quick:

   | Slide | Check-in | Answer |
   | --- | --- | --- |
   | 1 | 4x = 20; x + 7 = 12 | 5; 5 |
   | 2 | Add 2 to one side? | "The scale tips…" |
   | 4 | Last step of 5x − 7 = 18 | 5 |
   | 5 | 1-tiles on the left | 6 |

   Show a wrong answer once on slide 1 (type 4): a gentle hint appears. Show **Say it** to answer by voice ("five").
3. On **slide 6 (Who's right?)** press **Ask a question** and say: *"Wait – isn't that just 2x plus 3?"*
   - Narration stops at once; the answer is shown and read out, about the slide, with a check question.
   - Every value of x in the answer was checked by substitution before it was shown.
4. Press **Was this helpful? → Yes**, then **Continue lesson**: the lesson resumes on slide 6.
5. Optional: type *"I don't get it"* to show the switch to a balance scale or tiles.

---

## 4. Scenario B: a 50 CAD reward (7 min)

1. **Parent** → Rewards tab: the goal shows **Waiting for your child to accept**.
2. **Learner** home → **I accept this goal**. Parent refreshes: **Accepted by your child**.
3. **Learner**: finish the lesson (slides 7–8: −10; −4, 6, 5), then the exit ticket with full marks:

   | Question | Answer |
   | --- | --- |
   | 1. Solve 4x + 3 = 23 | x = 5 |
   | 2. Solve 2(x + 5) = 16 | x = 3 |
   | 3. Ava took away 5 from one side… | Take away 5 from the right side too, to keep it balanced. |
   | 4. Most important rule | e.g. *"Do the same to both sides so it stays balanced."* |

   Results: 3 out of 3, 8PR2 **Got it!**
4. **Both sides** now show **Halfway there!** (learner News; parent Notifications).
5. Say "a week later", then run **`npm run demo:time-travel`** in the terminal (8PR2 moves 8 days back; 8PR1 was reached and re-checked in class).
6. **Learner** home (refresh): **Memory check ready for 8PR2** → **Start memory check** → same answers.
7. **Parent** → Notifications: *"Alex unlocked the reward… Suggested praise: You fixed the distributive mistake yourself…"* (Alex had M2 when the goal was set).
8. Rewards tab → **Mark as given**. No payments or gift cards in the demo.

Point out: the goal is about outcomes, never minutes online; a re-check ≥ 7 days later is required; the child co-set the goal.

---

## 5. Scenario C: walking away mid-session (8 min, mostly waiting)

1. Run **`npm run demo:slot-now`**: adds a study slot happening right now (St. John's time).
2. **Learner**: open the lesson again → **Start lesson** → go to **slide 4** and stop. Do not touch anything.
3. After **60 seconds**: the lesson pauses and asks out loud **"Are you still there?"**
4. Keep waiting **5 more minutes** (talk through the sharing section meanwhile).
5. **Parent** → Notifications: *"Alex's session paused at slide 4, N minutes of active study. Away for 5 minutes."*
6. **Learner**: press **I'm back** → a **Quick review** question → **Continue the lesson** on slide 4.

Point out: no camera, no microphone recording; only taps, keys, tab visibility and narration. Away time never counts toward rewards.

---

## 6. The child controls sharing (2 min)

1. **Learner** → **What I share**. Three items are locked (study sessions, safety alerts, reward progress) with a reason.
2. Turn off **My math goal progress**.
3. **Parent** refreshes the Progress tab: *"Your child is keeping this private."*
4. **Learner** → **What my parent sees**: exactly the same page. Turn it back on.

Optional, safety: in the lesson, type *"the kids at school bully me"*. The lesson stops with a calm message and Kids Help Phone; the parent gets a safety alert. Possible abuse ("my dad hits me") is **not** sent to the parent; it goes to `safety_reviews` for a responsible adult (owner decision).

---

## 7. Scheduled checks (optional)

On Vercel, `/api/cron/engagement` runs daily at 22:00 St. John's. Locally, with `CRON_SECRET` in `.env.local`:

```
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/engagement
```

It reports missed sessions (with a make-up proposal), closes sessions left open, expires old goals, and on Sunday evening sends the weekly report.

---

## 8. Demo targets (proposal, Roadmap section)

| Metric | Demo target | Result | How it is checked |
| --- | --- | --- | --- |
| Math errors in slides and answers | 0 | 0 | `npm run test` (every equation, step and answer by substitution); `npm run eval:ask` |
| Asking and getting an answer in the slide's context | ≥ 9/10 | 10/10 (Gemini, 18 Nov 2026) | `npm run eval:ask` |
| Time until the answer starts | A few seconds | median 1.1 s, slowest 1.4 s (Gemini Flash-Lite) | `npm run eval:ask` |
| Runs on computer, tablet, phone | Yes | Yes: no sideways scrolling, 44 px tap targets on every page | `npm run test:e2e` (`responsive.spec.ts`, 3 devices) |
| Child's sharing toggles work correctly | 100% of items | 7/7 items | `npm run test:e2e` (`sharing.spec.ts`) |
| Viewers understand the outcome board without help | ≥ 4/5 testers | **to run with people** | Section 9 below |
| Reward rules self-verify and notify both sides | Yes | Yes | `npm run test:e2e` (`scenario-b.spec.ts`) |

Voice on iPhone/iPad: speech recognition may not work in Safari; the learner types the question instead (narration still works).

---

## 9. Outcome board check with 5 people (target ≥ 4/5)

Show each tester the parent **Progress** tab for Alex (after scenario B), say nothing else, and ask:

1. Which part of Grade 8 math is Alex working on right now?
2. Has Alex reached that goal? How can you tell?
3. Name one math topic Alex has not started.

A tester passes when they answer all three correctly without help. Write the results here:

| Tester | Q1 | Q2 | Q3 | Pass |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

---

## 10. After the demo

Run `npm run demo:reset` to start fresh next time. It clears Alex's sessions, results, questions, notifications and goals, and recreates the demo family.
