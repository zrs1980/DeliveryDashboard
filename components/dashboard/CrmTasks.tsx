"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── Tasks ──────────────────────────────────────────────────────────────────
//
// Entirely native — NetSuite exposes no task, call or event data to this
// integration, so there is nothing to sync and nothing overwrites these.
//
// ON COLOUR: overdue is red, due today is amber. Both are hard facts about a
// date, not inferences about health, so they cannot cry wolf — and a task list
// where nothing stands out is a task list nobody works from.

interface Task {
  id: string; title: string; notes: string | null;
  task_type: string; priority: string; status: string;
  due_date: string | null; assigned_to: string | null;
  customer_ns_id: string | null; opportunity_id: string | null;
  isOverdue: boolean; isDueToday: boolean;
}

const TYPE_ICON: Record<string, string> = {
  todo: "☐", call: "📞", email: "✉", meeting: "👥", follow_up: "↻",
};

export default function CrmTasks({ customerNsId }: { customerNsId?: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<{ open: number; overdue: number; today: number } | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(!customerNsId);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", dueDate: "", taskType: "todo", priority: "normal", notes: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (mine)         p.set("mine", "1");
      if (customerNsId) p.set("customerNsId", customerNsId);
      if (showDone)     p.set("done", "1");
      const res  = await fetch(`/api/crm/tasks?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setTasks(json.tasks ?? []);
      setCounts(json.counts ?? null);
      setTypes(json.types ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, [mine, customerNsId, showDone]);

  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id); setError(null);
    try {
      const res = await fetch("/api/crm/tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  async function create() {
    if (!draft.title.trim()) return;
    setBusy("new"); setError(null);
    try {
      const res = await fetch("/api/crm/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, customerNsId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setDraft({ title: "", dueDate: "", taskType: "todo", priority: "normal", notes: "" });
      setAdding(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {counts && (
          <span style={{ fontSize: 12, color: C.textSub }}>
            {counts.open} open
            {counts.overdue > 0 && <strong style={{ color: C.red }}> · {counts.overdue} overdue</strong>}
            {counts.today > 0 && <strong style={{ color: C.yellow }}> · {counts.today} due today</strong>}
          </span>
        )}
        {!customerNsId && (
          <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: C.textMid }}>
            <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />
            Mine only
          </label>
        )}
        <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: C.textMid }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          Show done
        </label>
        <button onClick={() => setAdding(a => !a)} style={{ marginLeft: "auto", ...btn(C.blue, true) }}>
          {adding ? "Cancel" : "+ Task"}
        </button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      {adding && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: 12, marginBottom: 12 }}>
          <input
            autoFocus value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter" && draft.title.trim()) create(); }}
            placeholder="What needs doing?"
            style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: `1px solid ${C.mid}`,
                     borderRadius: 6, fontFamily: C.font, marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={draft.taskType} onChange={e => setDraft({ ...draft, taskType: e.target.value })} style={inp}>
              {types.map(t => <option key={t} value={t}>{TYPE_ICON[t] ?? ""} {t.replace(/_/g, " ")}</option>)}
            </select>
            <select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })} style={inp}>
              <option value="low">low</option><option value="normal">normal</option><option value="high">high</option>
            </select>
            <input type="date" value={draft.dueDate}
                   onChange={e => setDraft({ ...draft, dueDate: e.target.value })} style={inp} />
            <button onClick={create} disabled={busy === "new" || !draft.title.trim()}
                    style={{ ...btn(C.blue, true), opacity: draft.title.trim() ? 1 : 0.5 }}>
              {busy === "new" ? "…" : "Add"}
            </button>
          </div>
          {!customerNsId && (
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 7 }}>
              Added from here the task is yours and unattached to an account. Open a customer
              first to file it against one.
            </div>
          )}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div style={{ padding: "28px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>
          Nothing outstanding.
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        {tasks.map(t => {
          const done = t.status === "done" || t.status === "cancelled";
          const edge = t.isOverdue ? C.red : t.isDueToday ? C.yellow : C.border;
          return (
            <div key={t.id} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              border: `1px solid ${C.border}`, borderLeft: `3px solid ${edge}`,
              borderRadius: 8, background: C.surface, padding: "9px 12px",
              opacity: busy === t.id ? 0.5 : done ? 0.55 : 1,
            }}>
              <input
                type="checkbox" checked={done}
                onChange={() => patch(t.id, { status: done ? "open" : "done" })}
                style={{ marginTop: 3, cursor: "pointer" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 500,
                              textDecoration: done ? "line-through" : "none" }}>
                  <span style={{ marginRight: 6 }}>{TYPE_ICON[t.task_type] ?? "☐"}</span>
                  {t.title}
                </div>
                <div style={{ display: "flex", gap: 9, marginTop: 3, flexWrap: "wrap", alignItems: "baseline" }}>
                  {t.due_date && (
                    <span style={{ fontSize: 11, fontFamily: C.mono,
                                   color: t.isOverdue ? C.red : t.isDueToday ? C.yellow : C.textSub,
                                   fontWeight: t.isOverdue || t.isDueToday ? 700 : 400 }}>
                      {t.isOverdue ? "overdue " : t.isDueToday ? "today " : ""}{t.due_date}
                    </span>
                  )}
                  {t.priority === "high" && (
                    <span style={{ fontSize: 10, color: C.orange, background: C.orangeBg,
                                   border: `1px solid ${C.orangeBd}`, borderRadius: 3, padding: "0 5px" }}>
                      high
                    </span>
                  )}
                  {t.assigned_to && (
                    <span style={{ fontSize: 11, color: C.textSub }}>{t.assigned_to}</span>
                  )}
                </div>
                {t.notes && <div style={{ fontSize: 12, color: C.textMid, marginTop: 4 }}>{t.notes}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: "5px 9px", fontSize: 12, border: `1px solid ${C.mid}`,
  borderRadius: 6, fontFamily: C.font, background: C.surface,
};
const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
