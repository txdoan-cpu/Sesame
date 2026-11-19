/**
 * Records the narrated demo video (English captions + English text-to-speech).
 *
 *   FFMPEG_PATH=<path to ffmpeg> npm run demo:video
 *
 * Uses the demo family (parent.demo@example.com / demo_a) on VIDEO_BASE_URL
 * (default: the live Vercel site). Resets the demo family before and after.
 * Output: demo-video/sesame-demo.mp4 (not committed). Windows only for the
 * voice (System.Speech, voice "Microsoft Zira Desktop").
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import { chromium, devices, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());

const BASE = process.env.VIDEO_BASE_URL ?? "https://sesame-seven-chi.vercel.app";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const OUT = path.resolve("demo-video");
const TMP = path.join(OUT, "work");
const PASSWORD = process.env.DEMO_PASSWORD?.trim();
const PARENT_EMAIL = "parent.demo@example.com";
const LEARNER = "demo_a";
const VOICE = process.env.VIDEO_VOICE ?? "Microsoft Zira Desktop";

if (!PASSWORD) {
  console.error("Set DEMO_PASSWORD in .env.local first.");
  process.exit(1);
}

/* ------------------------------------------------------------------------ */
/* Narration (also shown as captions)                                        */
/* ------------------------------------------------------------------------ */

const N: Record<string, string> = {
  title:
    "Sesame is a demo of an AI instructor for Grade 8 math in St. John's, Newfoundland and Labrador. It has three parts: a personalised lesson, voice questions during the lesson, and a parent portal. All data in this video is made up.",
  l_login: "Alex, a Grade 8 student, logs in with a username and password that a parent set up.",
  l_home: "Alex's home page shows the Grade 8 math goals, grouped by strand. The next lesson, 8PR2, linear equations, is marked in blue.",
  l_goal: "A parent set a reward goal: reach 8PR1 and 8PR2 with 85 percent, then pass a memory check a week later. Alex accepts it, so they set the goal together.",
  l_start: "The lesson was chosen for Alex's profile. It takes about fifteen minutes.",
  l_slide1: "Every slide has spoken narration, and the words are always on screen. A check-in comes every two or three minutes.",
  l_hint: "A wrong answer brings a gentle hint, one step at a time. Alex can also answer by voice.",
  l_slide2: "The equals sign means balanced. A balance scale makes the idea concrete.",
  l_slide3: "A worked example uses something Alex likes: renting skates at a rink in St. John's.",
  l_slide4: "In a faded example, Alex writes the last step.",
  l_slide5: "Algebra tiles show that two groups of x plus three make two x plus six.",
  l_slide6: "This slide targets a mistake from Alex's profile: multiplying only the first term in the brackets.",
  l_ask: "Alex presses Ask a question. The narration stops, and the AI answers about this exact slide. Every number it states is checked by substitution before it is shown.",
  l_answer: "The answer ends with a short check question. Alex rates the answer, then the lesson carries on from the same place.",
  l_practice: "Slides seven and eight practise negative numbers and three more equations, with tiered hints.",
  l_exit: "The final check has three tap questions, where each wrong option points to a known mistake, and one question in Alex's own words.",
  l_results: "Full marks, and Alex explained the balance rule, so 8PR2 is now achieved. The result is scored on the server, not in the browser.",
  l_news: "8PR2 is one of the two reward outcomes, so both Alex and the parent get a halfway there message.",
  p_login: "Now the parent's side. The parent logs in with an email address.",
  p_dash: "The dashboard lists the children and any new notifications.",
  p_week: "Each child has a progress page. This week shows study sessions and minutes of real, active study.",
  p_why: "Why this lesson explains the AI's choices: what it noticed, what the lesson does about it, and which teaching criteria it meets. Reasons about mistakes stay hidden unless Alex shares them.",
  p_board: "The outcome board follows the Newfoundland and Labrador curriculum, in plain words for parents.",
  p_notes: "Notifications include the halfway milestone and the goal Alex accepted.",
  p_rewards: "Reward goals are about learning, never about minutes online. The parent sees progress, and a warning if a goal looks unlikely by its deadline.",
  p_schedule: "The parent sets weekly study times. Alex can ask to move one, and the parent approves.",
  s_share: "Alex decides what the parent can see. Study sessions, safety alerts and reward progress are always shared. The rest is Alex's choice.",
  s_view: "What my parent sees shows exactly the parent's view. Math outcomes now read: your child is keeping this private.",
  b_check: "A week later, a memory check for 8PR2 is ready. A goal only unlocks if Alex still remembers.",
  b_pass: "Alex passes the memory check.",
  b_unlock: "The reward unlocks. The parent is told, with a suggested, specific praise: Alex fixed the distributive mistake.",
  b_given: "The parent gives the reward and marks it as given. The app never handles money.",
  c_start: "Engagement tracking. During a scheduled study session, Alex stops answering a check-in.",
  c_pause: "After sixty seconds with no answer, the lesson pauses and asks out loud: are you still there? Time is fast-forwarded in this video.",
  c_alert: "After five more minutes away, the parent gets an alert with the slide and the minutes of real study. No camera and no microphone recording are used.",
  c_back: "When Alex comes back, a short review question comes first. Then the lesson resumes on the same slide.",
  safety:
    "If a question suggests bullying, self-harm or danger, the lesson stops. Alex sees a calm message with Kids Help Phone, and the parent is alerted.",
  phone: "The same app works on phones and tablets, with large buttons that are easy to tap.",
  end: "That's Sesame: a lesson built for the learner, questions answered by voice in context, and a parent portal the child can trust. Thanks for watching.",
};

