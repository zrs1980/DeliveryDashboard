"use client";

// ─── Jumping between top-level tabs, with a target ───────────────────────────
//
// ⚠ THE PROBLEM THIS SOLVES IS FINDING, NOT DOING. A CSM reads an account's
// Activity tab, sees six meetings chipped NOT PROCESSED, and to fix one has to
// leave the customer page, open the Fireflies tab, and find that meeting in a
// list of 100. The chip announced a gap and made them walk somewhere else to
// close it.
//
// ⚠ IT DELIBERATELY DOES NOT RE-HOST THE FLOWS. The Process wizard needs a
// project and the meeting's full Fireflies record; the draft queue is where a
// send is reviewed, and putting "approve and send" on a panel someone opened to
// read a timeline would widen a safety surface that is narrow on purpose.
// Nothing here performs an action — it carries you to the screen that does,
// with the right row already in front of you.
//
// An event bus rather than routing state because the tab is plain `useState` in
// app/page.tsx with no URL behind it. Threading a callback from there through
// CustomersArea → CrmAccountPage → the Activity feed would be five props deep
// for one rare interaction.

export type NavTab = "fireflies" | "cs" | "customers";

export interface NavRequest {
  tab: NavTab;
  /**
   * What to select or highlight once there. `label` is carried because the
   * Fireflies list filters on text rather than id — narrowing 100 rows to the
   * one you clicked is the whole point, and it needs the title.
   */
  focus?: { kind: "meeting" | "draft"; id: string; label?: string };
}

const EVENT = "app:navigate";

/** Ask the shell to switch tabs and point at something. */
export function navigateTo(req: NavRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NavRequest>(EVENT, { detail: req }));
}

/** The shell listens. Returns an unsubscribe. */
export function onNavigate(fn: (req: NavRequest) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => fn((e as CustomEvent<NavRequest>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
