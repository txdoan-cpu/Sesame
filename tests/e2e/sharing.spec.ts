import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { SHARING_ITEMS, type SharingItem } from "@/lib/sharing";
import { adminClient, createFamily, deleteUsers, learnerEmailFor, signedIn, supabaseConfigured, type TestFamily } from "./helpers/supabase";

// Round 5 "done when": sharing tests pass for every item in §7.3.
// Straight against the database with real user sessions (RLS + views + triggers).

const UNLOCKED: SharingItem[] = ["outcome_status", "scores", "question_summaries", "misconceptions"];
const LOCKED: SharingItem[] = ["attendance", "safety_alerts", "reward_progress"];

test.describe("sharing (§7.3)", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let a: TestFamily;
  let b: TestFamily;
  let parentA: SupabaseClient;
  let parentB: SupabaseClient;
  let learnerA: SupabaseClient;
  let learnerB: SupabaseClient;

  /** What a viewer can see of learner A, item by item (true = some data visible). */
  async function visible(db: SupabaseClient): Promise<Record<SharingItem, boolean>> {
    const id = a.learner.id;
    const has = async (q: PromiseLike<{ data: unknown[] | null }>) => ((await q).data ?? []).length > 0;
    return {
      attendance: await has(db.from("parent_attendance_v").select("id").eq("learner_id", id)),
      // Safety alerts reach the parent as their own notifications.
      safety_alerts: await has(db.from("notifications").select("id").eq("type", "safety").eq("payload->>learner_id", id)),
      reward_progress: await has(db.from("parent_reward_progress_v").select("rule_id").eq("learner_id", id)),
      outcome_status: await has(db.from("parent_outcome_status_v").select("outcome_code").eq("learner_id", id)),
      scores: await has(db.from("parent_scores_v").select("id").eq("learner_id", id)),
      question_summaries: await has(db.from("parent_questions_v").select("id").eq("learner_id", id)),
      misconceptions: await has(db.from("parent_misconceptions_v").select("learner_id").eq("learner_id", id)),
    };
  }

  async function setShared(item: SharingItem, shared: boolean) {
    return learnerA.from("sharing_settings").update({ shared }).eq("learner_id", a.learner.id).eq("item", item).select("item");
  }

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "API-only checks run once");
    const admin = adminClient();
    a = await createFamily(admin, "sha");
    b = await createFamily(admin, "shb");
    const id = a.learner.id;
    const profile = LearnerProfileSchema.parse(demoA);
    const seed = await Promise.all([
      admin.from("learner_profiles").insert([toLearnerProfileRow(profile, id), toLearnerProfileRow(profile, b.learner.id)]),
      admin.from("outcome_status").insert({ learner_id: id, outcome_code: "8PR2", status: "achieved", mastery: 1, achieved_at: new Date().toISOString() }),
      admin.from("assessments").insert({ learner_id: id, outcome_code: "8PR2", lesson_id: "8PR2-demo-A", kind: "exit", score: 1, item_results: { mastered: true } }),
      admin.from("questions").insert([
        { learner_id: id, lesson_id: "8PR2-demo-A", slide_no: 3, text: "why take away 4?", indicator: "PR2.3" },
        { learner_id: id, lesson_id: "8PR2-demo-A", slide_no: 3, text: "kids bully me", safety_category: "bullying" },
      ]),
      admin.from("sessions").insert({ learner_id: id, lesson_id: "8PR2-demo-A", started_at: new Date().toISOString(), active_seconds: 600, idle_seconds: 60, engagement: "active" }),
      admin.from("reward_rules").insert({ parent_id: a.parent.id, learner_id: id, outcomes: ["8PR2", "8N7"], min_score: 0.8, deadline: "2027-06-30", reward_text: "Skates" }),
      admin.from("notifications").insert({ recipient_id: a.parent.id, type: "safety", payload: { learner_id: id, category: "bullying" } }),
    ]);
    for (const r of seed) if (r.error) throw new Error(r.error.message);

    parentA = await signedIn(a.parent.email);
    parentB = await signedIn(b.parent.email);
    learnerA = await signedIn(learnerEmailFor(a));
    learnerB = await signedIn(learnerEmailFor(b));
  });

  test.afterAll(async () => {
    if (a && b) await deleteUsers(adminClient(), [a.parent.id, a.learner.id, b.parent.id, b.learner.id]);
  });

  test("database defaults match lib/sharing.ts and every learner gets them", async () => {
    const defaults = await adminClient().from("sharing_defaults").select("item, default_shared, locked");
    expect(new Set(defaults.data?.map((d) => `${d.item}:${d.default_shared}:${d.locked}`))).toEqual(
      new Set(SHARING_ITEMS.map((s) => `${s.item}:${s.defaultShared}:${s.locked}`)),
    );
    const mine = await learnerA.from("sharing_settings").select("item, shared, locked");
    expect(mine.data).toHaveLength(SHARING_ITEMS.length);
  });

  test("defaults: parent sees attendance, safety, rewards, outcomes and scores; not questions or misconceptions", async () => {
    expect(await visible(parentA)).toEqual({
      attendance: true,
      safety_alerts: true,
      reward_progress: true,
      outcome_status: true,
      scores: true,
      question_summaries: false,
      misconceptions: false,
    });
  });

  test("the learner can flip every unlocked item, and the parent's view follows", async () => {
    for (const item of UNLOCKED) {
      const before = (await visible(parentA))[item];
      const res = await setShared(item, !before);
      expect(res.error, item).toBeNull();
      expect(res.data, item).toHaveLength(1);
      expect((await visible(parentA))[item], `${item} after flip`).toBe(!before);
    }
    // Shared questions never include safety-flagged ones.
    const q = await parentA.from("parent_questions_v").select("text").eq("learner_id", a.learner.id);
    expect(q.data).toEqual([{ text: "why take away 4?" }]);
    // Put everything back to defaults.
    for (const item of UNLOCKED) await setShared(item, SHARING_ITEMS.find((s) => s.item === item)!.defaultShared);
    expect((await visible(parentA)).outcome_status).toBe(true);
  });

  test("locked items cannot be turned off, by the learner or anyone else", async () => {
    for (const item of LOCKED) {
      const res = await setShared(item, false);
      // RLS hides locked rows from the learner's update, so nothing changes.
      expect(res.data ?? [], item).toEqual([]);
      const forced = await adminClient().from("sharing_settings").update({ shared: false }).eq("learner_id", a.learner.id).eq("item", item);
      expect(forced.error?.message, item).toMatch(/locked/);
    }
    const unlock = await adminClient().from("sharing_settings").update({ locked: false }).eq("learner_id", a.learner.id).eq("item", "attendance");
    expect(unlock.error).not.toBeNull();
    const v = await visible(parentA);
    expect([v.attendance, v.safety_alerts, v.reward_progress]).toEqual([true, true, true]);
  });

  test("reward progress stays visible when outcome status is private", async () => {
    await setShared("outcome_status", false);
    const v = await visible(parentA);
    expect(v.outcome_status).toBe(false);
    const prog = await parentA.from("parent_reward_progress_v").select("outcome_code, achieved").eq("learner_id", a.learner.id).order("outcome_code");
    expect(prog.data).toEqual([
      { outcome_code: "8N7", achieved: false },
      { outcome_code: "8PR2", achieved: true },
    ]);
    await setShared("outcome_status", true);
  });

  test("'What my parent sees' reads exactly what the parent reads", async () => {
    await setShared("misconceptions", true);
    for (const view of ["parent_outcome_status_v", "parent_scores_v", "parent_questions_v", "parent_misconceptions_v", "parent_attendance_v", "parent_reward_progress_v", "sharing_v"]) {
      const asParent = await parentA.from(view).select("*").eq("learner_id", a.learner.id);
      const asLearner = await learnerA.from(view).select("*").eq("learner_id", a.learner.id);
      expect(asLearner.data, view).toEqual(asParent.data);
    }
    await setShared("misconceptions", false);
  });

  test("other families see nothing, and parents never read base learner tables", async () => {
    const other = await visible(parentB);
    expect(Object.values(other).every((v) => v === false)).toBe(true);
    const learnerBSees = await visible(learnerB);
    expect(Object.values(learnerBSees).every((v) => v === false)).toBe(true);

    for (const table of ["outcome_status", "assessments", "questions", "learner_profiles", "sessions", "sharing_settings"]) {
      const r = await parentA.from(table).select("*").eq("learner_id", a.learner.id);
      expect(r.data ?? [], table).toEqual([]);
    }
  });

  test("reward rules: learner may only accept or comment; parent edits need agreement again", async () => {
    const { data: rule } = await adminClient().from("reward_rules").select("id").eq("learner_id", a.learner.id).single();
    const id = rule!.id as string;

    // Learner cannot change the deal.
    expect((await learnerA.from("reward_rules").update({ value: 500 }).eq("id", id)).error).not.toBeNull();
    expect((await learnerA.from("reward_rules").update({ status: "unlocked" }).eq("id", id)).error).not.toBeNull();
    // Learner accepts.
    expect((await learnerA.from("reward_rules").update({ co_set: true }).eq("id", id)).error).toBeNull();
    // Parent cannot accept for the child, cannot unlock, and changing terms resets agreement.
    expect((await parentA.from("reward_rules").update({ status: "unlocked" }).eq("id", id)).error).not.toBeNull();
    expect((await parentA.from("reward_rules").update({ reward_text: "New skates" }).eq("id", id)).error).toBeNull();
    const after = await adminClient().from("reward_rules").select("co_set, reward_text").eq("id", id).single();
    expect(after.data).toEqual({ co_set: false, reward_text: "New skates" });
    expect((await parentA.from("reward_rules").update({ co_set: true }).eq("id", id)).error).not.toBeNull();

    // Another parent cannot create a goal for this child.
    const foreign = await parentB.from("reward_rules").insert({ parent_id: b.parent.id, learner_id: a.learner.id, outcomes: ["8PR2"], min_score: 0.8, deadline: "2027-06-30", reward_text: "x" });
    expect(foreign.error).not.toBeNull();
    // A goal with an unknown outcome is refused.
    const bad = await parentA.from("reward_rules").insert({ parent_id: a.parent.id, learner_id: a.learner.id, outcomes: ["8XX9"], min_score: 0.8, deadline: "2027-06-30", reward_text: "x" });
    expect(bad.error).not.toBeNull();
  });

  test("schedules: parents of the child manage them; learners only ask", async () => {
    const slot = { learner_id: a.learner.id, weekday: 1, start_time: "16:30", duration_min: 20 };
    expect((await parentB.from("schedules").insert(slot)).error).not.toBeNull();
    expect((await learnerA.from("schedules").insert(slot)).error).not.toBeNull();
    const ok = await parentA.from("schedules").insert(slot).select("id").single();
    expect(ok.error).toBeNull();

    const req = await learnerA
      .from("schedule_change_requests")
      .insert({ learner_id: a.learner.id, schedule_id: ok.data!.id, weekday: 2, start_time: "17:00", duration_min: 25, status: "approved" })
      .select("id, status")
      .single();
    expect(req.data?.status).toBe("pending"); // a learner cannot approve their own request
    expect((await parentB.from("schedule_change_requests").select("id").eq("learner_id", a.learner.id)).data).toEqual([]);
    expect((await learnerA.from("schedule_change_requests").update({ status: "approved" }).eq("id", req.data!.id).select("id")).data ?? []).toEqual([]);
    const decided = await parentA.from("schedule_change_requests").update({ status: "approved" }).eq("id", req.data!.id).select("status, decided_at").single();
    expect(decided.data?.status).toBe("approved");
    expect(decided.data?.decided_at).toBeTruthy();
  });
});
