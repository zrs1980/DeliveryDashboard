"use client";
// ─── Weekly Project Status Report — branded PDF deck ──────────────────────────
//
// 16:9 landscape slides styled to match the Loop Services status deck the PM
// already sends (palette sampled from the July 2026 Oxide template). Rendered
// with @react-pdf/renderer so the wizard preview and the downloaded file are
// byte-for-byte the same document.

import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  D, DELIVERABLE_META, MILESTONE_META, SEVERITY_META, STATUS_META,
  budgetTotals, fmtHrs, fmtLong, fmtNum, fmtShort,
  type Bullet, type StatusReport,
} from "@/lib/status-report";

// DM Sans is served from /public/fonts so PDF generation never depends on an
// external font fetch — a failed fetch would throw and break the download.
// In the browser that's a same-origin path; PDF_FONT_DIR lets Node render the
// same document from disk (used by the render check in scripts/).
const FONT_BASE =
  typeof window !== "undefined" ? "/fonts" : (process.env.PDF_FONT_DIR ?? "/fonts");

Font.register({
  family: "DM Sans",
  fonts: [
    { src: `${FONT_BASE}/DMSans-Regular.ttf`, fontWeight: 400 },
    { src: `${FONT_BASE}/DMSans-Medium.ttf`,  fontWeight: 500 },
    { src: `${FONT_BASE}/DMSans-Bold.ttf`,    fontWeight: 700 },
  ],
});
// react-pdf hyphenates aggressively by default, which looks broken in a deck.
Font.registerHyphenationCallback(w => [w]);

const PAGE = { width: 960, height: 540 };   // 13.33in × 7.5in — standard 16:9 deck
const PAD  = 44;

const s = StyleSheet.create({
  page: {
    width: PAGE.width, height: PAGE.height,
    backgroundColor: D.navy, color: D.textOn,
    fontFamily: "DM Sans", fontSize: 11,
    paddingTop: 30, paddingBottom: 34, paddingHorizontal: PAD,
  },
  cover: { backgroundColor: D.navyDeep },

  // ── Header ──
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  eyebrow:   { fontSize: 9, letterSpacing: 1.6, color: D.accentSoft, fontWeight: 700, marginBottom: 4 },
  slideTitle:{ fontSize: 23, fontWeight: 700, color: D.textOn, letterSpacing: -0.3 },
  weekLabel: { fontSize: 10, color: D.textDim, marginTop: 4 },

  // ── Status badge ──
  badge:      { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.2 },
  badgeText:  { fontSize: 13, fontWeight: 700, letterSpacing: 1 },

  // ── Cards ──
  card: {
    backgroundColor: D.card, borderRadius: 10, borderWidth: 1, borderColor: D.cardLine,
    padding: 16,
  },
  cardTitle: { fontSize: 12, fontWeight: 700, color: D.accentSoft, letterSpacing: 0.8, marginBottom: 10 },

  // ── Phase tracker ──
  phaseStrip: { flexDirection: "row", marginBottom: 14 },
  phaseCell:  { flex: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 8, borderWidth: 1 },
  phaseNum:   { fontSize: 8, letterSpacing: 0.9, fontWeight: 700, marginBottom: 2 },
  phaseName:  { fontSize: 10, fontWeight: 500 },

  // ── Body text ──
  para:   { fontSize: 11.5, lineHeight: 1.55, color: D.textFaint },
  dim:    { fontSize: 9.5, color: D.textDim, lineHeight: 1.5 },

  // ── Bullets ──
  bulletRow:  { flexDirection: "row", marginBottom: 8 },
  bulletMark: { width: 14, fontSize: 11, color: D.accentSoft, fontWeight: 700 },
  bulletLead: { fontSize: 10.5, fontWeight: 700, color: D.textOn },
  bulletBody: { fontSize: 10, color: D.textMut, lineHeight: 1.45 },

  // ── Tables ──
  thead: {
    flexDirection: "row", backgroundColor: D.cardAlt,
    borderTopLeftRadius: 7, borderTopRightRadius: 7,
    paddingVertical: 8, paddingHorizontal: 10,
  },
  th: { fontSize: 8.5, fontWeight: 700, color: D.textFaint, letterSpacing: 0.7 },
  tr: {
    flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10,
    borderBottomWidth: 1, borderBottomColor: D.cardLine, alignItems: "flex-start",
  },
  td: { fontSize: 9.5, color: D.textFaint, lineHeight: 1.4 },
  tdMuted: { fontSize: 9, color: D.textDim, lineHeight: 1.4 },
  totalRow: {
    flexDirection: "row", paddingVertical: 9, paddingHorizontal: 10,
    backgroundColor: D.cardAlt, borderBottomLeftRadius: 7, borderBottomRightRadius: 7,
  },
  tdTotal: { fontSize: 10, fontWeight: 700, color: D.textOn },

  // ── Chips ──
  chip:     { paddingVertical: 2.5, paddingHorizontal: 7, borderRadius: 5, borderWidth: 0.8, alignSelf: "flex-start" },
  chipText: { fontSize: 8, fontWeight: 700, letterSpacing: 0.4 },

  // ── Metric tiles ──
  tileRow:  { flexDirection: "row", marginTop: 12 },
  tile: {
    flex: 1, backgroundColor: D.card, borderWidth: 1, borderColor: D.cardLine,
    borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12,
  },
  tileVal:   { fontSize: 18, fontWeight: 700, color: D.textOn },
  tileLabel: { fontSize: 8, color: D.textDim, letterSpacing: 0.6, marginTop: 2 },

  // ── Footer ──
  footer: {
    position: "absolute", bottom: 14, left: PAD, right: PAD,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderTopWidth: 1, borderTopColor: D.cardLine, paddingTop: 7,
  },
  footerText: { fontSize: 8, color: D.textDim },

  overflowNote: { fontSize: 8.5, color: D.textDim, marginTop: 7, fontStyle: "italic" },
});

