"use client";
import { useState, useEffect, useMemo } from "react";
import { C } from "@/lib/constants";
import { isDone } from "@/lib/clickup";
import type { CUTask, Project } from "@/lib/types";

/**
 * "Create Task" on the Tasks tab — creates one task in the chosen project's
 * ClickUp list through /api/clickup/tasks.
 *
 * Assignees are the list's ClickUp members and sections are the options of the
 * list's "Phase (v4)" field, both loaded per project because every list can
 * differ (one active list has no phase field at all).
 */

interface Props {
  /** Already sorted for the dropdown. */
  projects: Project[];
  defaultProjectId: number | null;
  onClose: () => void;
  onCreated: (projectId: number, task: CUTask) => void;
}

interface Member { id: number; username: string; email: string | null }
interface SectionOption { id: string; label: string; orderindex: number | null }
interface Section { fieldId: string; isMulti: boolean; options: SectionOption[] }
interface ListOptions { listId: string; members: Member[]; section: Section | null; sectionError: string | null }

const PRIORITIES = [
  { value: "",  label: "No priority" },
  { value: "1", label: "Urgent" },
  { value: "2", label: "High" },
  { value: "3", label: "Normal" },
  { value: "4", label: "Low" },
];

/** Local "YYYY-MM-DD" → Unix ms at local noon, same as the grid's inline due-date edit. */
function dueFromInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12).getTime();
}

/**
 * Whether a loaded task sits in a section. The tasks come through /api/projects
 * untouched, so ClickUp's custom_fields are on them even though CUTask doesn't
 * declare it. A labels field holds option ids; a drop_down holds the option's
 * orderindex — both are checked.
 */
function inSection(task: CUTask, fieldId: string, option: SectionOption): boolean {
  const fields = (task as CUTask & { custom_fields?: Array<{ id: string; value?: unknown }> }).custom_fields;
  const value = fields?.find(f => f.id === fieldId)?.value;
  if (value == null) return false;
  return (Array.isArray(value) ? value : [value]).some(v =>
    String(v) === option.id || (option.orderindex != null && Number(v) === option.orderindex));
}

/** The list id ClickUp itself put on the project's tasks — already resolved, unlike custentity20. */
function knownListId(p: Project): string | null {
  return p.tasks.find(t => t.list?.id)?.list.id ?? null;
}

const label: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: C.textSub,
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4,
};
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 13,
  fontFamily: C.font, color: C.text, background: C.surface,
  border: `1px solid ${C.border}`, borderRadius: 5,
};

