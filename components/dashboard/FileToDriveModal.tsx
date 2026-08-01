"use client";
// ─── File a meeting to Google Drive ───────────────────────────────────────────
// Confirm customer → confirm project → create the Doc. Claude suggests the
// customer; nothing is written to Drive until the PM approves the destination.

import { useCallback, useEffect, useState } from "react";
import { C } from "@/lib/constants";
import { meetingDocName } from "@/lib/meeting-doc";

interface Attendee { name: string; email: string; internal: boolean }
interface Summary {
  overview?: string; shortSummary?: string;
  actionItems: string[]; keywords: string[]; bulletGist: string[];
}
export interface FileableMeeting {
  id: string; title: string; date: string; durationMinutes: number;
  organizerEmail: string; meetingLink: string | null; transcriptUrl: string | null;
  attendees: Attendee[]; summary: Summary | null;
}

interface Folder { id: string; name: string }
interface Candidate { folderId: string; folderName: string; score: number; reason: string }

type Step = "customer" | "project" | "done";

export function FileToDriveModal({ meeting, onClose }: { meeting: FileableMeeting; onClose: () => void }) {
  const [step, setStep] = useState<Step>("customer");

  const [matching, setMatching]   = useState(true);
  const [best, setBest]           = useState<Candidate | null>(null);
  const [alts, setAlts]           = useState<Candidate[]>([]);
  const [allCustomers, setAll]    = useState<Folder[]>([]);
  const [matchSource, setSource]  = useState<"ai" | "fuzzy">("fuzzy");
  const [matchNote, setNote]      = useState<string | null>(null);
  const [showAll, setShowAll]     = useState(false);

  const [customer, setCustomer]   = useState<Folder | null>(null);
  const [projects, setProjects]   = useState<Folder[]>([]);
  const [projectsFolder, setPF]   = useState<Folder | null>(null);
  const [fellBack, setFellBack]   = useState(false);
  const [loadingProjects, setLP]  = useState(false);
  const [project, setProject]     = useState<Folder | null>(null);

  const [includeTranscript, setIncludeTx] = useState(true);
  const [creating, setCreating]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [needsReauth, setReauth]  = useState(false);
  const [result, setResult]       = useState<{ url: string; name: string; path: string; lines: number; note: string | null } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !creating) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, creating]);

  // ── Step 1: ask for a match ──
  useEffect(() => {
    (async () => {
      setMatching(true); setError(null); setReauth(false);
      try {
        const res = await fetch("/api/drive/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: meeting.title,
            attendees: meeting.attendees.map(a => ({ name: a.name, email: a.email })),
            overview: meeting.summary?.overview ?? meeting.summary?.shortSummary,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setReauth(!!data.needsReauth); throw new Error(data.error ?? "Could not match a customer"); }
        setBest(data.best ?? null);
        setAlts(data.alternatives ?? []);
        setAll(data.allCustomers ?? []);
        setSource(data.source ?? "fuzzy");
        setNote(data.note ?? null);
        if (data.best) setCustomer({ id: data.best.folderId, name: data.best.folderName });
        else setShowAll(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally { setMatching(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  // ── Step 2: projects for the chosen customer ──
  const loadProjects = useCallback(async (c: Folder) => {
    setLP(true); setError(null); setProject(null);
    try {
      const res  = await fetch(`/api/drive/projects?customerId=${encodeURIComponent(c.id)}`);
      const data = await res.json();
      if (!res.ok) { setReauth(!!data.needsReauth); throw new Error(data.error ?? "Could not list projects"); }
      setProjects(data.projects ?? []);
      setPF(data.projectsFolder ?? null);
      setFellBack(!!data.fellBackToCustomerFolder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setProjects([]);
    } finally { setLP(false); }
  }, []);

  function confirmCustomer() {
    if (!customer) return;
    setStep("project");
    loadProjects(customer);
  }

  async function create() {
    if (!project || !customer) return;
    setCreating(true); setError(null);
    try {
      const res = await fetch("/api/drive/meeting-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: project.id,
          meeting,
          customerName: customer.name,
          projectName: project.name,
          includeTranscript,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setReauth(!!data.needsReauth); throw new Error(data.error ?? "Could not create the document"); }
      setResult({
        url:   data.doc?.webViewLink ?? "",
        name:  data.doc?.name ?? "",
        path:  data.folderPath ?? "",
        lines: data.transcriptLines ?? 0,
        note:  data.note ?? null,
      });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setCreating(false); }
  }

  const btn: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font,
  };
  const primary: React.CSSProperties = { ...btn, background: C.blue, color: "#fff", borderColor: C.blue, fontWeight: 700 };

  const confidenceChip = (score: number) => {
    const pct = Math.round(score * 100);
    const [bg, fg, bd, label] =
      score >= 0.85 ? [C.greenBg, C.green, C.greenBd, "high confidence"] :
      score >= 0.5  ? [C.yellowBg, C.yellow, C.yellowBd, "worth checking"] :
                      [C.redBg, C.red, C.redBd, "low confidence"];
    return (
      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: bg, color: fg, border: `1px solid ${bd}` }}>
        {pct}% · {label}
      </span>
    );
  };

  const externals = meeting.attendees.filter(a => !a.internal);
  const docName   = meetingDocName(meeting);

  return (
    <>
      <div onClick={() => !creating && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1300 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(620px, 94vw)", maxHeight: "88vh", background: C.surface, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.25)", zIndex: 1301, display: "flex", flexDirection: "column", fontFamily: C.font }}>

        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>File to Google Drive</div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {meeting.title}
              </div>
            </div>
            {!creating && (
              <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 21, cursor: "pointer", color: C.textSub, lineHeight: 1, padding: 0 }}>×</button>
            )}
          </div>

          {/* Step rail */}
          <div style={{ display: "flex", gap: 6, marginTop: 14, alignItems: "center" }}>
            {([["customer", "1 Customer"], ["project", "2 Project"], ["done", "3 Filed"]] as const).map(([id, label], i) => {
              const order = ["customer", "project", "done"];
              const active = step === id;
              const past   = order.indexOf(step) > i;
              return (
                <span key={id} style={{ fontSize: 11, fontWeight: active ? 700 : 600, padding: "3px 10px", borderRadius: 999, background: active ? C.blueBg : past ? C.greenBg : C.alt, color: active ? C.blue : past ? C.green : C.textSub, border: `1px solid ${active ? C.blueBd : past ? C.greenBd : C.border}` }}>
                  {past ? "✓" : ""} {label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", minHeight: 0 }}>
          {error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "11px 14px", color: C.red, fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>⚠ {needsReauth ? "Google needs re-authorising" : "Something went wrong"}</div>
              {error}
              {needsReauth && (
                <div style={{ marginTop: 8, color: C.textMid }}>
                  Drive access was added recently, and existing sessions carry the older permissions.
                  Sign out and sign back in, then try again.
                </div>
              )}
            </div>
          )}

          {/* ── Step 1: customer ── */}
          {step === "customer" && (
            <div>
              {matching ? (
                <div style={{ padding: "26px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                  Matching this meeting to a customer folder…
                </div>
              ) : (
                <>
                  {externals.length > 0 && (
                    <div style={{ fontSize: 12, color: C.textSub, marginBottom: 12, lineHeight: 1.6 }}>
                      Matching on {externals.length} external attendee{externals.length !== 1 ? "s" : ""}:{" "}
                      <span style={{ color: C.textMid }}>{externals.map(a => a.email || a.name).join(", ")}</span>
                    </div>
                  )}

                  {matchNote && (
                    <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, borderRadius: 8, padding: "10px 13px", color: C.yellow, fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}>
                      {matchNote}
                    </div>
                  )}

                  {best && (
                    <div
                      onClick={() => setCustomer({ id: best.folderId, name: best.folderName })}
                      style={{ border: `2px solid ${customer?.id === best.folderId ? C.blue : C.border}`, background: customer?.id === best.folderId ? C.blueBg : C.surface, borderRadius: 10, padding: "13px 15px", cursor: "pointer", marginBottom: 12 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {matchSource === "ai" ? "✨ Claude suggests" : "Best name match"}
                        </span>
                        {confidenceChip(best.score)}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{best.folderName}</div>
                      {best.reason && <div style={{ fontSize: 12, color: C.textMid, marginTop: 3, lineHeight: 1.5 }}>{best.reason}</div>}
                    </div>
                  )}

                  {alts.length > 0 && !showAll && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>
                        Other possibilities
                      </div>
                      {alts.map(a => (
                        <div
                          key={a.folderId}
                          onClick={() => setCustomer({ id: a.folderId, name: a.folderName })}
                          style={{ border: `1px solid ${customer?.id === a.folderId ? C.blue : C.border}`, background: customer?.id === a.folderId ? C.blueBg : C.surface, borderRadius: 8, padding: "9px 13px", cursor: "pointer", marginBottom: 6 }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.folderName}</div>
                          {a.reason && <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2 }}>{a.reason}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {showAll ? (
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>
                        All customer folders ({allCustomers.length})
                      </div>
                      <select
                        value={customer?.id ?? ""}
                        onChange={e => {
                          const f = allCustomers.find(c => c.id === e.target.value);
                          setCustomer(f ? { id: f.id, name: f.name } : null);
                        }}
                        style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: C.surface, color: C.text, outline: "none" }}
                      >
                        <option value="">Choose a customer…</option>
                        {allCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  ) : (
                    <button onClick={() => setShowAll(true)} style={{ ...btn, background: "none", border: "none", color: C.blue, padding: 0, fontSize: 12 }}>
                      None of these — pick from all {allCustomers.length} customers
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step 2: project ── */}
          {step === "project" && (
            <div>
              <div style={{ fontSize: 12.5, color: C.textMid, marginBottom: 14 }}>
                Customer: <strong>{customer?.name}</strong>
                {projectsFolder && <span style={{ color: C.textSub }}> › {projectsFolder.name}</span>}
              </div>

              {fellBack && (
                <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, borderRadius: 8, padding: "10px 13px", color: C.yellow, fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}>
                  No “Projects” folder inside <strong>{customer?.name}</strong>, so these are that customer&apos;s own
                  subfolders. Check you&apos;re filing at the right level.
                </div>
              )}

              {loadingProjects ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>Loading project folders…</div>
              ) : projects.length === 0 ? (
                <div style={{ padding: "20px 0", textAlign: "center", color: C.textSub, fontSize: 12.5, lineHeight: 1.6 }}>
                  No subfolders found for this customer.<br />Create a project folder in Drive, then try again.
                </div>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  {projects.map(p => (
                    <div
                      key={p.id}
                      onClick={() => setProject(p)}
                      style={{ border: `1px solid ${project?.id === p.id ? C.blue : C.border}`, background: project?.id === p.id ? C.blueBg : C.surface, borderRadius: 8, padding: "10px 13px", cursor: "pointer", marginBottom: 6, display: "flex", alignItems: "center", gap: 9 }}
                    >
                      <span style={{ fontSize: 14 }}>📁</span>
                      <span style={{ fontSize: 13, fontWeight: project?.id === p.id ? 700 : 500, color: C.text }}>{p.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* What will be filed */}
              {project && (
                <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 9, padding: "13px 15px" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Will create
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3 }}>📄 {docName}</div>
                  <div style={{ fontSize: 11.5, color: C.textSub, marginBottom: 10 }}>
                    in {customer?.name}{projectsFolder ? ` › ${projectsFolder.name}` : ""} › {project.name}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.7 }}>
                    Contents: meeting details and attendees
                    {meeting.summary ? ", summary" : ""}
                    {(meeting.summary?.actionItems.length ?? 0) > 0 ? `, ${meeting.summary!.actionItems.length} action items` : ""}
                    {includeTranscript ? ", full transcript" : ""}.
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: C.textMid, cursor: "pointer" }}>
                    <input type="checkbox" checked={includeTranscript} onChange={e => setIncludeTx(e.target.checked)} style={{ accentColor: C.blue }} />
                    Include the full transcript
                  </label>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: done ── */}
          {step === "done" && result && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 34, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Filed to Drive</div>
              <div style={{ fontSize: 12.5, color: C.textMid, marginBottom: 4 }}>{result.name}</div>
              {result.path && <div style={{ fontSize: 11.5, color: C.textSub, marginBottom: 12 }}>{result.path}</div>}
              {result.lines > 0 && (
                <div style={{ fontSize: 11.5, color: C.textSub, marginBottom: 12 }}>{result.lines.toLocaleString()} transcript lines included</div>
              )}
              {result.note && (
                <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, borderRadius: 8, padding: "10px 13px", color: C.yellow, fontSize: 12, lineHeight: 1.6, marginBottom: 14, textAlign: "left" }}>
                  {result.note}
                </div>
              )}
              {result.url && (
                <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ ...primary, display: "inline-block", textDecoration: "none" }}>
                  ↗ Open the document
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "13px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
          {step === "project" ? (
            <button onClick={() => setStep("customer")} disabled={creating} style={btn}>← Back</button>
          ) : <span />}

          <div style={{ display: "flex", gap: 8 }}>
            {step !== "done" && <button onClick={onClose} disabled={creating} style={btn}>Cancel</button>}
            {step === "customer" && (
              <button onClick={confirmCustomer} disabled={!customer || matching} style={{ ...primary, opacity: !customer || matching ? 0.55 : 1, cursor: !customer || matching ? "not-allowed" : "pointer" }}>
                Next →
              </button>
            )}
            {step === "project" && (
              <button onClick={create} disabled={!project || creating} style={{ ...primary, opacity: !project || creating ? 0.55 : 1, cursor: !project || creating ? "not-allowed" : "pointer" }}>
                {creating ? "Creating…" : "Create document"}
              </button>
            )}
            {step === "done" && <button onClick={onClose} style={primary}>Done</button>}
          </div>
        </div>
      </div>
    </>
  );
}
