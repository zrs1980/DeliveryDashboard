"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import { C } from "@/lib/constants";
import { isDone } from "@/lib/clickup";
import type { Project, CUTask } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NSCase {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  company: string;
  assigned: string;
}

interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
}

type DragItem =
  | { type: "task"; task: CUTask; projectLabel: string }
  | { type: "case"; caseNumber: string; caseTitle: string; company: string };

interface Props {
  projects: Project[];
  cases: NSCase[];
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const HOURS     = Array.from({ length: 12 }, (_, i) => i + 7); // 7am–6pm
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtHour(h: number) {
  if (h === 0 || h === 12) return `12${h === 0 ? "am" : "pm"}`;
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function fmtDay(date: Date) {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getDate() === now.getDate() &&
         date.getMonth() === now.getMonth() &&
         date.getFullYear() === now.getFullYear();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarView({ projects, cases }: Props) {
  const { data: session } = useSession();
  const [weekStart, setWeekStart]         = useState<Date>(() => getMondayOf(new Date()));
  const [events, setEvents]               = useState<CalEvent[]>([]);
  const [calendarReady, setCalendarReady] = useState<boolean | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [creating, setCreating]           = useState(false);
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null);
  const [dropTarget, setDropTarget]       = useState<string | null>(null);
  const [sidebarTab, setSidebarTab]       = useState<"tasks" | "cases">("tasks");
  const dragRef = useRef<DragItem | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filterScheduled, setFilterScheduled] = useState<"all" | "scheduled" | "unscheduled">("all");
  const [filterDue,       setFilterDue]       = useState<"all" | "overdue" | "today" | "week" | "none">("all");
  const [filterProject,   setFilterProject]   = useState<string>("all");
  const [filterMine,      setFilterMine]      = useState(false);
  const [scheduledIds,    setScheduledIds]     = useState<Set<string>>(new Set());

  // ── Check calendar token status once session is available ────────────────────
  useEffect(() => {
    if (!session) return;
    fetch("/api/calendar/status")
      .then(r => r.json())
      .then(d => setCalendarReady(d.connected))
      .catch(() => setCalendarReady(false));
    // Load scheduled task IDs
    fetch("/api/calendar/scheduled")
      .then(r => r.json())
      .then(d => setScheduledIds(new Set(d.taskIds ?? [])))
      .catch(() => {});
  }, [session]);

  // ── Fetch events for visible week ────────────────────────────────────────────
  const fetchEvents = useCallback(() => {
    if (!calendarReady) return;
    const start = weekStart.toISOString();
    const end   = addDays(weekStart, 7).toISOString();
    setLoadingEvents(true);
    fetch(`/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) showToast(d.error, false);
        else setEvents(d.events ?? []);
      })
      .finally(() => setLoadingEvents(false));
  }, [calendarReady, weekStart]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // ── Toast ────────────────────────────────────────────────────────────────────
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Create event ─────────────────────────────────────────────────────────────
  async function createEvent(title: string, description: string, dayIndex: number, hour: number, taskId?: string) {
    const day = addDays(weekStart, dayIndex);
    const start = new Date(day); start.setHours(hour, 0, 0, 0);
    const end   = new Date(day); end.setHours(hour + 1, 0, 0, 0);
    setCreating(true);
    try {
      const res = await fetch("/api/calendar/events", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, start: start.toISOString(), end: end.toISOString() }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`✓ "${title}" added to calendar`);
        fetchEvents();
        // Mark the task as scheduled
        if (taskId) {
          fetch("/api/calendar/scheduled", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId, taskName: title, eventId: data.event?.id }),
          }).catch(() => {});
          setScheduledIds(prev => new Set(prev).add(taskId));
        }
      } else {
        showToast(data.error ?? "Failed to create event", false);
      }
    } finally {
      setCreating(false);
    }
  }

  // ── Events for a specific slot ────────────────────────────────────────────────
  function slotEvents(dayIndex: number, hour: number): CalEvent[] {
    const day = addDays(weekStart, dayIndex);
    return events.filter(e => {
      const dt = e.start.dateTime;
      if (!dt) return false;
      const s = new Date(dt);
      return s.getFullYear() === day.getFullYear() &&
             s.getMonth()     === day.getMonth() &&
             s.getDate()      === day.getDate() &&
             s.getHours()     === hour;
    });
  }

  // ── Sidebar data + filtering ──────────────────────────────────────────────────
  const projectOptions = projects.map(p => ({ id: String(p.id), label: p.client }));

  const allOpenTasks = projects.flatMap(p =>
    p.tasks
      .filter(t => !isDone(t))
      .map(t => ({ task: t, projectLabel: p.label, projectId: String(p.id) }))
  );

  const now = Date.now();
  // Match logged-in user to ClickUp assignees by name (first name or full name)
  const myFullName  = (session?.user?.name ?? "").toLowerCase();
  const myFirstName = myFullName.split(" ")[0];

  const openTasks = allOpenTasks.filter(({ task, projectId }) => {
    // My tasks filter
    if (filterMine) {
      const assigned = task.assignees.some(a => {
        const u = a.username.toLowerCase();
        return u === myFullName || (myFirstName && u === myFirstName) || (myFirstName && u.startsWith(myFirstName));
      });
      if (!assigned) return false;
    }
    // Scheduled filter
    if (filterScheduled === "scheduled"   && !scheduledIds.has(task.id)) return false;
    if (filterScheduled === "unscheduled" &&  scheduledIds.has(task.id)) return false;
    // Project filter
    if (filterProject !== "all" && projectId !== filterProject) return false;
    // Due date filter
    if (filterDue !== "all") {
      const due = task.due_date ? parseInt(task.due_date) : null;
      if (filterDue === "none"    && due !== null) return false;
      if (filterDue === "overdue" && (due === null || due >= now)) return false;
      if (filterDue === "today") {
        if (!due) return false;
        const diff = Math.round((due - now) / 86400000);
        if (diff !== 0) return false;
      }
      if (filterDue === "week") {
        if (!due) return false;
        const diff = Math.round((due - now) / 86400000);
        if (diff < 0 || diff > 7) return false;
      }
    }
    return true;
  });

  const openCases = cases.filter(c => c.status !== "Closed" && c.status !== "closed");

  // ── Derived ───────────────────────────────────────────────────────────────────
  const weekEnd = addDays(weekStart, 6);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: checking
  if (calendarReady === null) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: C.textSub, fontSize: 13 }}>
        Loading calendar…
      </div>
    );
  }

  // Render: calendar token missing (shouldn't happen normally — user signed in with Google)
  if (!calendarReady) {
    return (
      <div style={{ padding: "56px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>📅</div>
        <div style={{ fontWeight: 700, fontSize: 17, color: C.text, marginBottom: 8 }}>
          Calendar access needs re-authorisation
        </div>
        <div style={{ fontSize: 13, color: C.textSub, maxWidth: 420, margin: "0 auto 24px" }}>
          Your Google Calendar access has expired or was not granted during sign-in.
          Sign out and sign back in to reconnect.
        </div>
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          style={{
            background: "linear-gradient(135deg, #1A56DB, #2563EB)",
            color: "#fff", border: "none", borderRadius: 10,
            padding: "12px 32px", fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: C.font,
            boxShadow: "0 4px 14px rgba(26,86,219,0.35)",
          }}
        >
          Re-authorise Google Calendar
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: connected — full calendar view
  return (
    <div style={{ display: "flex", height: "calc(100vh - 180px)", minHeight: 540, overflow: "hidden", position: "relative" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)",
          background: toast.ok ? "#0F172A" : C.red, color: "#fff",
          borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600,
          zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          whiteSpace: "nowrap",
        }}>
          {toast.msg}
        </div>
      )}

      {creating && (
        <div style={{
          position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)",
          background: "#1A56DB", color: "#fff", borderRadius: 8, padding: "10px 20px",
          fontSize: 13, fontWeight: 600, zIndex: 999,
        }}>
          Creating event…
        </div>
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <div style={{
        width: 268, flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        background: C.alt,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Sidebar header */}
        <div style={{ padding: "12px 14px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 2 }}>Schedule Items</div>
          <div style={{ fontSize: 11, color: C.textSub, marginBottom: 8 }}>Drag onto a time slot to create an event</div>

          {/* ── Filters ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>

            {/* My Tasks toggle */}
            <button
              onClick={() => setFilterMine(f => !f)}
              style={{
                padding: "5px 10px", fontSize: 11, fontWeight: 700,
                borderRadius: 6, cursor: "pointer", fontFamily: C.font,
                border: `1px solid ${filterMine ? C.blue : C.border}`,
                background: filterMine ? C.blue : "#fff",
                color: filterMine ? "#fff" : C.textMid,
                textAlign: "left",
              }}
            >
              👤 {filterMine ? "My Tasks only" : "Show all assignees"}
            </button>

            {/* Schedule status */}
            <div style={{ display: "flex", gap: 3 }}>
              {(["all", "unscheduled", "scheduled"] as const).map(v => (
                <button key={v} onClick={() => setFilterScheduled(v)} style={{
                  flex: 1, padding: "3px 0", fontSize: 10, fontWeight: 600,
                  borderRadius: 4, border: `1px solid ${filterScheduled === v ? C.blue : C.border}`,
                  background: filterScheduled === v ? C.blueBg : "#fff",
                  color: filterScheduled === v ? C.blue : C.textSub,
                  cursor: "pointer", fontFamily: C.font,
                }}>
                  {v === "all" ? "All" : v === "unscheduled" ? "⬜ Pending" : "✓ Scheduled"}
                </button>
              ))}
            </div>

            {/* Due date */}
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {([
                { v: "all",     label: "Any date" },
                { v: "overdue", label: "⚠ Overdue" },
                { v: "today",   label: "Today" },
                { v: "week",    label: "This week" },
                { v: "none",    label: "No date" },
              ] as const).map(({ v, label }) => (
                <button key={v} onClick={() => setFilterDue(v)} style={{
                  padding: "3px 6px", fontSize: 10, fontWeight: 600,
                  borderRadius: 4, border: `1px solid ${filterDue === v ? C.blue : C.border}`,
                  background: filterDue === v ? C.blueBg : "#fff",
                  color: filterDue === v ? C.blue : C.textSub,
                  cursor: "pointer", fontFamily: C.font, whiteSpace: "nowrap",
                }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Project */}
            <select
              value={filterProject}
              onChange={e => setFilterProject(e.target.value)}
              style={{
                width: "100%", padding: "4px 6px", fontSize: 11,
                border: `1px solid ${filterProject !== "all" ? C.blue : C.border}`,
                borderRadius: 4, background: filterProject !== "all" ? C.blueBg : "#fff",
                color: filterProject !== "all" ? C.blue : C.textMid,
                fontFamily: C.font, cursor: "pointer",
              }}
            >
              <option value="all">All projects</option>
              {projectOptions.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {/* Result count */}
            <div style={{ fontSize: 10, color: C.textSub, display: "flex", justifyContent: "space-between" }}>
              <span>{openTasks.length} task{openTasks.length !== 1 ? "s" : ""} shown</span>
              {(filterMine || filterScheduled !== "all" || filterDue !== "all" || filterProject !== "all") && (
                <button onClick={() => { setFilterMine(false); setFilterScheduled("all"); setFilterDue("all"); setFilterProject("all"); }}
                  style={{ background: "none", border: "none", fontSize: 10, color: C.blue, cursor: "pointer", padding: 0, fontFamily: C.font }}>
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 0 }}>
            {(["tasks", "cases"] as const).map(st => (
              <button
                key={st}
                onClick={() => setSidebarTab(st)}
                style={{
                  flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 700,
                  background: "none", border: "none",
                  borderBottom: sidebarTab === st ? `2px solid ${C.blue}` : "2px solid transparent",
                  color: sidebarTab === st ? C.blue : C.textSub,
                  cursor: "pointer", fontFamily: C.font, textTransform: "capitalize",
                }}
              >
                {st === "tasks" ? `Tasks (${openTasks.length})` : `Cases (${openCases.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Sidebar list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 14px" }}>
          {sidebarTab === "tasks" && (
            openTasks.length === 0
              ? <div style={{ fontSize: 11, color: C.textSub, fontStyle: "italic", padding: "8px 4px" }}>No open tasks</div>
              : openTasks.map(({ task, projectLabel }) => {
                  const due = task.due_date ? parseInt(task.due_date) : null;
                  const diff = due ? due - Date.now() : null;
                  const days = diff !== null ? Math.round(diff / 86400000) : null;
                  const dueColor = days === null ? C.textSub : days < 0 ? C.red : days === 0 ? C.orange : days <= 3 ? C.yellow : C.textSub;
                  const dueLabel = days === null ? null : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`;
                  const st = task.status.status.toLowerCase();
                  const isScheduled = scheduledIds.has(task.id);
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => { dragRef.current = { type: "task", task, projectLabel }; }}
                      style={{
                        padding: "8px 10px", marginBottom: 5, borderRadius: 7,
                        background: isScheduled ? "#F0FDF4" : "#fff",
                        border: `1px solid ${isScheduled ? C.greenBd : C.border}`,
                        cursor: "grab", fontSize: 11, color: C.text, lineHeight: 1.4,
                        userSelect: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 3, lineHeight: 1.35, display: "flex", alignItems: "flex-start", gap: 5 }}>
                        <span style={{ flex: 1 }}>{task.name}</span>
                        {isScheduled && <span style={{ fontSize: 9, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>✓ Scheduled</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, borderRadius: 3, padding: "1px 5px",
                          background: C.alt, color: C.textMid, border: `1px solid ${C.border}`,
                          textTransform: "uppercase", letterSpacing: "0.04em",
                        }}>
                          {st}
                        </span>
                        <span style={{ fontSize: 10, color: C.textSub }}>{projectLabel.split(" — ")[0]}</span>
                        {dueLabel && (
                          <span style={{ fontSize: 10, color: dueColor, fontWeight: 600, marginLeft: "auto" }}>{dueLabel}</span>
                        )}
                      </div>
                      {task.assignees.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 10, color: C.textSub }}>
                          {task.assignees.map(a => a.username).join(", ")}
                        </div>
                      )}
                    </div>
                  );
                })
          )}

          {sidebarTab === "cases" && (
            openCases.length === 0
              ? <div style={{ fontSize: 11, color: C.textSub, fontStyle: "italic", padding: "8px 4px" }}>No open cases</div>
              : openCases.map(c => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => { dragRef.current = { type: "case", caseNumber: c.caseNumber, caseTitle: c.title, company: c.company }; }}
                    style={{
                      padding: "8px 10px", marginBottom: 5, borderRadius: 7,
                      background: "#fff", border: `1px solid ${C.border}`,
                      cursor: "grab", fontSize: 11, color: C.text, lineHeight: 1.4,
                      userSelect: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 3, lineHeight: 1.35 }}>
                      <span style={{ color: C.textSub }}>#{c.caseNumber} · </span>{c.title}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, borderRadius: 3, padding: "1px 5px",
                        background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeBd}`,
                      }}>{c.status}</span>
                      <span style={{ fontSize: 10, color: C.textSub }}>{c.company}</span>
                    </div>
                    {c.assigned && (
                      <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>{c.assigned}</div>
                    )}
                  </div>
                ))
          )}
        </div>
      </div>

      {/* ── Calendar ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff" }}>

        {/* Week nav */}
        <div style={{
          padding: "10px 16px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setWeekStart(d => addDays(d, -7))}
              style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 11px", cursor: "pointer", fontSize: 14, color: C.textMid, fontFamily: C.font }}
            >‹</button>
            <button
              onClick={() => setWeekStart(getMondayOf(new Date()))}
              style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.textMid, fontFamily: C.font }}
            >Today</button>
            <button
              onClick={() => setWeekStart(d => addDays(d, 7))}
              style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 11px", cursor: "pointer", fontSize: 14, color: C.textMid, fontFamily: C.font }}
            >›</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text, marginLeft: 6 }}>
              {fmtDay(weekStart)} – {fmtDay(weekEnd)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {loadingEvents && (
              <span style={{ fontSize: 11, color: C.textSub, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Loading events…
              </span>
            )}
            <button
              onClick={fetchEvents}
              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: C.textMid, fontFamily: C.font }}
            >↻</button>
            <button
              onClick={() => signIn("google", { callbackUrl: "/" })}
              style={{ background: "none", border: "none", fontSize: 11, color: C.textSub, cursor: "pointer", fontFamily: C.font, textDecoration: "underline", textDecorationStyle: "dotted" }}
              title="Re-authorise Google Calendar"
            >Reconnect</button>
          </div>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 640 }}>
            <colgroup>
              <col style={{ width: 52 }} />
              {DAY_NAMES.map(d => <col key={d} />)}
            </colgroup>

            {/* Day headers */}
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr>
                <th style={{ padding: "8px 4px", border: `1px solid ${C.border}`, background: C.alt }} />
                {DAY_NAMES.map((name, i) => {
                  const date  = addDays(weekStart, i);
                  const today = isToday(date);
                  return (
                    <th
                      key={name}
                      style={{
                        padding: "8px 6px", border: `1px solid ${C.border}`,
                        background: today ? "#EBF5FF" : C.alt,
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 600, color: today ? C.blue : C.textSub, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {name}
                      </div>
                      <div style={{
                        fontSize: 15, fontWeight: today ? 800 : 600,
                        lineHeight: 1.2,
                        width: 28, height: 28, borderRadius: "50%",
                        background: today ? C.blue : "transparent",
                        color: today ? "#fff" : C.text,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        margin: "2px auto 0",
                      }}>
                        {date.getDate()}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* Hour rows */}
            <tbody>
              {HOURS.map(hour => (
                <tr key={hour} style={{ height: 68 }}>
                  {/* Time label */}
                  <td style={{
                    padding: "4px 6px 0 4px", border: `1px solid ${C.border}`,
                    fontSize: 10, color: C.textSub, textAlign: "right",
                    background: C.alt, verticalAlign: "top", whiteSpace: "nowrap",
                  }}>
                    {fmtHour(hour)}
                  </td>

                  {/* Day cells */}
                  {DAY_NAMES.map((_, dayIndex) => {
                    const key  = `${dayIndex}-${hour}`;
                    const over = dropTarget === key;
                    const date = addDays(weekStart, dayIndex);
                    const today = isToday(date);
                    const cellEvents = slotEvents(dayIndex, hour);

                    return (
                      <td
                        key={dayIndex}
                        onDragOver={e => { e.preventDefault(); setDropTarget(key); }}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={e => {
                          e.preventDefault();
                          setDropTarget(null);
                          const item = dragRef.current;
                          if (!item) return;
                          dragRef.current = null;
                          if (item.type === "task") {
                            createEvent(
                              item.task.name,
                              `Task from ${item.projectLabel}\n${item.task.url}`,
                              dayIndex,
                              hour,
                              item.task.id,
                            );
                          } else {
                            createEvent(
                              `#${item.caseNumber}: ${item.caseTitle}`,
                              `Support case — ${item.company}`,
                              dayIndex,
                              hour,
                            );
                          }
                        }}
                        style={{
                          border: `1px solid ${C.border}`,
                          verticalAlign: "top",
                          background: over
                            ? "#DBEAFE"
                            : today
                            ? "rgba(235,245,255,0.35)"
                            : "#fff",
                          padding: 3,
                          transition: "background 0.1s",
                          cursor: "default",
                          outline: over ? `2px solid ${C.blue}` : "none",
                          outlineOffset: -2,
                          position: "relative",
                        }}
                      >
                        {over && (
                          <div style={{
                            position: "absolute", inset: 2,
                            border: `2px dashed ${C.blue}`,
                            borderRadius: 5, pointerEvents: "none",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, color: C.blue, fontWeight: 700,
                          }}>
                            Drop to schedule
                          </div>
                        )}
                        {!over && cellEvents.map(ev => (
                          <a
                            key={ev.id}
                            href={ev.htmlLink ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={ev.summary}
                            style={{
                              display: "block", fontSize: 10, fontWeight: 600,
                              background: C.blueBg, color: C.blue,
                              border: `1px solid ${C.blueBd}`,
                              borderRadius: 4, padding: "2px 6px",
                              marginBottom: 2, overflow: "hidden",
                              whiteSpace: "nowrap", textOverflow: "ellipsis",
                              textDecoration: "none",
                            }}
                          >
                            {ev.summary ?? "(untitled)"}
                          </a>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
