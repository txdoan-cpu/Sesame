/**
 * Engagement rules (CLAUDE.md §7.5). Pure functions so the browser tracker,
 * the server and the tests all use the same numbers.
 * No camera, no continuous microphone recording.
 */

/** Interaction counts as "recent" for this long. */
export const INTERACTION_WINDOW_MS = 60_000;
/** No answer to a check-in for this long → pause and ask "Are you still there?". */
export const CHECKPOINT_TIMEOUT_MS = 60_000;
/** Away this long during a scheduled session → alert the parent. */
export const AWAY_ALERT_MS = 5 * 60_000;
/** How often the browser reports to the server. */
export const HEARTBEAT_MS = 15_000;
/** A heartbeat can never claim more than this much time (protects the totals). */
export const MAX_HEARTBEAT_SECONDS = 120;

export type ActivityInput = {
  now: number;
  tabVisible: boolean;
  lastInteractionAt: number;
  /** Narration currently playing, and when it started. */
  narrationPlaying: boolean;
  narrationStartedAt: number | null;
};

/**
 * Active = tab visible AND (interacted in the last 60 s, OR listening to
 * narration that started after the last interaction).
 */
export function isActive(a: ActivityInput): boolean {
  if (!a.tabVisible) return false;
  if (a.now - a.lastInteractionAt <= INTERACTION_WINDOW_MS) return true;
  return a.narrationPlaying && a.narrationStartedAt !== null && a.narrationStartedAt > a.lastInteractionAt;
}

export type Engagement = "active" | "passive" | "away";

/** Session rating: active ≥ 80% active time, passive 50–79%, away < 50%. */
export function classifyEngagement(activeSeconds: number, idleSeconds: number): Engagement {
  const total = activeSeconds + idleSeconds;
  if (total <= 0) return "away";
  const share = activeSeconds / total;
  if (share >= 0.8) return "active";
  if (share >= 0.5) return "passive";
  return "away";
}

/** Pause when a check-in is open and nothing happened for 60 s (narration does not count as an answer). */
export function shouldPauseForCheckpoint(input: {
  now: number;
  checkpointOpen: boolean;
  lastInteractionAt: number;
  narrationPlaying: boolean;
  paused: boolean;
}): boolean {
  return (
    input.checkpointOpen && !input.paused && !input.narrationPlaying && input.now - input.lastInteractionAt >= CHECKPOINT_TIMEOUT_MS
  );
}

/** Away alert only for scheduled sessions, once, after 5 minutes away. */
export function shouldSendAwayAlert(input: { scheduled: boolean; awaySeconds: number; alreadySent: boolean }): boolean {
  return input.scheduled && !input.alreadySent && input.awaySeconds * 1000 >= AWAY_ALERT_MS;
}

/** Clamp what one heartbeat may add. */
export function clampHeartbeat(activeDelta: number, idleDelta: number): { active: number; idle: number } {
  const a = Math.max(0, Math.floor(activeDelta));
  const i = Math.max(0, Math.floor(idleDelta));
  const total = a + i;
  if (total <= MAX_HEARTBEAT_SECONDS) return { active: a, idle: i };
  const scale = MAX_HEARTBEAT_SECONDS / total;
  return { active: Math.floor(a * scale), idle: Math.floor(i * scale) };
}