/* ------------------------------------------------------------------------ */
/* Text-to-speech (Windows System.Speech)                                    */
/* ------------------------------------------------------------------------ */

function wavSeconds(file: string): number {
  const b = fs.readFileSync(file);
  const byteRate = b.readUInt32LE(28);
  let off = 12;
  while (off < b.length - 8) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "data") return size / byteRate;
    off += 8 + size;
  }
  return 0;
}

function synthesize(): Record<string, { file: string; seconds: number }> {
  const json = path.join(TMP, "narration.json");
  const ps1 = path.join(TMP, "tts.ps1");
  fs.writeFileSync(json, JSON.stringify(Object.entries(N).map(([id, text]) => ({ id, text }))), "utf8");
  fs.writeFileSync(
    ps1,
    [
      "param($json, $dir, $voice)",
      "Add-Type -AssemblyName System.Speech",
      "$items = Get-Content -Raw -Encoding UTF8 $json | ConvertFrom-Json",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "$s.SelectVoice($voice)",
      "$s.Rate = 0",
      "foreach ($it in $items) { $s.SetOutputToWaveFile((Join-Path $dir ($it.id + '.wav'))); $s.Speak($it.text) }",
      "$s.SetOutputToNull()",
      "$s.Dispose()",
    ].join("\r\n"),
    "utf8",
  );
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, json, TMP, VOICE], { stdio: "inherit" });
  return Object.fromEntries(
    Object.keys(N).map((id) => {
      const file = path.join(TMP, `${id}.wav`);
      return [id, { file, seconds: wavSeconds(file) }];
    }),
  );
}

/* ------------------------------------------------------------------------ */
/* Recording                                                                 */
/* ------------------------------------------------------------------------ */

type Rec = { id: string; context: BrowserContext; page: Page; startedAt: number; caption: string; phone: boolean };
type Clip = { rec: Rec; start: number; end: number; audio: string };

const clips: Clip[] = [];
let voice: Record<string, { file: string; seconds: number }> = {};

/** Headless narration should finish at once; questions are typed (no microphone in the video). */
const INIT = `
  if (window.speechSynthesis) {
    window.speechSynthesis.speak = (u) => { setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 20); }, 5); };
    window.speechSynthesis.cancel = () => {};
  }
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
`;

