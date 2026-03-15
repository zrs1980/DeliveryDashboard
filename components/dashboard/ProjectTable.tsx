"use client";
import { useState } from "react";
import { C } from "@/lib/constants";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LinkBtn } from "@/components/ui/LinkBtn";
import { HealthBadge } from "@/components/health/HealthBadge";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { fmtH, fmtPct, fmtD } from "@/lib/health";
import type { Project, ProjectNote } from "@/lib/types";

interface Props {
  projects: Project[];
  onProjectsChange: (updated: Project[]) => void;
}

const hColor = (h: string) => h === "green" ? C.green : h === "yellow" ? C.yellow : C.red;

const th: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: C.textSub,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
};

export function ProjectTable({ projects, onProjectsChange }: Props) {
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());

  function toggleNotes(id: number) {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleNotesChange(projectId: number, updated: ProjectNote[]) {
    onProjectsChange(
      projects.map(p => p.id === projectId ? { ...p, notes: updated } : p)
    );
  }

  if (projects.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textSub }}>
        No active projects found.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
        <thead>
          <tr style={{ background: C.alt }}>
            <th style={th}>Client — Project</th>
            <th style={th}>PM</th>
            <th style={th}>Type</th>
            <th style={{ ...th, minWidth: 130 }}>Progress</th>
            <th style={th}>Hours</th>
            <th style={th}>SPI</th>
            <th style={th}>Budget Gap</th>
            <th style={th}>Go-Live</th>
            <th style={th}>Notes</th>
            <th style={th}>Links</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p, i) => {
            const spiColor  = p.spi >= 1 ? C.green : p.spi >= 0.85 ? C.yellow : C.red;
            const gapColor  = p.budgetGap > 0.15 ? C.red : p.budgetGap > 0.05 ? C.yellow : C.green;
            const gapStr    = (p.budgetGap > 0 ? "+" : "") + fmtPct(p.budgetGap);
            const rowBg     = i % 2 === 0 ? C.surface : C.alt;
            const notesOpen = expandedNotes.has(p.id);
            const noteCount = p.notes.length;

            return (
              <>
                <tr key={p.id} style={{ background: rowBg }}>
                  {/* Client — Project */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <HealthBadge health={p.health} size="sm" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{p.client}</div>
                        <div style={{ fontSize: 11, color: C.textSub }}># {p.entityid}</div>
                      </div>
                      {p.timebillWarning && (
                        <span title="Timebill total exceeds remaining hours by >20h" style={{ fontSize: 13 }}>⚠️</span>
                      )}
                    </div>
                  </td>

                  {/* PM */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}`, fontSize: 12, color: C.textMid, whiteSpace: "nowrap" }}>
                    {p.pm}
                  </td>

                  {/* Type */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}` }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "2px 6px",
                      background: p.projectType === "Implementation" ? C.purpleBg : C.blueBg,
                      color: p.projectType === "Implementation" ? C.purple : C.blue,
                      border: `1px solid ${p.projectType === "Implementation" ? C.purpleBd : C.blueBd}`,
                    }}>
                      {p.projectType === "Implementation" ? "Impl" : "Svc"}
                    </span>
                  </td>

                  {/* Progress */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}`, minWidth: 130 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <ProgressBar val={p.pct} burn={p.burnRate} color={hColor(p.health)} h={6} />
                      </div>
                      <span style={{ fontSize: 12, fontFamily: C.mono, fontWeight: 600, color: hColor(p.health), minWidth: 36 }}>
                        {fmtPct(p.pct)}
                      </span>
                    </div>
                  </td>

                  {/* Hours */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}` }}>
                    <div style={{ fontFamily: C.mono, fontSize: 12, color: C.text, fontWeight: 600 }}>
                      {fmtH(p.actual)} / {fmtH(p.actual + p.rem)}
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: 11, color: p.rem < 15 ? C.red : C.textSub }}>
                      {fmtH(p.rem)} left
                    </div>
                  </td>

                  {/* SPI */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}` }}>
                    <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: spiColor }}>
                      {p.spi.toFixed(2)}
                    </span>
                  </td>

                  {/* Budget Gap */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}` }}>
                    <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: gapColor }}>
                      {gapStr}
                    </span>
                  </td>

                  {/* Go-Live */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                    {p.goliveDate ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                          {new Date(p.goliveDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" })}
                        </div>
                        <div style={{ fontSize: 11, color: p.isOverdue ? C.red : C.textSub, fontWeight: p.isOverdue ? 700 : 400 }}>
                          {fmtD(p.daysLeft)}
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>⚠ No date</span>
                    )}
                  </td>

                  {/* Notes */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => toggleNotes(p.id)}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 5,
                        cursor: "pointer", fontFamily: C.font,
                        background: notesOpen ? C.yellowBg : noteCount > 0 ? C.blueBg : C.alt,
                        color: notesOpen ? C.yellow : noteCount > 0 ? C.blue : C.textSub,
                        border: `1px solid ${notesOpen ? C.yellowBd : noteCount > 0 ? C.blueBd : C.border}`,
                      }}
                    >
                      📝 {noteCount > 0 ? `${noteCount} Note${noteCount !== 1 ? "s" : ""}` : "Notes"}
                      <span style={{ marginLeft: 4 }}>{notesOpen ? "▲" : "▼"}</span>
                    </button>
                  </td>

                  {/* Links */}
                  <td style={{ padding: "10px 12px", borderBottom: notesOpen ? "none" : `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <LinkBtn href={p.nsUrl} color={C.purple} bg={C.purpleBg} bd={C.purpleBd} label="NetSuite" />
                      {p.clickupUrl && (
                        <LinkBtn href={p.clickupUrl} color={C.blue} bg={C.blueBg} bd={C.blueBd} label="ClickUp" />
                      )}
                      {p.clickupError && (
                        <span
                          title={p.clickupError}
                          style={{ fontSize: 10, color: C.orange, cursor: "help" }}
                        >
                          ⚠ CU: {p.clickupError.slice(0, 40)}{p.clickupError.length > 40 ? "…" : ""}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Inline notes expansion row */}
                {notesOpen && (
                  <tr key={`notes-${p.id}`} style={{ background: rowBg }}>
                    <td colSpan={10} style={{ borderBottom: `1px solid ${C.border}`, padding: 0 }}>
                      <NotesPanel
                        projectId={p.id}
                        notes={p.notes}
                        onNotesChange={updated => handleNotesChange(p.id, updated)}
                      />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