export function CreateTaskModal({ projects, defaultProjectId, onClose, onCreated }: Props) {
  const usable = useMemo(() => projects.filter(p => knownListId(p) || p.clickupUrl), [projects]);

  const [projectId,   setProjectId]   = useState<number | "">(
    defaultProjectId && usable.some(p => p.id === defaultProjectId) ? defaultProjectId : "",
  );
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [priority,    setPriority]    = useState("");
  const [assignees,   setAssignees]   = useState<number[]>([]);
  const [due,         setDue]         = useState("");
  const [sectionId,   setSectionId]   = useState("");
  const [parentId,    setParentId]    = useState("");
  const [memberQuery, setMemberQuery] = useState("");

  const [options,  setOptions]  = useState<ListOptions | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState<string | null>(null);
  const [created,  setCreated]  = useState<{ task: CUTask; warning: string | null } | null>(null);

  const project = usable.find(p => p.id === projectId) ?? null;

  // Members and sections belong to the project's list — reload on every project change.
  useEffect(() => {
    setOptions(null);
    setLoadErr(null);
    setAssignees([]);
    setSectionId("");
    if (!project) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    const lid = knownListId(project);
    if (lid) qs.set("listId", lid);
    if (project.clickupUrl) qs.set("clickupUrl", project.clickupUrl);
    fetch(`/api/clickup/tasks?${qs}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? `Request failed (${r.status})`);
        return d as ListOptions;
      })
      .then(d => { if (!cancelled) setOptions(d); })
      .catch(e => { if (!cancelled) setLoadErr(e instanceof Error ? e.message : "Request failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const members = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    const all = options?.members ?? [];
    return q ? all.filter(m => m.username.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)) : all;
  }, [options, memberQuery]);

  /**
   * Tasks the new one can sit under: the project's open top-level tasks, narrowed
   * to the chosen section when there is one. Subtasks are left out (ClickUp only
   * nests them when the workspace allows it) and so are done tasks.
   */
  const parentOptions = useMemo(() => {
    if (!project) return [];
    const option = options?.section?.options.find(o => o.id === sectionId) ?? null;
    return project.tasks
      .filter(t => !t.parent && !isDone(t))
      .filter(t => !option || !options?.section || inSection(t, options.section.fieldId, option))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [project, options, sectionId]);

  // A parent picked under one section may not exist under the next.
  useEffect(() => {
    if (parentId && !parentOptions.some(t => t.id === parentId)) setParentId("");
  }, [parentOptions, parentId]);

  const canSave = !!project && !!options && !!name.trim() && !saving;

  async function handleCreate() {
    if (!canSave || !project || !options) return;
    setSaving(true);
    setSaveErr(null);
    const section = options.section && sectionId
      ? { fieldId: options.section.fieldId, optionId: sectionId, isMulti: options.section.isMulti }
      : null;
    try {
      const res = await fetch("/api/clickup/tasks", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId:      options.listId,
          name:        name.trim(),
          description: description.trim(),
          priority:    priority ? parseInt(priority) : null,
          assignees,
          dueDate:     due ? dueFromInput(due) : null,
          section,
          parent:      parentId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setCreated({ task: data.task, warning: data.warning ?? null });
      onCreated(project.id, data.task);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  function resetForAnother() {
    setCreated(null);
    setName("");
    setDescription("");
    setPriority("");
    setAssignees([]);
    setDue("");
    setSectionId("");
    setParentId("");
  }

  const toggleAssignee = (id: number) =>
    setAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999 }} />

      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        zIndex: 1000, width: 600, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)",
        display: "flex", flexDirection: "column",
        background: C.surface, borderRadius: 10, boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        fontFamily: C.font, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.alt,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Create Task in ClickUp</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.textSub, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {created ? (
          <div style={{ padding: "18px" }}>
            <div style={{
              padding: "10px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600,
              background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}`,
            }}>
              ✓ Created “{created.task.name}”{project ? ` in ${project.label}` : ""}
              {created.task.url && (
                <> · <a href={created.task.url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>↗ Open in ClickUp</a></>
              )}
            </div>
            {created.warning && (
              <div style={{
                marginTop: 8, padding: "8px 12px", borderRadius: 6, fontSize: 12,
                background: C.yellowBg, color: C.yellow, border: `1px solid ${C.yellowBd}`,
              }}>
                {created.warning}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: "14px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <span style={label}>Project *</span>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value ? Number(e.target.value) : "")}
                style={input}
              >
                <option value="">Select a project…</option>
                {usable.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {loading && <div style={{ marginTop: 4, fontSize: 11, color: C.textSub }}>Loading the project’s ClickUp list…</div>}
              {loadErr && <div style={{ marginTop: 4, fontSize: 12, color: C.red }}>{loadErr}</div>}
            </div>

            <div>
              <span style={label}>Name *</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Task name" style={input} autoFocus />
            </div>

            <div>
              <span style={label}>Description</span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                style={{ ...input, resize: "vertical", lineHeight: 1.5 }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <span style={label}>Priority</span>
                <select value={priority} onChange={e => setPriority(e.target.value)} style={input}>
                  {PRIORITIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <span style={label}>Due date</span>
                <input type="date" value={due} onChange={e => setDue(e.target.value)} style={input} />
              </div>
            </div>

            <div>
              <span style={label}>Project section</span>
              <select
                value={sectionId}
                onChange={e => setSectionId(e.target.value)}
                disabled={!options?.section}
                style={{ ...input, opacity: options?.section ? 1 : 0.6 }}
              >
                <option value="">{options?.section ? "No section" : "—"}</option>
                {options?.section?.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {options && !options.section && (
                <div style={{ marginTop: 4, fontSize: 11, color: C.textSub }}>
                  {options.sectionError
                    ? `Couldn't load sections: ${options.sectionError}`
                    : "This ClickUp list has no “Phase (v4)” field, so there are no sections to pick."}
                </div>
              )}
            </div>

            <div>
              <span style={label}>Parent task</span>
              <select
                value={parentId}
                onChange={e => setParentId(e.target.value)}
                disabled={!options}
                style={{ ...input, opacity: options ? 1 : 0.6 }}
              >
                <option value="">None — create as a standalone task</option>
                {parentOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {options && (
                <div style={{ marginTop: 4, fontSize: 11, color: C.textSub }}>
                  {parentOptions.length === 0
                    ? (sectionId ? "No open tasks in this section to nest under." : "No open tasks in this project to nest under.")
                    : `${parentOptions.length} open task${parentOptions.length === 1 ? "" : "s"}${sectionId ? " in this section" : " in this project"}`}
                </div>
              )}
            </div>

            <div>
              <span style={label}>Assignees {assignees.length > 0 && `(${assignees.length})`}</span>
              {!options ? (
                <div style={{ fontSize: 12, color: C.textSub }}>{project ? "—" : "Pick a project first."}</div>
              ) : (
                <>
                  <input
                    value={memberQuery}
                    onChange={e => setMemberQuery(e.target.value)}
                    placeholder="Search people…"
                    style={{ ...input, marginBottom: 6 }}
                  />
                  <div style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 5 }}>
                    {members.length === 0 && (
                      <div style={{ padding: "6px 8px", fontSize: 12, color: C.textSub }}>No matching members on this list.</div>
                    )}
                    {members.map(m => (
                      <label
                        key={m.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                          fontSize: 12, color: C.text, cursor: "pointer",
                          background: assignees.includes(m.id) ? C.blueBg : "transparent",
                        }}
                      >
                        <input type="checkbox" checked={assignees.includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                        {m.username}
                        {m.email && <span style={{ color: C.textSub, fontSize: 11 }}>{m.email}</span>}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {saveErr && (
              <div style={{
                padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, whiteSpace: "pre-wrap",
              }}>
                {saveErr}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          padding: "12px 18px", borderTop: `1px solid ${C.border}`,
        }}>
          {created && (
            <button
              onClick={resetForAnother}
              style={{
                padding: "6px 16px", fontSize: 13, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${C.blueBd}`, background: C.blueBg, color: C.blue,
                cursor: "pointer", fontFamily: C.font,
              }}
            >
              + Create another
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px", fontSize: 13, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${C.border}`, background: C.surface, color: C.textMid,
              cursor: "pointer", fontFamily: C.font,
            }}
          >
            {created ? "Close" : "Cancel"}
          </button>
          {!created && (
            <button
              onClick={handleCreate}
              disabled={!canSave}
              style={{
                padding: "6px 16px", fontSize: 13, fontWeight: 700, borderRadius: 5, border: "none",
                background: canSave ? C.blue : C.textSub, color: "#fff",
                cursor: canSave ? "pointer" : "not-allowed", fontFamily: C.font,
                opacity: canSave ? 1 : 0.7,
              }}
            >
              {saving ? "Creating…" : "Create Task"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