// ─── Primitives ───────────────────────────────────────────────────────────────

function Chip({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <View style={[s.chip, { borderColor: color, backgroundColor: bg ?? "transparent" }]}>
      <Text style={[s.chipText, { color }]}>{label}</Text>
    </View>
  );
}

function Footer({ report, page }: { report: StatusReport; page: number }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>Loop Services · {report.meta.client}</Text>
      <Text style={s.footerText}>Week ending {fmtLong(report.meta.weekEnding)}</Text>
      <Text style={s.footerText}>{page}</Text>
    </View>
  );
}

function SlideHeader({
  eyebrow, title, week, right,
}: { eyebrow: string; title: string; week?: string; right?: React.ReactNode }) {
  return (
    <View style={s.headerRow}>
      <View>
        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text style={s.slideTitle}>{title}</Text>
        {week && <Text style={s.weekLabel}>{week}</Text>}
      </View>
      {right}
    </View>
  );
}

function StatusBadge({ report }: { report: StatusReport }) {
  const m = STATUS_META[report.recap.overallStatus];
  return (
    <View style={[s.badge, { borderColor: m.color, backgroundColor: m.bg }]}>
      <Text style={[s.badgeText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

function Bullets({ items, max = 6 }: { items: Bullet[]; max?: number }) {
  if (items.length === 0) {
    return <Text style={s.dim}>Nothing recorded for this section.</Text>;
  }
  const shown = items.slice(0, max);
  return (
    <View>
      {shown.map((b, i) => (
        <View key={b.id} style={s.bulletRow}>
          <Text style={s.bulletMark}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.bulletLead}>{b.lead}</Text>
            {!!b.detail && <Text style={s.bulletBody}>{b.detail}</Text>}
          </View>
        </View>
      ))}
      {items.length > max && (
        <Text style={s.overflowNote}>+{items.length - max} further item(s) tracked in ClickUp</Text>
      )}
    </View>
  );
}

// ─── Slide 1 — Cover ──────────────────────────────────────────────────────────

const AGENDA = [
  "Quick recap of project status",
  "Loop deliverables vs customer",
  "Milestones",
  "What's next",
  "Risk review",
  "Budget overview",
  "Recap & action items",
];

function CoverSlide({ report, logoSrc }: { report: StatusReport; logoSrc: string }) {
  const m = report.meta;
  return (
    <Page size={PAGE} style={[s.page, s.cover]} wrap={false}>
      <Image src={logoSrc} style={{ width: 132, height: 44, objectFit: "contain" }} />

      <View style={{ flexDirection: "row", flex: 1, marginTop: 34 }}>
        {/* Left — title block */}
        <View style={{ flex: 1.45, justifyContent: "center", paddingRight: 30 }}>
          <Text style={{ fontSize: 10, letterSpacing: 2, color: D.accentSoft, fontWeight: 700, marginBottom: 12 }}>
            {m.projectType.toUpperCase()} · PROJECT DELIVERY
          </Text>
          <Text style={{ fontSize: 45, fontWeight: 700, lineHeight: 1.12, letterSpacing: -1 }}>
            Weekly Project{"\n"}Status Report
          </Text>

          <View style={{ height: 3, width: 68, backgroundColor: D.accent, marginTop: 22, marginBottom: 18 }} />

          <Text style={{ fontSize: 17, fontWeight: 500, color: D.textFaint }}>{m.client}</Text>
          <Text style={{ fontSize: 12, color: D.textDim, marginTop: 3 }}>{m.projectName}</Text>

          <View style={{ flexDirection: "row", marginTop: 26 }}>
            {[
              { k: "PREPARED BY", v: m.preparedBy },
              { k: "PROJECT MANAGER", v: m.pm || "—" },
              { k: "WEEK ENDING", v: fmtLong(m.weekEnding) },
            ].map(f => (
              <View key={f.k} style={{ marginRight: 34 }}>
                <Text style={{ fontSize: 7.5, letterSpacing: 1, color: D.textDim, marginBottom: 3 }}>{f.k}</Text>
                <Text style={{ fontSize: 11, fontWeight: 500, color: D.textFaint }}>{f.v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Right — status + agenda */}
        <View style={{ flex: 1, justifyContent: "center" }}>
          <View style={{ alignSelf: "flex-start", marginBottom: 20 }}>
            <StatusBadge report={report} />
          </View>

          {m.goLiveDate && (
            <View style={[s.card, { marginBottom: 16, paddingVertical: 12 }]}>
              <Text style={{ fontSize: 7.5, letterSpacing: 1, color: D.textDim, marginBottom: 4 }}>GO-LIVE TARGET</Text>
              <Text style={{ fontSize: 16, fontWeight: 700 }}>{fmtLong(m.goLiveDate)}</Text>
              {m.daysToGoLive != null && (
                <Text style={{ fontSize: 9.5, color: m.daysToGoLive < 0 ? D.red : D.textMut, marginTop: 2 }}>
                  {m.daysToGoLive < 0 ? `${Math.abs(m.daysToGoLive)} days overdue` : `${m.daysToGoLive} days remaining`}
                </Text>
              )}
            </View>
          )}

          <Text style={{ fontSize: 8, letterSpacing: 1.2, color: D.textDim, fontWeight: 700, marginBottom: 9 }}>
            IN THIS REPORT
          </Text>
          {AGENDA.map((a, i) => (
            <View key={a} style={{ flexDirection: "row", marginBottom: 6, alignItems: "center" }}>
              <Text style={{ fontSize: 9.5, color: D.accentSoft, fontWeight: 700, width: 17 }}>{i + 1}</Text>
              <Text style={{ fontSize: 10.5, color: D.textMut }}>{a}</Text>
            </View>
          ))}
        </View>
      </View>
    </Page>
  );
}

// ─── Slide 2 — Quick recap ────────────────────────────────────────────────────

function PhaseStrip({ report }: { report: StatusReport }) {
  return (
    <View style={s.phaseStrip}>
      {report.recap.phaseTracker.map((p, i) => {
        const isCurrent  = p.state === "current";
        const isComplete = p.state === "complete";
        const border = isCurrent ? D.accentSoft : isComplete ? D.green : D.cardLine;
        const bg     = isCurrent ? D.cardAlt     : isComplete ? D.greenDeep : D.card;
        const fg     = isCurrent ? D.textOn      : isComplete ? D.green : D.textDim;
        return (
          <View
            key={p.number}
            style={[s.phaseCell, {
              borderColor: border, backgroundColor: bg,
              marginRight: i < 4 ? 8 : 0,
            }]}
          >
            <Text style={[s.phaseNum, { color: isCurrent ? D.accentSoft : fg }]}>
              PHASE {p.number}{isComplete ? " ✓" : isCurrent ? " • CURRENT" : ""}
            </Text>
            <Text style={[s.phaseName, { color: fg }]}>{p.name}</Text>
          </View>
        );
      })}
    </View>
  );
}

function RecapSlide({ report }: { report: StatusReport }) {
  const r = report.recap;
  const m = r.metrics;

  const tiles = [
    { v: `${Math.round(m.pctComplete * 100)}%`, l: "TASKS COMPLETE" },
    { v: `${m.tasksDone}/${m.tasksTotal}`,      l: "TASKS DONE" },
    { v: String(m.tasksClosedThisWeek),         l: "CLOSED THIS WEEK" },
    { v: fmtHrs(m.hoursLogged),                 l: `OF ${fmtHrs(m.hoursBudget)} BUDGET` },
    { v: fmtHrs(m.hoursRemaining),              l: "HOURS REMAINING" },
    { v: m.spi.toFixed(2),                      l: "SCHEDULE INDEX" },
  ];

  return (
    <Page size={PAGE} style={s.page} wrap={false}>
      <SlideHeader
        eyebrow="1 · QUICK RECAP"
        title="Project Status"
        week={`Week of ${fmtLong(report.meta.weekStarting)}`}
        right={<StatusBadge report={report} />}
      />

      <PhaseStrip report={report} />

      <View style={{ flexDirection: "row", flex: 1 }}>
        <View style={[s.card, { flex: 1.25, marginRight: 12 }]}>
          <Text style={s.cardTitle}>KEY MESSAGE</Text>
          <Text style={s.para}>{r.keyMessage || "No key message recorded."}</Text>
          {!!r.statusReason && (
            <Text style={[s.dim, { marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: D.cardLine }]}>
              {r.statusReason}
            </Text>
          )}
          {r.delta && (
            <Text style={[s.dim, { marginTop: 7 }]}>
              Since {fmtShort(r.delta.prevWeekEnding)}:{" "}
              {r.delta.hoursBurnedThisWeek != null ? `${fmtNum(r.delta.hoursBurnedThisWeek)}h logged` : "hours unchanged"}
              {r.delta.pctPointsGained != null ? `, ${r.delta.pctPointsGained >= 0 ? "+" : ""}${r.delta.pctPointsGained}pp progress` : ""}
              {r.delta.prevOverallStatus && r.delta.prevOverallStatus !== r.overallStatus
                ? `, status moved from ${STATUS_META[r.delta.prevOverallStatus].label}`
                : ""}
            </Text>
          )}
        </View>

        <View style={[s.card, { flex: 1 }]}>
          <Text style={s.cardTitle}>ACCOMPLISHMENTS THIS WEEK</Text>
          <Bullets items={r.accomplishments} max={5} />
        </View>
      </View>

      <View style={s.tileRow}>
        {tiles.map((t, i) => (
          <View key={t.l} style={[s.tile, { marginRight: i < tiles.length - 1 ? 8 : 0 }]}>
            <Text style={s.tileVal}>{t.v}</Text>
            <Text style={s.tileLabel}>{t.l}</Text>
          </View>
        ))}
      </View>

      <Footer report={report} page={2} />
    </Page>
  );
}

// ─── Slide 3 — Deliverables: Loop vs customer ─────────────────────────────────

function DeliverableColumn({
  title, subtitle, accent, items, max = 9,
}: {
  title: string; subtitle: string; accent: string;
  items: StatusReport["deliverables"]["loop"]; max?: number;
}) {
  return (
    <View style={[s.card, { flex: 1, padding: 0, overflow: "hidden" }]}>
      <View style={{ paddingVertical: 11, paddingHorizontal: 14, backgroundColor: D.cardAlt, borderLeftWidth: 3, borderLeftColor: accent }}>
        <Text style={{ fontSize: 12.5, fontWeight: 700, color: D.textOn }}>{title}</Text>
        <Text style={{ fontSize: 8.5, color: D.textDim, marginTop: 2 }}>{subtitle}</Text>
      </View>

      <View style={{ padding: 12, flex: 1 }}>
        {items.length === 0 ? (
          <Text style={s.dim}>No deliverables tracked for this side of the plan this week.</Text>
        ) : (
          <>
            {items.slice(0, max).map(d => {
              const meta = DELIVERABLE_META[d.state];
              return (
                <View
                  key={d.id}
                  style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: D.cardLine }}
                >
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: meta.color, marginTop: 4.5, marginRight: 8 }} />
                  <View style={{ flex: 1, paddingRight: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: 500, color: D.textFaint }}>{d.title}</Text>
                    <Text style={{ fontSize: 8.5, color: D.textDim, marginTop: 1.5 }}>
                      {d.owner}
                      {d.dueDate ? ` · due ${fmtShort(d.dueDate)}` : ""}
                      {d.note ? ` · ${d.note}` : ""}
                    </Text>
                  </View>
                  <Chip label={meta.label} color={meta.color} />
                </View>
              );
            })}
            {items.length > max && (
              <Text style={s.overflowNote}>+{items.length - max} more tracked in ClickUp</Text>
            )}
          </>
        )}
      </View>
    </View>
  );
}

function DeliverablesSlide({ report }: { report: StatusReport }) {
  const { loop, customer } = report.deliverables;
  const done = (xs: typeof loop) => xs.filter(d => d.state === "done").length;

  return (
    <Page size={PAGE} style={s.page} wrap={false}>
      <SlideHeader
        eyebrow="2 · DELIVERABLES"
        title="Loop Services vs Customer"
        week={`Week of ${fmtLong(report.meta.weekStarting)}`}
        right={
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 9, color: D.textDim }}>COMMITMENTS THIS WEEK</Text>
            <Text style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
              {done(loop) + done(customer)}/{loop.length + customer.length} delivered
            </Text>
          </View>
        }
      />

      <View style={{ flexDirection: "row", flex: 1 }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <DeliverableColumn
            title="Loop Services"
            subtitle={`${done(loop)} of ${loop.length} complete · our commitments`}
            accent={D.accentSoft}
            items={loop}
          />
        </View>
        <View style={{ flex: 1 }}>
          <DeliverableColumn
            title={report.meta.client}
            subtitle={`${done(customer)} of ${customer.length} complete · client commitments`}
            accent={D.amber}
            items={customer}
          />
        </View>
      </View>

      <Footer report={report} page={3} />
    </Page>
  );
}

// ─── Slide 4 — Milestones ─────────────────────────────────────────────────────

const MS_COLS = [3.1, 3.4, 1.15, 1.15, 1.3];

function MilestonesSlide({ report }: { report: StatusReport }) {
  const rows = report.milestones;
  const MAX  = 9;

  return (
    <Page size={PAGE} style={s.page} wrap={false}>
      <SlideHeader
        eyebrow="3 · MILESTONES"
        title="Milestone Tracker"
        week={`Week of ${fmtLong(report.meta.weekStarting)}`}
        right={
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 9, color: D.textDim }}>COMPLETE</Text>
            <Text style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
              {rows.filter(m => m.status === "complete").length}/{rows.length}
            </Text>
          </View>
        }
      />

      {rows.length === 0 ? (
        <View style={[s.card, { flex: 1, justifyContent: "center", alignItems: "center" }]}>
          <Text style={s.dim}>
            No milestones are tagged in ClickUp for this project. Tag tasks with `milestone` to populate this slide.
          </Text>
        </View>
      ) : (
        <View>
          <View style={s.thead}>
            <Text style={[s.th, { flex: MS_COLS[0] }]}>MILESTONE</Text>
            <Text style={[s.th, { flex: MS_COLS[1] }]}>HIGHLIGHT</Text>
            <Text style={[s.th, { flex: MS_COLS[2], textAlign: "right" }]}>EST. DUE</Text>
            <Text style={[s.th, { flex: MS_COLS[3], textAlign: "right" }]}>ORIG. DUE</Text>
            <Text style={[s.th, { flex: MS_COLS[4], textAlign: "right" }]}>STATUS</Text>
          </View>

          {rows.slice(0, MAX).map(m => {
            const meta = MILESTONE_META[m.status];
            return (
              <View key={m.id} style={s.tr}>
                <Text style={[s.td, { flex: MS_COLS[0], fontWeight: 500, paddingRight: 8 }]}>{m.name}</Text>
                <Text style={[s.tdMuted, { flex: MS_COLS[1], paddingRight: 8 }]}>{m.highlight || "—"}</Text>
                <Text style={[s.td, { flex: MS_COLS[2], textAlign: "right" }]}>{fmtShort(m.estDueDate)}</Text>
                <Text style={[s.tdMuted, { flex: MS_COLS[3], textAlign: "right" }]}>{fmtShort(m.origDueDate)}</Text>
                <View style={{ flex: MS_COLS[4], alignItems: "flex-end" }}>
                  <Chip label={m.extended ? `${meta.label} (ext.)` : meta.label} color={meta.color} />
                </View>
              </View>
            );
          })}

          {rows.length > MAX && (
            <Text style={s.overflowNote}>+{rows.length - MAX} further milestone(s) tracked in ClickUp</Text>
          )}
        </View>
      )}

      <Footer report={report} page={4} />
    </Page>
  );
}

