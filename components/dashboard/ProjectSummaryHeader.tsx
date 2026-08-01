"use client";
// ─── Project summary header ───────────────────────────────────────────────────
// The at-a-glance band above the PM drill-down tabs: health, progress against
// burn, hours, schedule and the outbound links, plus the data-integrity warnings
// that are easy to miss when they only live on the portfolio table.

import { C } from "@/lib/constants";
import { fmtD, fmtH, fmtPct } from "@/lib/health";
import { HealthBadge } from "@/components/health/HealthBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LinkBtn } from "@/components/ui/LinkBtn";
import type { Project } from "@/lib/types";

const hColor = (h: string) => (h === "green" ? C.green : h === "yellow" ? C.yellow : C.red);

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ minWidth: 92 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 700, color: color ?? C.text, marginTop: 3, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.textSub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function ProjectSummaryHeader({ project: p }: { project: Project }) {
  const totalH = p.actual + p.rem;

  // Same thresholds as the portfolio table, so a project doesn't look healthier here.
  const spiColor = p.spi >= 1 ? C.green : p.spi >= 0.85 ? C.yellow : C.red;
  const gapColor = p.budgetGap > 0.15 ? C.red : p.budgetGap > 0.05 ? C.yellow : C.green;

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.sh, padding: "15px 20px", marginBottom: 16, fontFamily: C.font }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{p.client}</span>
            <span style={{ color: C.mid }}>·</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.textMid }}>{p.projectName}</span>
            <HealthBadge health={p.health} score={p.score} size="sm" />
          </div>
          <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {p.entityid && <span>#{p.entityid}</span>}
            <span>{p.projectType}</span>
            {p.pm && <span>PM: {p.pm}</span>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {p.nsUrl && <LinkBtn href={p.nsUrl} color={C.purple} bg={C.purpleBg} bd={C.purpleBd} label="NetSuite" />}
          {p.clickupUrl && <LinkBtn href={p.clickupUrl} color={C.blue} bg={C.blueBg} bd={C.blueBd} label="ClickUp" />}
          {p.projectFolderUrl && <LinkBtn href={p.projectFolderUrl} color={C.green} bg={C.greenBg} bd={C.greenBd} label="Drive" />}
        </div>
      </div>

      {/* Progress against burn */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textSub, marginBottom: 4 }}>
          <span><strong style={{ color: C.text }}>{fmtPct(p.pct)}</strong> complete</span>
          <span>burn <strong style={{ color: p.burnRate > p.pct ? C.red : C.textMid }}>{fmtPct(p.burnRate)}</strong></span>
        </div>
        <ProgressBar val={p.pct} burn={p.burnRate} color={hColor(p.health)} h={7} />
      </div>

      {/* Metrics */}
      <div style={{ display: "flex", gap: 22, marginTop: 14, flexWrap: "wrap", paddingTop: 13, borderTop: `1px solid ${C.border}` }}>
        <Metric label="Hours"      value={`${fmtH(p.actual)} / ${fmtH(totalH)}`} sub={`${fmtH(p.rem)} left`} />
        <Metric label="Billable"   value={fmtH(p.billableHours)} sub="logged" />
        <Metric label="SPI"        value={p.spi.toFixed(2)} color={spiColor} sub={p.spi >= 1 ? "on track" : "behind burn"} />
        <Metric label="Budget gap" value={`${p.budgetGap > 0 ? "+" : ""}${fmtPct(p.budgetGap)}`} color={gapColor} sub={p.budgetGap > 0 ? "over-burning" : "within budget"} />
        <Metric
          label="Go-live"
          value={p.goliveDate ? new Date(p.goliveDate).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "2-digit" }) : "Not set"}
          sub={p.goliveDate ? fmtD(p.daysLeft) : "set custentity_project_golive_date"}
          color={p.isOverdue ? C.red : undefined}
        />
        <Metric label="Open tasks" value={String(p.tasks.filter(t => t.status.status.toLowerCase() !== "done").length)} sub={`${p.blocked.length} blocked · ${p.clientPending.length} client`} />
      </div>

      {/* Warnings that are easy to miss elsewhere */}
      {(p.timebillWarning || p.clickupError || !p.goliveDate) && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {p.timebillWarning && (
            <Warn tone="yellow">
              Logged time is well ahead of what NetSuite reports as consumed — <strong>custentity_project_remaining_hours</strong> looks out of date. Treat the hours above as indicative until it&apos;s corrected.
            </Warn>
          )}
          {!p.goliveDate && (
            <Warn tone="yellow">
              No go-live date set on the NetSuite project, so schedule health can&apos;t be calculated. Set <strong>custentity_project_golive_date</strong>.
            </Warn>
          )}
          {p.clickupError && <Warn tone="red">ClickUp tasks could not be loaded: {p.clickupError}</Warn>}
        </div>
      )}
    </div>
  );
}

function Warn({ tone, children }: { tone: "yellow" | "red"; children: React.ReactNode }) {
  const t = tone === "red"
    ? { bg: C.redBg, bd: C.redBd, fg: C.red }
    : { bg: C.yellowBg, bd: C.yellowBd, fg: C.yellow };
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 7, padding: "7px 12px", color: t.fg, fontSize: 11.5, lineHeight: 1.55 }}>
      ⚠ {children}
    </div>
  );
}
