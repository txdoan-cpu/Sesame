import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";

const ProfileRow = z.object({
  id: z.uuid(),
  role: z.enum(["parent", "learner"]),
  display_name: z.string(),
  username: z.string().nullable(),
});

export type CurrentUser = {
  id: string;
  role: "parent" | "learner";
  displayName: string;
  username: string | null;
};

/** Signed-in user with their profile, or null. Verified with the Auth server. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!supabaseEnv()) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, role, display_name, username")
    .eq("id", auth.user.id)
    .maybeSingle();
  const parsed = ProfileRow.safeParse(data);
  if (!parsed.success) return null;

  return {
    id: parsed.data.id,
    role: parsed.data.role,
    displayName: parsed.data.display_name,
    username: parsed.data.username,
  };
});

export function homeFor(role: CurrentUser["role"]): "/parent" | "/learner" {
  return role === "parent" ? "/parent" : "/learner";
}

/** Redirects to login if signed out, or to the user's own home if the role is wrong. */
export async function requireRole(role: CurrentUser["role"]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}

const ChildRow = z.object({
  learner_id: z.uuid(),
  display_name: z.string(),
  username: z.string().nullable(),
  relationship: z.string(),
});

export type LinkedChild = { id: string; displayName: string; username: string; relationship: string };

/** A parent's linked children, read through the sharing-aware view (never the base tables). */
export async function getLinkedChildren(): Promise<LinkedChild[]> {
  await requireRole("parent");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parent_children_v")
    .select("learner_id, display_name, username, relationship")
    .order("linked_at");
  if (error || !data) return [];
  return data.flatMap((row) => {
    const parsed = ChildRow.safeParse(row);
    return parsed.success
      ? [
          {
            id: parsed.data.learner_id,
            displayName: parsed.data.display_name,
            username: parsed.data.username ?? "",
            relationship: parsed.data.relationship,
          },
        ]
      : [];
  });
}
