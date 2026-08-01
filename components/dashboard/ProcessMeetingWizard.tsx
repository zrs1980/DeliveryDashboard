"use client";
// ─── Process meeting ──────────────────────────────────────────────────────────
// Replaces the Fireflies grid's one-shot "Create" button. Four steps, each of
// which can be skipped independently:
//
//   1. Action items  → ClickUp tasks under Phase (v4) = "8. Internal Action Points"
//   2. Key details   → Slack post to the project's custentity_slack_channel
//   3. File          → Google Doc in the project's Drive Transcripts folder
//   4. Done          → links to everything that was created
//
// All three destinations come from the NetSuite project picked on the grid row,
// so a project missing one of them blocks only that step.

import { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/constants";
import { meetingDocName } from "@/lib/meeting-doc";

export interface WizardMeeting {
  id: string; title: string; date: string; durationMinutes: number;
  organizerEmail: string; meetingLink: string | null; transcriptUrl: string | null;
  attendees: { name: string; email: string; internal: boolean }[];
  summary: {
    overview?: string; shortSummary?: string;
    actionItems: string[]; keywords: string[]; bulletGist: string[];
  } | null;
}

export interface WizardProject {
  id: number; label: string;
  folderUrl: string | null; hasFolder: boolean;
  clickupUrl: string | null; hasClickUp: boolean;
  slackChannel: string | null; hasSlack: boolean;
}

/** What a previous run already did to this meeting, from `meeting_processing`. */
export interface WizardProcessing {
  clickup_tasks?: { id: string; name: string; url: string }[] | null;
  slack_channel?: string | null;
  doc_url?: string | null;
  doc_name?: string | null;
}

export interface WizardFiledDoc {
  fireflies_id: string; doc_url: string; doc_name: string;
  meeting_type: string; project_label: string | null;
  created_at: string; created_by: string | null;
}

interface ActionItem {
  id: string; name: string; description: string; owner: string; selected: boolean;
}

type Step = "analyse" | "actions" | "summary" | "file" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "actions", label: "Action items" },
  { key: "summary", label: "Key details" },
  { key: "file",    label: "File to Drive" },
  { key: "done",    label: "Done" },
];