// ─── Slide 5 — What's next ────────────────────────────────────────────────────

function WhatsNextSlide({ report }: { report: StatusReport }) {
  const w = report.whatsNext;

  return (
    <Page size={PAGE} style={s.page} wrap={false}>
      <SlideHeader
        eyebrow="4 · WHAT'S NEXT"
        title="The Week Ahead"
        week={`From ${fmtLong(report.meta.weekEnding)}`}
      />

      <View style={[s.card, { marginBottom: 12, borderLeftWidth: 3, borderLeftColor: D.accent }]}>
        <Text style={{ fontSize: 8, letterSpacing: 1.1, color: D.textDim, fontWeight: 700, marginBottom: 5 }}>PHASE</Text>
        <Text style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{w.phase}</Text>
        <Text style={s.para}>{w.focus}</Text>
      </View>

      <View style={{ flexDirection: "row", flex: 1 }}>
        <View style={[s.card, { flex: 1.3, marginRight: 12 }]}>
          <Text style={s.cardTitle}>UPCOMING DELIVERABLES</Text>
          <Bullets items={w.deliverables} max={6} />
        </View>

        <View style={[s.card, { flex: 1 }]}>
          <Text style={s.cardTitle}>SCHEDULED MEETINGS</Text>
          {w.meetings.length === 0 ? (
            <Text style={s.dim}>No meetings scheduled.</Text>
          ) : (
            w.meetings.slice(0, 6).map(mt => (
              <View
                key={mt.id}
                style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 6.5, borderBottomWidth: 1, borderBottomColor: D.cardLine }}
              >
                <View style={{ width: 44 }}>
                  <Text style={{ fontSize: 10.5, fontWeight: 700, color: D.accentSoft }}>{fmtShort(mt.date)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, fontWeight: 500, color: D.textFaint }}>{mt.title}</Text>
                  {!!mt.attendees && <Text style={{ fontSize: 8.5, color: D.textDim, marginTop: 1.5 }}>{mt.attendees}</Text>}
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      <Footer report={report} page={5} />
    </Page>
  );
}

// ─── Slide 6 — Risks ──────────────────────────────────────────────────────────

const RISK_COLS = [0.85, 2.5, 3.1, 3.1, 1.4];

function RisksSlide({ report }: { report: StatusReport }) {
  const rows = report.risks.risks;
  const MAX  = 6;
  const counts = {
    high:   rows.filter(r => r.severity === "high").length,
    medium: rows.filter(r => r.severity === "medium").length,
    low:    rows.filter(r => r.severity === "low").length,
  };

  return (
    <Page size={PAGE} style={s.page} wrap={false}>
      <SlideHeader
        eyebrow="5 · RISK REVIEW"
        title="Risks & Mitigations"
        week={`Week of ${fmtLong(report.meta.weekStarting)}`}
        right={
          <View style={{ flexDirection: "row" }}>
            {(["high", "medium", "low"] as const).map(sev => (
              <View key={sev} style={{ alignItems: "center", marginLeft: 14 }}>
                <Text style={{ fontSize: 17, fontWeight: 700, color: SEVERITY_META[sev].color }}>{counts[sev]}</Text>
                <Text style={{ fontSize: 7.5, color: D.textDim, letterSpacing: 0.7 }}>{SEVERITY_META[sev].label}</Text>
              </View>
            ))}
          </View>
        }
      />

      {!!report.risks.assessment && (
        <View style={[s.card, { marginBottom: 12, paddingVertical: 12 }]}>
          <Text style={s.para}>{report.risks.assessment}</Text>
        </View>
      )}

      {rows.length === 0 ? (
        <View style={[s.card, { flex: 1, justifyContent: "center", alignItems: "center" }]}>
          <Text style={s.dim}>No risks recorded for this reporting week.</Text>
        </View>
      ) : (
        <View>
          <View style={s.thead}>
            <Text style={[s.th, { flex: RISK_COLS[0] }]}>SEV</Text>
            <Text style={[s.th, { flex: RISK_COLS[1] }]}>RISK</Text>
            <Text style={[s.th, { flex: RISK_COLS[2] }]}>IMPACT</Text>
            <Text style={[s.th, { flex: RISK_COLS[3] }]}>MITIGATION</Text>
            <Text style={[s.th, { flex: RISK_COLS[4] }]}>OWNER</Text>
          </View>

          {rows.slice(0, MAX).map(r => {
            const meta = SEVERITY_META[r.severity];
            return (
              <View key={r.id} style={s.tr}>
                <View style={{ flex: RISK_COLS[0] }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: meta.color, marginTop: 3 }} />
                </View>
                <Text style={[s.td, { flex: RISK_COLS[1], fontWeight: 700, paddingRight: 8 }]}>{r.title}</Text>
                <Text style={[s.tdMuted, { flex: RISK_COLS[2], paddingRight: 8 }]}>{r.impact}</Text>
                <Text style={[s.tdMuted, { flex: RISK_COLS[3], paddingRight: 8 }]}>{r.mitigation}</Text>
                <Text style={[s.td, { flex: RISK_COLS[4] }]}>{r.owner || "—"}</Text>
              </View>
            );
          })}

          {rows.length > MAX && (
            <Text style={s.overflowNote}>+{rows.length - MAX} further risk(s) in the project risk log</Text>
          )}
        </View>
      )}

      <Footer report={report} page={6} />
    </Page>
  );
}