function applyCaption(page: Page, text: string, phone: boolean) {
  return page
    .evaluate(
      ({ text, phone }) => {
        let el = document.getElementById("demo-caption");
        if (!el) {
          el = document.createElement("div");
          el.id = "demo-caption";
          Object.assign(el.style, {
            position: "fixed",
            left: "50%",
            bottom: phone ? "12px" : "18px",
            transform: "translateX(-50%)",
            maxWidth: phone ? "94%" : "86%",
            background: "rgba(15, 23, 42, 0.88)",
            color: "#fff",
            font: phone ? "600 15px/1.35 system-ui, sans-serif" : "600 21px/1.4 system-ui, sans-serif",
            padding: phone ? "8px 12px" : "12px 20px",
            borderRadius: "12px",
            zIndex: "2147483647",
            textAlign: "center",
            pointerEvents: "none",
            boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
          });
          document.body.appendChild(el);
        }
        el.textContent = text;
      },
      { text, phone },
    )
    .catch(() => {});
}

async function newRec(browser: Browser, id: string, opts: { phone?: boolean; clock?: boolean } = {}): Promise<Rec> {
  const dir = path.join(TMP, "raw", id);
  const base = opts.phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 720 } };
  const size = opts.phone ? { width: 412, height: 839 } : { width: 1280, height: 720 };
  const context = await browser.newContext({ ...base, recordVideo: { dir, size } });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const rec: Rec = { id, context, page, startedAt: Date.now(), caption: "", phone: Boolean(opts.phone) };
  if (opts.clock) await page.clock.install();
  // Keep the caption after every navigation.
  page.on("load", () => void applyCaption(page, rec.caption, rec.phone));
  return rec;
}