export function ProcessMeetingWizard({
  meeting, project, meetingType, existingDoc, existingProcessing, onClose, onFiled, onProcessed,
}: {
  meeting: WizardMeeting;
  project: WizardProject;
  meetingType: string;
  existingDoc?: WizardFiledDoc;
  existingProcessing?: WizardProcessing;
  onClose: () => void;
  onFiled: (doc: WizardFiledDoc) => void;
  /** Tells the grid to re-read processing state so the row's chips update. */
  onProcessed: () => void;
}) {
  const [step, setStep] = useState<Step>("analyse");

  // Step 0 — analysis
  const [analysing, setAnalysing] = useState(false);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);

  const [items, setItems]           = useState<ActionItem[]>([]);
  const [keyDetails, setKeyDetails] = useState("");

  // Step 1 — ClickUp
  const [cuBusy, setCuBusy]       = useState(false);
  const [cuErr, setCuErr]         = useState<string | null>(null);
  const [cuWarn, setCuWarn]       = useState<string | null>(null);
  // Seeded from a previous run so re-opening a processed meeting shows what
  // already happened instead of implying nothing has.
  const [cuCreated, setCuCreated] = useState<{ name: string; url: string }[]>(
    existingProcessing?.clickup_tasks ?? [],
  );
  const [cuFailed, setCuFailed]   = useState<{ name: string; error: string }[]>([]);

  // Step 2 — Slack
  const [slackBusy, setSlackBusy]     = useState(false);
  const [slackErr, setSlackErr]       = useState<string | null>(null);
  const [slackWarn, setSlackWarn]     = useState<string | null>(null);
  const [slackPosted, setSlackPosted] = useState<string | null>(
    existingProcessing?.slack_channel ?? null,
  );

  // Step 3 — Drive
  const [docBusy, setDocBusy] = useState(false);
  const [docErr, setDocErr]   = useState<string | null>(null);
  const [docNote, setDocNote] = useState<string | null>(null);
  const [doc, setDoc]         = useState<WizardFiledDoc | null>(
    existingDoc
      ?? (existingProcessing?.doc_url
        ? {
            fireflies_id: meeting.id,
            doc_url:  existingProcessing.doc_url,
            doc_name: existingProcessing.doc_name ?? "",
            meeting_type: meetingType, project_label: project.label,
            created_at: "", created_by: null,
          }
        : null),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Analyse on open ────────────────────────────────────────────────────────
  const analyse = useCallback(async () => {
    setAnalysing(true); setAnalysisErr(null); setAnalysisNote(null);
    try {
      const res = await fetch("/api/meetings/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting: {
            id: meeting.id, title: meeting.title, date: meeting.date,
            attendees: meeting.attendees, summary: meeting.summary,
          },
          projectLabel: project.label,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not analyse the meeting");

      setItems((data.actionItems ?? []).map((a: { id: string; name: string; description: string; owner: string }) => ({
        ...a, selected: true,
      })));
      setKeyDetails(data.keyDetails ?? "");
      setAnalysisNote(data.note ?? null);
      setStep("actions");
    } catch (e) {
      setAnalysisErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setAnalysing(false);
    }
  }, [meeting, project.label]);

  useEffect(() => { analyse(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const selected     = useMemo(() => items.filter(i => i.selected && i.name.trim()), [items]);
  const allSelected  = items.length > 0 && items.every(i => i.selected);
  const someSelected = items.some(i => i.selected);

  const patch = (id: string, next: Partial<ActionItem>) =>
    setItems(list => list.map(i => (i.id === id ? { ...i, ...next } : i)));

  // ── Step 1 → create ClickUp tasks ──────────────────────────────────────────
  const createTasks = async () => {
    if (selected.length === 0) { setStep("summary"); return; }
    setCuBusy(true); setCuErr(null); setCuWarn(null);
    try {
      const res = await fetch("/api/clickup/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clickupUrl:   project.clickupUrl,
          firefliesId:  meeting.id,
          meetingTitle: meeting.title,
          meetingDate:  meeting.date,
          meetingType,
          projectNsId:  String(project.id),
          projectLabel: project.label,
          tasks: selected.map(i => ({
            name:        i.name,
            description: i.owner ? `${i.description}\n\nRaised by: ${i.owner}` : i.description,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the ClickUp tasks");

      setCuCreated(data.created ?? []);
      setCuFailed(data.failed ?? []);
      setCuWarn(data.warning ?? null);
      onProcessed();
      // A partial failure keeps the PM on this step so the misses are visible.
      if ((data.failed ?? []).length === 0) setStep("summary");
    } catch (e) {
      setCuErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCuBusy(false);
    }
  };

  // ── Step 2 → post to Slack ─────────────────────────────────────────────────
  const postSummary = async () => {
    if (!keyDetails.trim()) { setStep("file"); return; }
    setSlackBusy(true); setSlackErr(null);
    try {
      const res = await fetch("/api/slack/meeting-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel:        project.slackChannel,
          summary:        keyDetails,
          firefliesId:    meeting.id,
          meetingTitle:   meeting.title,
          meetingDate:    fmtDate(meeting.date),
          meetingDateIso: meeting.date,
          meetingType,
          projectNsId:    String(project.id),
          projectLabel:   project.label,
          docUrl:         doc?.doc_url,
          taskCount:      cuCreated.length,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not post to Slack");
      setSlackPosted(data.channel ?? project.slackChannel);
      setSlackWarn(data.warning ?? null);
      onProcessed();
      setStep("file");
    } catch (e) {
      setSlackErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSlackBusy(false);
    }
  };

  // ── Step 3 → file to Drive ─────────────────────────────────────────────────
  const fileToDrive = async () => {
    setDocBusy(true); setDocErr(null); setDocNote(null);
    try {
      const res = await fetch("/api/meeting-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting: {
            id: meeting.id, title: meeting.title, date: meeting.date,
            durationMinutes: meeting.durationMinutes, organizerEmail: meeting.organizerEmail,
            meetingLink: meeting.meetingLink, transcriptUrl: meeting.transcriptUrl,
            attendees: meeting.attendees, summary: meeting.summary,
          },
          projectNsId:      String(project.id),
          projectLabel:     project.label,
          projectFolderUrl: project.folderUrl,
          meetingType,
        }),
      });
      const data = await res.json();

      // 409 means someone else filed it first — adopt their link rather than erroring.
      if (res.status === 409 && data.doc) {
        const adopted = { ...data.doc, fireflies_id: meeting.id } as WizardFiledDoc;
        setDoc(adopted); onFiled(adopted); onProcessed(); setStep("done");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not create the document");

      const filed: WizardFiledDoc = {
        fireflies_id:  meeting.id,
        doc_url:       data.doc?.webViewLink ?? "",
        doc_name:      data.doc?.name ?? "",
        meeting_type:  meetingType,
        project_label: project.label,
        created_at:    new Date().toISOString(),
        created_by:    null,
      };
      setDoc(filed); onFiled(filed); onProcessed(); setDocNote(data.note ?? null); setStep("done");
    } catch (e) {
      setDocErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setDocBusy(false);
    }
  };

  const filename = useMemo(
    () => meetingDocName({ title: meeting.title, date: meeting.date, meetingType }),
    [meeting.title, meeting.date, meetingType],
  );

  const stepIndex = STEPS.findIndex(s => s.key === step);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1300 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(860px, 94vw)", maxHeight: "90vh", background: C.surface,
        border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shMd,
        zIndex: 1301, display: "flex", flexDirection: "column", fontFamily: C.font,
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={meeting.title}>
                {meeting.title}
              </div>
              <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 3 }}>
                {project.label} · {meetingType} · {fmtDate(meeting.date)}
              </div>
            </div>
            <button onClick={onClose} title="Close (Esc)" style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: C.textSub, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
          </div>

          {/* Step rail */}
          <div style={{ display: "flex", gap: 6, margin: "14px 0 0", paddingBottom: 12 }}>
            {STEPS.map((s, i) => {
              const done   = stepIndex > i;
              const active = stepIndex === i;
              return (
                <div key={s.key} style={{
                  flex: 1, padding: "6px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700,
                  textAlign: "center",
                  background: active ? C.blueBg : done ? C.greenBg : C.alt,
                  color:      active ? C.blue   : done ? C.green   : C.textSub,
                  border: `1px solid ${active ? C.blueBd : done ? C.greenBd : C.border}`,
                }}>
                  {done ? "✓ " : `${i + 1}. `}{s.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", minHeight: 0 }}>
          {step === "analyse" && (
            <div style={{ textAlign: "center", padding: "50px 10px" }}>
              {analysisErr ? (
                <Banner tone="red" title="⚠ Could not analyse the meeting">
                  {analysisErr}
                  <div><button onClick={analyse} style={btn(C.surface, C.textMid, C.border)}>Try again</button></div>
                </Banner>
              ) : (
                <>
                  <div style={{ fontSize: 30, marginBottom: 12 }}>🧠</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid }}>
                    {analysing ? "Reading the transcript and drafting action items…" : "Preparing…"}
                  </div>
                  <div style={{ fontSize: 12, color: C.textSub, marginTop: 6 }}>This usually takes 10–30 seconds.</div>
                </>
              )}
            </div>
          )}

          {step === "actions" && (
            <>
              <StepHead
                title="Review action items"
                sub={`Tick the ones to create in ClickUp. Each becomes a task under Phase (v4) → 8. Internal Action Points.`}
              />
              {analysisNote && <Banner tone="yellow">{analysisNote}</Banner>}
              {!project.hasClickUp && (
                <Banner tone="yellow" title="No ClickUp list for this project">
                  <strong>custentity20</strong> isn&apos;t set on the NetSuite project, so tasks can&apos;t be created. Skip this step, or set the field and refresh.
                </Banner>
              )}
              {cuErr && <Banner tone="red" title="⚠ Could not create the tasks">{cuErr}</Banner>}
              {cuWarn && <Banner tone="yellow">{cuWarn}</Banner>}
              {cuFailed.length > 0 && (
                <Banner tone="red" title={`${cuFailed.length} task${cuFailed.length === 1 ? "" : "s"} failed`}>
                  {cuFailed.map((f, i) => <div key={i}>· {f.name} — {f.error}</div>)}
                  {cuCreated.length > 0 && <div style={{ marginTop: 6 }}>{cuCreated.length} were created successfully.</div>}
                </Banner>
              )}

              {items.length > 0 && (
                <label style={{
                  display: "flex", alignItems: "center", gap: 9, cursor: "pointer",
                  padding: "7px 12px", marginBottom: 10, borderRadius: 8,
                  background: C.alt, border: `1px solid ${C.border}`,
                  fontSize: 12, fontWeight: 700, color: C.textMid, userSelect: "none",
                }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={e => {
                      const next = e.target.checked;
                      setItems(l => l.map(i => ({ ...i, selected: next })));
                    }}
                    style={{ cursor: "pointer", width: 15, height: 15 }}
                  />
                  {allSelected ? "Deselect all" : "Select all"}
                  <span style={{ fontWeight: 500, color: C.textSub }}>
                    · {selected.length} of {items.length} selected
                  </span>
                </label>
              )}

              {items.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 10px", color: C.textSub, fontSize: 13 }}>
                  No internal action items were found in this meeting. You can add one, or skip this step.
                </div>
              ) : (
                items.map(item => (
                  <div key={item.id} style={{
                    border: `1px solid ${item.selected ? C.blueBd : C.border}`,
                    background: item.selected ? C.surface : C.alt,
                    borderRadius: 9, padding: "11px 13px", marginBottom: 9,
                  }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={e => patch(item.id, { selected: e.target.checked })}
                        style={{ marginTop: 6, cursor: "pointer", flexShrink: 0, width: 15, height: 15 }}
                        aria-label={`Create "${item.name}" in ClickUp`}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <input
                          value={item.name}
                          onChange={e => patch(item.id, { name: e.target.value })}
                          placeholder="Task name"
                          style={{ ...field, fontWeight: 700, fontSize: 13 }}
                        />
                        <textarea
                          value={item.description}
                          onChange={e => patch(item.id, { description: e.target.value })}
                          placeholder="Detailed description"
                          rows={3}
                          style={{ ...field, marginTop: 6, resize: "vertical", lineHeight: 1.55 }}
                        />
                        {item.owner && (
                          <div style={{ fontSize: 10.5, color: C.textSub, marginTop: 5 }}>Raised by {item.owner}</div>
                        )}
                      </div>
                      <button
                        onClick={() => setItems(l => l.filter(i => i.id !== item.id))}
                        title="Remove this action item"
                        style={{ background: "none", border: "none", color: C.textSub, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}
                      >×</button>
                    </div>
                  </div>
                ))
              )}

              <button
                onClick={() => setItems(l => [...l, {
                  id: `manual-${l.length}-${Math.random().toString(36).slice(2, 7)}`,
                  name: "", description: "", owner: "", selected: true,
                }])}
                style={{ ...btn(C.alt, C.textMid, C.border), marginTop: 2 }}
              >
                + Add an action item
              </button>
            </>
          )}

          {step === "summary" && (
            <>
              <StepHead
                title="Key details for the project manager"
                sub={project.hasSlack
                  ? `A PM-level narrative — timelines, meetings, decisions and risks, not task detail. Posts to ${project.slackChannel} and notifies the channel.`
                  : "A PM-level narrative — timelines, meetings, decisions and risks, not task detail."}
              />
              {cuCreated.length > 0 && (
                <Banner tone="green" title={`✓ ${cuCreated.length} ClickUp task${cuCreated.length === 1 ? "" : "s"} created`}>
                  {cuCreated.map((t, i) => (
                    <div key={i}>· <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>{t.name}</a></div>
                  ))}
                </Banner>
              )}
              {!project.hasSlack && (
                <Banner tone="yellow" title="No Slack channel for this project">
                  <strong>custentity_slack_channel</strong> isn&apos;t set on the NetSuite project, so this can&apos;t be posted. Skip this step, or set the field and refresh.
                </Banner>
              )}
              {slackErr && <Banner tone="red" title="⚠ Could not post to Slack">{slackErr}</Banner>}

              <textarea
                value={keyDetails}
                onChange={e => setKeyDetails(e.target.value)}
                rows={14}
                placeholder="What happened on this call, what it means for the project, and what needs the PM's attention…"
                style={{ ...field, fontSize: 13, lineHeight: 1.65, resize: "vertical" }}
              />
            </>
          )}

          {step === "file" && (
            <>
              <StepHead
                title="File the transcript to Google Drive"
                sub="Creates a Google Doc with the notes, action items and full transcript in the project's Transcripts folder."
              />
              {slackPosted && <Banner tone="green" title={`✓ Posted to ${slackPosted}`} />}
              {slackWarn && <Banner tone="yellow">{slackWarn}</Banner>}
              {!project.hasFolder && (
                <Banner tone="yellow" title="No Drive folder for this project">
                  <strong>custentity_project_folder</strong> isn&apos;t set on the NetSuite project, so the document can&apos;t be filed. Set the field and refresh.
                </Banner>
              )}
              {docErr && <Banner tone="red" title="⚠ Could not create the document">{docErr}</Banner>}

              <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 9, padding: "12px 15px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>
                  Document name
                </div>
                <div style={{ fontFamily: C.mono, fontSize: 12.5, color: C.text, wordBreak: "break-word" }}>{filename}</div>
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <StepHead title="All done" sub="Everything that was created for this meeting." />
              <Summary label="ClickUp tasks">
                {cuCreated.length === 0
                  ? <Muted>Skipped — no tasks created.</Muted>
                  : cuCreated.map((t, i) => (
                      <div key={i} style={{ marginBottom: 3 }}>
                        · <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>{t.name}</a>
                      </div>
                    ))}
              </Summary>
              <Summary label="Slack">
                {slackPosted ? <span style={{ color: C.green }}>Posted to {slackPosted}</span> : <Muted>Skipped.</Muted>}
              </Summary>
              <Summary label="Google Drive">
                {doc?.doc_url
                  ? <a href={doc.doc_url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>{doc.doc_name || "Open document"}</a>
                  : <Muted>Skipped — not filed.</Muted>}
              </Summary>
              {docNote && <Banner tone="yellow">{docNote}</Banner>}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "13px 22px", borderTop: `1px solid ${C.border}`, background: C.alt,
          borderRadius: "0 0 14px 14px", display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 10, flexShrink: 0,
        }}>
          <div style={{ fontSize: 11.5, color: C.textSub }}>
            {step === "actions" && items.length > 0 && `${selected.length} of ${items.length} selected`}
            {step === "file" && doc && "Already filed"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {step === "actions" && (
              <>
                <button onClick={() => setStep("summary")} disabled={cuBusy} style={btn(C.surface, C.textMid, C.border)}>Skip</button>
                <button
                  onClick={createTasks}
                  disabled={cuBusy || (selected.length > 0 && !project.hasClickUp)}
                  style={btn(C.blue, "#fff", C.blue, cuBusy || (selected.length > 0 && !project.hasClickUp))}
                >
                  {cuBusy
                    ? "Creating & confirming phase…"
                    : selected.length === 0 ? "Next" : `Create ${selected.length} task${selected.length === 1 ? "" : "s"} →`}
                </button>
              </>
            )}
            {step === "summary" && (
              <>
                <button onClick={() => setStep("file")} disabled={slackBusy} style={btn(C.surface, C.textMid, C.border)}>Skip</button>
                <button
                  onClick={postSummary}
                  disabled={slackBusy || (!!keyDetails.trim() && !project.hasSlack)}
                  style={btn(C.blue, "#fff", C.blue, slackBusy || (!!keyDetails.trim() && !project.hasSlack))}
                >
                  {slackBusy ? "Posting…" : "Post to Slack →"}
                </button>
              </>
            )}
            {step === "file" && (
              <>
                <button onClick={() => setStep("done")} disabled={docBusy} style={btn(C.surface, C.textMid, C.border)}>Skip</button>
                <button
                  onClick={doc ? () => setStep("done") : fileToDrive}
                  disabled={docBusy || (!doc && !project.hasFolder)}
                  style={btn(C.blue, "#fff", C.blue, docBusy || (!doc && !project.hasFolder))}
                >
                  {docBusy ? "Creating…" : doc ? "Continue →" : "Create document →"}
                </button>
              </>
            )}
            {step === "done" && (
              <button onClick={onClose} style={btn(C.blue, "#fff", C.blue)}>Close</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Small presentational helpers ─────────────────────────────────────────────

const field: React.CSSProperties = {
  width: "100%", padding: "7px 9px", borderRadius: 6, border: `1px solid ${C.border}`,
  fontSize: 12.5, fontFamily: C.font, color: C.text, background: C.surface,
  outline: "none", boxSizing: "border-box",
};

function btn(bg: string, color: string, bd: string, disabled = false): React.CSSProperties {
  return {
    padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer", background: disabled ? C.alt : bg,
    color: disabled ? C.mid : color, border: `1px solid ${disabled ? C.border : bd}`,
    fontFamily: C.font,
  };
}

const TONES = {
  red:    { bg: C.redBg,    bd: C.redBd,    fg: C.red },
  yellow: { bg: C.yellowBg, bd: C.yellowBd, fg: C.yellow },
  green:  { bg: C.greenBg,  bd: C.greenBd,  fg: C.green },
} as const;

function Banner({ tone, title, children }: { tone: keyof typeof TONES; title?: string; children?: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: t.fg, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
      {title && <div style={{ fontWeight: 700, marginBottom: children ? 4 : 0 }}>{title}</div>}
      {children}
    </div>
  );
}

function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div>
      <div style={{ fontSize: 12, color: C.textSub, marginTop: 3, lineHeight: 1.55 }}>{sub}</div>
    </div>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) =>
  <span style={{ color: C.textSub }}>{children}</span>;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "Unknown date" : d.toLocaleString("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
