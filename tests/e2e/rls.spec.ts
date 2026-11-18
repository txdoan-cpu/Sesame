import { expect, test } from "@playwright/test";
import {
  adminClient,
  anonClient,
  createFamily,
  deleteUsers,
  learnerEmailFor,
  signedIn,
  supabaseConfigured,
  type TestFamily,
} from "./helpers/supabase";

// Row Level Security checks straight against the Supabase API (no browser needed).
// Two synthetic families, A and B; each user must only see what CLAUDE.md §6 allows.

test.describe("Row Level Security", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let a: TestFamily;
  let b: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "API-only checks run once");
    const admin = adminClient();
    a = await createFamily(admin, "a");
    b = await createFamily(admin, "b");
  });

  test.afterAll(async () => {
    if (a && b) await deleteUsers(adminClient(), [a.parent.id, a.learner.id, b.parent.id, b.learner.id]);
  });

  test("learner sees only their own profile and links", async () => {
    const db = await signedIn(learnerEmailFor(a));

    const profiles = await db.from("profiles").select("id, role");
    expect(profiles.error).toBeNull();
    expect(profiles.data).toEqual([{ id: a.learner.id, role: "learner" }]);

    const links = await db.from("family_links").select("parent_id, learner_id");
    expect(links.data).toEqual([{ parent_id: a.parent.id, learner_id: a.learner.id }]);

    // The parent view is for parents only.
    const view = await db.from("parent_children_v").select("learner_id");
    expect(view.data ?? []).toEqual([]);
  });

  test("parent sees only their linked child, and only through the view", async () => {
    const db = await signedIn(a.parent.email);

    const view = await db.from("parent_children_v").select("learner_id, display_name, username");
    expect(view.error).toBeNull();
    expect(view.data).toEqual([{ learner_id: a.learner.id, display_name: a.learner.name, username: a.learner.username }]);

    // Base table: own profile only, never the child's row.
    const profiles = await db.from("profiles").select("id");
    expect(profiles.data).toEqual([{ id: a.parent.id }]);

    const other = await db.from("profiles").select("id").in("id", [b.learner.id, b.parent.id, a.learner.id]);
    expect(other.data).toEqual([]);
  });

  test("users cannot write profiles or links from the client", async () => {
    const learner = await signedIn(learnerEmailFor(a));
    const parentB = await signedIn(b.parent.email);

    // Parent B tries to link themselves to child A.
    const link = await parentB.from("family_links").insert({ parent_id: b.parent.id, learner_id: a.learner.id });
    expect(link.error).not.toBeNull();

    // Learner tries to promote themselves to parent.
    await learner.from("profiles").update({ role: "parent" }).eq("id", a.learner.id);
    const check = await adminClient().from("profiles").select("role").eq("id", a.learner.id).single();
    expect(check.data?.role).toBe("learner");

    // Parent B still sees only their own child.
    const view = await parentB.from("parent_children_v").select("learner_id");
    expect(view.data).toEqual([{ learner_id: b.learner.id }]);
  });

  test("public sign-up can never create a learner", async () => {
    const admin = adminClient();
    const email = `e2e-signup-${Date.now()}@example.com`;
    const res = await anonClient().auth.signUp({
      email,
      password: "E2e-test-pass-123",
      options: { data: { role: "learner", username: "hacker_kid", display_name: "Sneaky" } },
    });
    expect(res.error).toBeNull();
    const id = res.data.user!.id;
    try {
      const row = await admin.from("profiles").select("role, username").eq("id", id).single();
      expect(row.data).toEqual({ role: "parent", username: null });
    } finally {
      await deleteUsers(admin, [id]);
    }
  });

  test("signed-out visitors read nothing", async () => {
    const db = anonClient();
    for (const table of ["profiles", "family_links", "parent_children_v"]) {
      const res = await db.from(table).select("*");
      expect(res.data ?? [], table).toEqual([]);
    }
  });
});