/** One narrated step: caption on, actions run, and the clip lasts at least as long as the voice. */
async function step(rec: Rec, id: string, actions: () => Promise<void> = async () => {}) {
  const v = voice[id];
  const start = (Date.now() - rec.startedAt) / 1000;
  rec.caption = N[id];
  await applyCaption(rec.page, N[id], rec.phone);
  const t0 = Date.now();
  await actions();
  await applyCaption(rec.page, N[id], rec.phone);
  const left = v.seconds * 1000 + 700 - (Date.now() - t0);
  if (left > 0) await rec.page.waitForTimeout(left);
  clips.push({ rec, start, end: (Date.now() - rec.startedAt) / 1000, audio: v.file });
  console.log(`  ✓ ${id} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

/** Highlights what is about to be clicked, so viewers can follow. */
async function tap(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((el) => {
    (el as HTMLElement).style.outline = "4px solid #f97316";
    (el as HTMLElement).style.outlineOffset = "3px";
  });
  await target.page().waitForTimeout(550);
  await target.click();
}

async function typeInto(target: Locator, text: string) {
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await target.fill("");
  await target.pressSequentially(text, { delay: 45 });
}

async function scrollTo(target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await target.page().waitForTimeout(900);
}

async function loginLearner(page: Page) {
  await page.goto(`${BASE}/login`);
  const form = page.getByTestId("learner-login");
  await typeInto(form.getByLabel("Username"), LEARNER);
  await form.getByLabel("Password").fill(PASSWORD!);
  await tap(form.getByRole("button", { name: "Log in" }));
  await page.waitForURL(/\/learner$/);
}

async function loginParent(page: Page) {
  await page.goto(`${BASE}/login`);
  const form = page.getByTestId("parent-login");
  await typeInto(form.getByLabel("Email"), PARENT_EMAIL);
  await form.getByLabel("Password").fill(PASSWORD!);
  await tap(form.getByRole("button", { name: "Log in" }));
  await page.waitForURL(/\/parent$/);
}

async function answer(page: Page, id: string, value: string) {
  const form = page.getByTestId(`check-${id}`);
  await typeInto(form.getByRole("textbox"), value);
  await tap(form.getByRole("button", { name: "Check" }));
}

const next = (page: Page) => tap(page.getByRole("button", { name: "Next", exact: true }));

async function exitAllRight(page: Page, submit: string) {
  await tap(page.getByTestId("exit-e1").getByLabel("x = 5", { exact: true }));
  await tap(page.getByTestId("exit-e2").getByLabel("x = 3", { exact: true }));
  await tap(page.getByTestId("exit-e3").getByLabel("Take away 5 from the right side too, to keep it balanced."));
  await typeInto(page.getByTestId("exit-ticket").getByRole("textbox"), "Do the same thing to both sides so it stays balanced.");
  await tap(page.getByTestId("exit-ticket").getByRole("button", { name: submit }));
  await page.getByTestId("lesson-results").waitFor();
}

function npm(script: string) {
  execSync(`npm run ${script}`, { stdio: "inherit" });
}

async function record(browser: Browser) {
  // Title
  const title = await newRec(browser, "title");
  await title.page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#1d4ed8;color:#fff;font-family:system-ui,sans-serif">
    <div style="text-align:center"><div style="font-size:84px;font-weight:800">Sesame</div>
    <div style="font-size:30px;margin-top:12px">AI Instructor demo · Grade 8 Math · St. John's, NL</div>
    <div style="font-size:20px;margin-top:28px;opacity:.85">${BASE.replace("https://", "")}</div></div></body></html>`);
  await step(title, "title");

  // Learner: lesson + question
  const L = await newRec(browser, "learner");
  await step(L, "l_login", () => loginLearner(L.page));
  await step(L, "l_home", async () => {
    await scrollTo(L.page.getByTestId("outcome-board"));
    await L.page.waitForTimeout(1500);
    await scrollTo(L.page.getByRole("heading", { level: 1 }));
  });
  await step(L, "l_goal", async () => {
    await scrollTo(L.page.getByTestId("my-rewards"));
    await tap(L.page.getByTestId("my-reward").getByRole("button", { name: "I accept this goal" }));
    await L.page.getByText("You accepted this goal.").first().waitFor();
  });
  await step(L, "l_start", async () => {
    await L.page.goto(`${BASE}/learner`);
    await tap(L.page.getByRole("link", { name: "Start today's lesson" }));
    await L.page.getByRole("button", { name: "Start lesson" }).waitFor();
  });
  await step(L, "l_slide1", () => tap(L.page.getByRole("button", { name: "Start lesson" })));
  await step(L, "l_hint", async () => {
    await answer(L.page, "s1a", "4");
    await L.page.waitForTimeout(1200);
    await answer(L.page, "s1a", "5");
    await answer(L.page, "s1b", "5");
  });
  await step(L, "l_slide2", async () => {
    await next(L.page);
    await L.page.waitForTimeout(1500);
    await tap(L.page.getByRole("button", { name: "The scale tips. It is not balanced any more." }));
  });
  await step(L, "l_slide3", async () => {
    await next(L.page);
    await L.page.waitForTimeout(800);
    await scrollTo(L.page.getByRole("list", { name: "Steps" }));
  });
  await step(L, "l_slide4", async () => {
    await next(L.page);
    await answer(L.page, "s4", "5");
  });
  await step(L, "l_slide5", async () => {
    await next(L.page);
    await scrollTo(L.page.getByRole("figure"));
    await answer(L.page, "s5", "6");
  });
  await step(L, "l_slide6", async () => {
    await next(L.page);
    await scrollTo(L.page.getByRole("heading", { level: 2 }));
  });
  await step(L, "l_ask", async () => {
    await tap(L.page.getByRole("button", { name: "Ask a question" }));
    const panel = L.page.getByTestId("ask-panel");
    await typeInto(panel.getByLabel("Or type your question"), "Wait, isn't that just 2x plus 3?");
    await tap(panel.getByRole("button", { name: "Ask", exact: true }));
    await panel.getByTestId("ask-answer").waitFor({ timeout: 30_000 });
    await scrollTo(panel);
  });
  await step(L, "l_answer", async () => {
    const panel = L.page.getByTestId("ask-panel");
    await L.page.waitForTimeout(2500);
    await tap(panel.getByRole("button", { name: "Yes, it helped" }));
    await tap(panel.getByRole("button", { name: "Continue lesson" }));
    await tap(L.page.getByRole("button", { name: "Maya. The 2 multiplies the x and the 3." }));
  });
  await step(L, "l_practice", async () => {
    await next(L.page);
    await answer(L.page, "s7", "-10");
    await next(L.page);
    await answer(L.page, "s8a", "-4");
    await answer(L.page, "s8b", "6");
    await answer(L.page, "s8c", "5");
    await next(L.page);
  });
  await step(L, "l_exit", async () => {
    await tap(L.page.getByRole("button", { name: "Go to the last questions" }));
    await exitAllRight(L.page, "Finish lesson");
  });
  await step(L, "l_results", () => scrollTo(L.page.getByTestId("lesson-results")));
  await step(L, "l_news", async () => {
    await tap(L.page.getByRole("link", { name: "Back to my goals" }));
    await L.page.getByTestId("news-milestone").waitFor();
    await scrollTo(L.page.getByTestId("learner-news"));
  });

  // Parent portal
  const P = await newRec(browser, "parent");
  await step(P, "p_login", () => loginParent(P.page));
  await step(P, "p_dash");
  await step(P, "p_week", async () => {
    await tap(P.page.getByRole("link", { name: "Open Alex's page" }));
    await P.page.getByTestId("this-week").waitFor();
    await scrollTo(P.page.getByTestId("this-week"));
  });
  await step(P, "p_why", () => scrollTo(P.page.getByTestId("rationale")));
  await step(P, "p_board", () => scrollTo(P.page.getByTestId("section-outcome_status")));
  await step(P, "p_notes", async () => {
    await P.page.goto(`${BASE}/parent/notifications`);
    await P.page.getByTestId("notification-milestone").waitFor();
  });
  await step(P, "p_rewards", async () => {
    await P.page.goto(`${BASE}/parent`);
    await tap(P.page.getByRole("link", { name: "Open Alex's page" }));
    await tap(P.page.getByRole("link", { name: "Rewards" }));
    await P.page.getByTestId("reward-rule").first().waitFor();
  });
  await step(P, "p_schedule", () => tap(P.page.getByRole("link", { name: "Schedule" })));

  // Sharing
  await step(L, "s_share", async () => {
    await L.page.goto(`${BASE}/learner/sharing`);
    await L.page.waitForTimeout(1500);
    await tap(L.page.getByTestId("sharing-outcome_status").getByRole("button", { name: "Keep it private" }));
    await L.page.getByTestId("sharing-outcome_status").getByText("Private").waitFor();
  });
  await step(L, "s_view", async () => {
    await tap(L.page.getByRole("link", { name: "See what my parent sees" }));
    await scrollTo(L.page.getByTestId("section-outcome_status"));
  });
  // Share it again (not shown).
  await L.page.goto(`${BASE}/learner/sharing`);
  await L.page.getByTestId("sharing-outcome_status").getByRole("button", { name: "Share it" }).click();

  // Scenario B: a week later
  npm("demo:time-travel");
  await step(L, "b_check", async () => {
    await L.page.goto(`${BASE}/learner`);
    await scrollTo(L.page.getByTestId("learner-news"));
    await tap(L.page.getByRole("link", { name: "Start memory check" }));
    await L.page.getByTestId("exit-ticket").waitFor();
  });
  await step(L, "b_pass", () => exitAllRight(L.page, "Finish lesson"));
  await step(P, "b_unlock", async () => {
    await P.page.goto(`${BASE}/parent/notifications`);
    await P.page.getByTestId("notification-reward_unlocked").waitFor();
  });
  await step(P, "b_given", async () => {
    await P.page.goto(`${BASE}/parent`);
    await tap(P.page.getByRole("link", { name: "Open Alex's page" }));
    await tap(P.page.getByRole("link", { name: "Rewards" }));
    const card = P.page.getByTestId("reward-rule").first();
    await tap(card.getByRole("button", { name: "Mark as given" }));
    await P.page.getByTestId("reward-rule").first().getByText("Given").waitFor();
  });

  // Scenario C: walking away (fake clock in this browser only)
  npm("demo:slot-now");
  const C = await newRec(browser, "away", { clock: true });
  await step(C, "c_start", async () => {
    await loginLearner(C.page);
    await C.page.goto(`${BASE}/learner/lesson`);
    await C.page.getByRole("button", { name: "Start lesson" }).click();
    await answer(C.page, "s1a", "5");
    await answer(C.page, "s1b", "5");
    await next(C.page);
    await C.page.getByRole("button", { name: "The scale tips. It is not balanced any more." }).click();
    await next(C.page);
    await next(C.page);
    await C.page.getByTestId("check-s4").waitFor();
  });
  await step(C, "c_pause", async () => {
    await C.page.clock.runFor(65_000);
    await C.page.getByTestId("still-there").waitFor();
  });
  await C.page.clock.runFor(5 * 60_000 + 30_000);
  await C.page.waitForTimeout(4000); // heartbeats reach the server
  await step(P, "c_alert", async () => {
    await P.page.goto(`${BASE}/parent/notifications`);
    await P.page.getByTestId("notification-idle").first().waitFor({ timeout: 20_000 });
  });
  await step(C, "c_back", async () => {
    await tap(C.page.getByRole("button", { name: "I'm back" }));
    const review = C.page.getByTestId("review");
    await typeInto(review.getByRole("textbox"), "5");
    await tap(review.getByRole("button", { name: "Check" }));
    await tap(review.getByRole("button", { name: "Continue the lesson" }));
    await C.page.getByTestId("check-s4").waitFor();
  });
  await step(C, "safety", async () => {
    await tap(C.page.getByRole("button", { name: "Ask a question" }));
    const panel = C.page.getByTestId("ask-panel");
    await typeInto(panel.getByLabel("Or type your question"), "the kids at school bully me");
    await tap(panel.getByRole("button", { name: "Ask", exact: true }));
    await C.page.getByTestId("safety-message").waitFor();
  });

  // Phone
  const M = await newRec(browser, "phone", { phone: true });
  await step(M, "phone", async () => {
    await loginLearner(M.page);
    await M.page.waitForTimeout(1500);
    await M.page.goto(`${BASE}/learner/lesson`);
    await tap(M.page.getByRole("button", { name: "Start lesson" }));
    await M.page.waitForTimeout(1500);
  });

  // End card
  const end = await newRec(browser, "end");
  await end.page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#1d4ed8;color:#fff;font-family:system-ui,sans-serif">
    <div style="text-align:center"><div style="font-size:72px;font-weight:800">Sesame</div>
    <div style="font-size:26px;margin-top:16px">Personalised lessons · Voice questions in context · A parent portal the child controls</div>
    <div style="font-size:20px;margin-top:28px;opacity:.85">${BASE.replace("https://", "")} · synthetic demo data</div></div></body></html>`);
  await step(end, "end");

  return [title, L, P, C, M, end];
}

/* ------------------------------------------------------------------------ */
/* Editing                                                                   */
/* ------------------------------------------------------------------------ */

function ffmpeg(args: string[]) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  console.log("1/4 Narration (text-to-speech)…");
  voice = synthesize();

  console.log("2/4 Fresh demo family…");
  npm("demo:reset");

  console.log("3/4 Recording on", BASE);
  const browser = await chromium.launch();
  let recs: Rec[] = [];
  try {
    recs = await record(browser);
  } finally {
    for (const r of recs) await r.context.close();
    await browser.close();
  }

  console.log("4/4 Editing…");
  const videoOf = new Map<Rec, string>();
  for (const r of recs) videoOf.set(r, (await r.page.video()!.path()));
  const parts: string[] = [];
  clips.forEach((c, i) => {
    const part = path.join(TMP, `part-${String(i).padStart(3, "0")}.mp4`);
    const dur = Math.max(0.5, c.end - c.start);
    const scale = c.rec.phone
      ? "scale=-2:700,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0f172a"
      : "scale=1280:720";
    ffmpeg([
      "-i", videoOf.get(c.rec)!,
      "-i", c.audio,
      "-filter_complex", `[0:v]trim=start=${c.start.toFixed(2)}:duration=${dur.toFixed(2)},setpts=PTS-STARTPTS,${scale},fps=30,format=yuv420p[v];[1:a]aresample=44100,apad,atrim=duration=${dur.toFixed(2)}[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "128k",
      part,
    ]);
    parts.push(part);
  });
  const list = path.join(TMP, "parts.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
  const final = path.join(OUT, "sesame-demo.mp4");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final]);

  console.log("Cleaning up the demo family…");
  npm("demo:reset");
  const seconds = clips.reduce((s, c) => s + (c.end - c.start), 0);
  console.log(`Done: ${final} (${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s)`);
}

main().catch((err: unknown) => {
  console.error("Video failed:", err instanceof Error ? err.message : err);
  // Leave the demo family clean even when recording stops half-way.
  try {
    npm("demo:reset");
  } catch {
    // reported above
  }
  process.exit(1);
});
