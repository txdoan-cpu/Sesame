"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { passwordSchema } from "@/lib/auth/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

/** Admin actions: create and remove teacher accounts (CLAUDE.md §6, owner decision Round 8). */

export type AdminState = { error?: "invalid_input" | "email_taken" | "save_failed"; ok?: boolean };

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

export async function createTeacher(_prev: AdminState, fd: FormData): Promise<AdminState> {
  await requireRole("admin");
  const p = z
    .object({
      displayName: z.string().trim().min(1).max(60),
      email: z.string().trim().toLowerCase().pipe(z.email()),
      password: passwordSchema,
    })
    .safeParse({ displayName: field(fd, "displayName"), email: field(fd, "email"), password: field(fd, "password") });
  if (!p.success) return { error: "invalid_input" };
  const res = await createAdminClient().auth.admin.createUser({
    email: p.data.email,
    password: p.data.password,
    email_confirm: true,
    // Only the service role can set app_metadata; the profile trigger reads the role from it.
    app_metadata: { role: "teacher" },
    user_metadata: { display_name: p.data.displayName },
  });
  if (res.error) return { error: res.error.code === "email_exists" ? "email_taken" : "save_failed" };
  revalidatePath("/admin");
  return { ok: true };
}

export async function removeTeacher(fd: FormData): Promise<void> {
  const me = await requireRole("admin");
  const id = z.uuid().safeParse(field(fd, "id"));
  if (!id.success || id.data === me.id) return;
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("role").eq("id", id.data).maybeSingle();
  if (data?.role !== "teacher") return; // never delete families or admins from here
  await admin.auth.admin.deleteUser(id.data);
  revalidatePath("/admin");
}