// ─── Slide 7 — Budget ─────────────────────────────────────────────────────────

const BUD_COLS = [1.05, 3.2, 1.35, 1.2, 1.2, 1.35];

function BudgetSlide({ report }: { report: StatusReport }) {
  const rows = report.budget.rows;
  const t    = budgetTotals(rows);
  const burn = t.allocated > 0 ? t.actual / t.allocated : 0;

  return (
    <Page size={PAGE} style={s.page} wrap={false}>
      <SlideHeader
        eyebrow="6 · BUDGET"
        title="Project Budget Overview"
        week={report.budget.note}
        right={
          <View style={{ flexDirection: "row" }}>
            {[
              { v: fmtHrs(t.allocated), l: "ALLOCATED", c: D.textOn },
              { v: fmtHrs(t.actual),    l: "ACTUAL",    c: D.accentSoft },
              { v: fmtHrs(t.remaining), l: "REMAINING", c: t.remaining <= 0 ? D.red : D.green },
              { v: `${Math.round(burn * 100)}%`, l: "CONSUMED", c: burn > 1 ? D.red : burn > 0.9 ? D.amber : D.textOn },
            ].map(x => (
              <View key={x.l} style={{ alignItems: "flex-end", marginLeft: 18 }}>
                <Text style={{ fontSize: 17, fontWeight: 700, color: x.c }}>{x.v}</Text>
                <Text style={{ fontSize: 7.5, color: D.textDim, letterSpacing: 0.7 }}>{x.l}</Text>
              </View>
            ))}
          </View>
        }
      />

      <View style={s.thead}>
        <Text style={[s.th, { flex: BUD_COLS[0] }]}>PHASE</Text>
        <Text style={[s.th, { flex: BUD_COLS[1] }]}>NAME</Text>
        <Text style={[s.th, { flex: BUD_COLS[2], textAlign: "right" }]}>ALLOCATED HRS</Text>
        <Text style={[s.th, { flex: BUD_COLS[3], textAlign: "right" }]}>ACTUAL HRS</Text>
        <Text style={[s.th, { flex: BUD_COLS[4], textAlign: "right" }]}>REMAINING</Text>
        <Text style={[s.th, { flex: BUD_COLS[5], textAlign: "right" }]}>STATUS</Text>
      </View>

      {rows.map(r => {
        const over = r.allocatedHours > 0 && r.actualHours / r.allocatedHours > 1.1;
        return (
          <View key={r.id} style={s.tr}>
            <Text style={[s.td, { flex: BUD_COLS[0], color: D.textDim }]}>
              {r.phaseNumber != null && r.phaseNumber > 0 ? `Phase ${r.phaseNumber}` : r.phaseNumber === 0 ? "PM" : "—"}
            </Text>
            <Text style={[s.td, { flex: BUD_COLS[1], fontWeight: 500 }]}>{r.name}</Text>
            <Text style={[s.td, { flex: BUD_COLS[2], textAlign: "right" }]}>
              {fmtNum(r.allocatedHours)}
              {r.originalAllocatedHours != null && (
                <Text style={{ color: D.textDim, fontSize: 8 }}> (was {fmtNum(r.originalAllocatedHours)})</Text>
              )}
            </Text>
            <Text style={[s.td, { flex: BUD_COLS[3], textAlign: "right", color: over ? D.red : D.textFaint }]}>
              {fmtNum(r.actualHours)}
            </Text>
            <Text style={[s.td, { flex: BUD_COLS[4], textAlign: "right" }]}>{fmtNum(r.remainingHours)}</Text>
            <View style={{ flex: BUD_COLS[5], alignItems: "flex-end" }}>
              <Chip
                label={r.status}
                color={r.status === "Complete" ? D.green : r.status === "In Progress" ? D.accentSoft : D.textDim}
              />
            </View>
          </View>
        );
      })}

      <View style={s.totalRow}>
        <Text style={[s.tdTotal, { flex: BUD_COLS[0] }]}>TOTAL</Text>
        <Text style={[s.tdTotal, { flex: BUD_COLS[1] }]} />
        <Text style={[s.tdTotal, { flex: BUD_COLS[2], textAlign: "right" }]}>{fmtNum(t.allocated)}</Text>
        <Text style={[s.tdTotal, { flex: BUD_COLS[3], textAlign: "right" }]}>{fmtNum(t.actual)}</Text>
        <Text style={[s.tdTotal, { flex: BUD_COLS[4], textAlign: "right" }]}>{fmtNum(t.remaining)}</Text>
        <Text style={[s.tdTotal, { flex: BUD_COLS[5] }]} />
      </View>

      {report.budget.dataWarning && (
        <View style={{ marginTop: 12, padding: 11, borderRadius: 7, backgroundColor: D.amberDeep, borderWidth: 1, borderColor: D.amber }}>
          <Text style={{ fontSize: 9, color: D.amber, fontWeight: 700, marginBottom: 2 }}>DATA INTEGRITY NOTE</Text>
          <Text style={{ fontSize: 9, color: D.textFaint }}>{report.budget.dataWarning}</Text>
        </View>
      )}

      <Footer report={report} page={7} />
    </Page>
  );
}

// ─── Slide 8 — Recap & action items ───────────────────────────────────────────

const ACT_COLS = [4.4, 1.9, 1.25, 1.25];

function ActionsSlide({ report }: { report: StatusReport }) {
  const items = report.actions.items;
  const MAX   = 8;

  return (
    <Page size={PAGE} style={s.page} wrap={false}>
      <SlideHeader
        eyebrow="7 · RECAP & ACTIONS"
        title="Recap and Action Items"
        week={`Week of ${fmtLong(report.meta.weekStarting)}`}
        right={<StatusBadge report={report} />}
      />

      {!!report.actions.recap && (
        <View style={[s.card, { marginBottom: 12, borderLeftWidth: 3, borderLeftColor: D.accent }]}>
          <Text style={s.cardTitle}>WEEK IN SUMMARY</Text>
          <Text style={s.para}>{report.actions.recap}</Text>
        </View>
      )}

      {items.length === 0 ? (
        <View style={[s.card, { flex: 1, justifyContent: "center", alignItems: "center" }]}>
          <Text style={s.dim}>No open action items.</Text>
        </View>
      ) : (
        <View>
          <View style={s.thead}>
            <Text style={[s.th, { flex: ACT_COLS[0] }]}>ACTION</Text>
            <Text style={[s.th, { flex: ACT_COLS[1] }]}>OWNER</Text>
            <Text style={[s.th, { flex: ACT_COLS[2], textAlign: "right" }]}>DUE</Text>
            <Text style={[s.th, { flex: ACT_COLS[3], textAlign: "right" }]}>STATUS</Text>
          </View>

          {items.slice(0, MAX).map(a => (
            <View key={a.id} style={s.tr}>
              <Text style={[s.td, { flex: ACT_COLS[0], fontWeight: 500, paddingRight: 8 }]}>{a.action}</Text>
              <View style={{ flex: ACT_COLS[1], paddingRight: 8 }}>
                <Text style={s.td}>{a.owner || "—"}</Text>
                <Text style={{ fontSize: 7.5, color: a.ownerSide === "customer" ? D.amber : D.accentSoft, marginTop: 1 }}>
                  {a.ownerSide === "customer" ? report.meta.client.toUpperCase() : "LOOP SERVICES"}
                </Text>
              </View>
              <Text style={[s.td, { flex: ACT_COLS[2], textAlign: "right" }]}>{fmtShort(a.dueDate)}</Text>
              <View style={{ flex: ACT_COLS[3], alignItems: "flex-end" }}>
                <Chip label={a.status || "Open"} color={D.textDim} />
              </View>
            </View>
          ))}

          {items.length > MAX && (
            <Text style={s.overflowNote}>+{items.length - MAX} further action item(s)</Text>
          )}
        </View>
      )}

      <Footer report={report} page={8} />
    </Page>
  );
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function StatusReportPdf({
  report, logoSrc = "/loop-services-logo.png",
}: { report: StatusReport; logoSrc?: string }) {
  return (
    <Document
      title={`${report.meta.client} — Weekly Status Report ${report.meta.weekEnding}`}
      author={`Loop Services · ${report.meta.preparedBy}`}
      subject={`Weekly project status report for ${report.meta.projectLabel}`}
      creator="Loop Services Delivery Dashboard"
    >
      <CoverSlide        report={report} logoSrc={logoSrc} />
      <RecapSlide        report={report} />
      <DeliverablesSlide report={report} />
      <MilestonesSlide   report={report} />
      <WhatsNextSlide    report={report} />
      <RisksSlide        report={report} />
      <BudgetSlide       report={report} />
      <ActionsSlide      report={report} />
    </Document>
  );
}
