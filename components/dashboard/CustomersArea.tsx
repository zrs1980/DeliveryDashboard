"use client";
import { useState } from "react";
import { C } from "@/lib/constants";
import CrmView from "@/components/dashboard/CrmView";
import CustomerSuccessView, { type CsMode } from "@/components/dashboard/CustomerSuccessView";
import { CustomersView } from "@/components/dashboard/CustomersView";

// ─── One customers area ──────────────────────────────────────────────────────
//
// Three top-level tabs were about customers — 🏢 Customers (the quarterly
// health-check grid), 🤝 CRM and 💚 Customer Success — each with its own account
// list, reached from its own nav entry. "Where do I look for this customer?"
// had three answers, and the views could not see each other: no Cs* component
// imported a Crm* one or called /api/crm/*, and no Crm* component called
// /api/cs/*. The only overlap was the contract, rendered twice.
//
// They are now one tab with one bar. The underlying views are UNCHANGED
// components — this owns the bar and drives their mode, rather than being a
// rewrite of 1,800 lines that would have to be re-proved.
//
// ⚠ THE CS ENTRIES ARE HIDDEN, NOT PROTECTED, AND THAT IS FINE. `csLayer` here
// comes from /api/cs/access and decides only what the bar shows; every /api/cs/*
// route enforces requireCsLayer() itself, and /api/customers/[id] omits its `cs`
// block server-side. Hiding a tab is a courtesy so people are not offered
// something that will 403. It is not the boundary, and must never be treated as
// one — lib/cs-permissions.ts is server-only precisely so the allow-list cannot
// reach this file.

type Entry = {
  id:     string;
  label:  string;
  /** Which underlying view renders it, and in which mode. */
  view:   "crm" | "cs" | "healthchecks";
  crmMode?: "accounts" | "pipeline" | "projects" | "contacts" | "tasks";
  csMode?:  CsMode;
  /** CS-only entries are omitted for a reader without cs_layer. */
  cs?:    boolean;
  /** Starts a visual group in the bar. */
  group?: string;
};

const ENTRIES: Entry[] = [
  // Focus first: it is the question the area exists to answer, and it is the
  // one screen here meant to be opened without being looked for.
  { id: "focus",     label: "Focus",     view: "cs",  csMode: "focus",  cs: true, group: "Act" },
  { id: "triage",    label: "Triage",    view: "cs",  csMode: "triage", cs: true },
  { id: "drafts",    label: "Drafts",    view: "cs",  csMode: "drafts", cs: true },

  { id: "accounts",  label: "Accounts",  view: "crm", crmMode: "accounts", group: "Book" },
  { id: "pipeline",  label: "Pipeline",  view: "crm", crmMode: "pipeline" },
  { id: "contacts",  label: "Contacts",  view: "crm", crmMode: "contacts" },
  { id: "tasks",     label: "Tasks",     view: "crm", crmMode: "tasks" },
  { id: "projects",  label: "Projects",  view: "crm", crmMode: "projects" },

  { id: "checks",    label: "Health checks", view: "healthchecks", group: "Cadence" },
  { id: "renewals",  label: "Renewals",  view: "cs",  csMode: "renewals", cs: true },
  { id: "releases",  label: "Releases",  view: "cs",  csMode: "releases", cs: true },
  { id: "agent",     label: "Agent",     view: "cs",  csMode: "agent",    cs: true },
];

export default function CustomersArea({ csLayer }: { csLayer: boolean }) {
  // A consultant's first entry is Accounts, not Focus — Focus does not exist
  // for them, and defaulting to a tab that is not in the bar would render an
  // empty page.
  const entries = ENTRIES.filter(e => !e.cs || csLayer);
  const [active, setActive] = useState(entries[0]?.id ?? "accounts");
  const entry = entries.find(e => e.id === active) ?? entries[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Customers</h2>
        <span style={{ fontSize: 12, color: C.textSub }}>
          {csLayer
            ? "One account list. Opening a customer shows their people, deals, projects, contracts and health together."
            : "One account list. Opening a customer shows their people, deals, projects and contracts together."}
        </span>
      </div>

      {/* One bar. Grouped with a divider rather than split into several bars,
          because the groups are a reading aid — they are not separate places. */}
      <div style={{ display: "flex", gap: 2, background: C.alt, border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: 2, flexWrap: "wrap", alignItems: "center" }}>
        {entries.map((e, n) => (
          <span key={e.id} style={{ display: "contents" }}>
            {e.group && n > 0 && (
              <span aria-hidden style={{ width: 1, alignSelf: "stretch",
                                         background: C.border, margin: "2px 6px" }} />
            )}
            <button
              onClick={() => setActive(e.id)}
              style={{
                background: active === e.id ? C.blue : "transparent",
                color: active === e.id ? "#fff" : C.textMid,
                border: "none", borderRadius: 5, padding: "4px 12px",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
              }}
            >
              {e.label}
            </button>
          </span>
        ))}
      </div>

      {/* Each view is mounted only while selected. They are self-loading and
          several are expensive — CustomersView builds a quarterly grid, the CS
          views fetch the index — so keeping all three alive would run every
          fetch on every visit to the area. */}
      {entry?.view === "crm" && (
        <CrmView
          key={`crm-${entry.crmMode}`}
          mode={entry.crmMode}
          hideModeBar
          onModeChange={m => {
            // The view can still change its own mode (opening a deal from the
            // pipeline, say). Reflect it in the bar rather than letting the two
            // disagree about where you are.
            const match = entries.find(x => x.view === "crm" && x.crmMode === m);
            if (match) setActive(match.id);
          }}
        />
      )}

      {entry?.view === "cs" && (
        <CustomerSuccessView
          key={`cs-${entry.csMode}`}
          mode={entry.csMode}
          hideModeBar
          onModeChange={m => {
            const match = entries.find(x => x.view === "cs" && x.csMode === m);
            if (match) setActive(match.id);
          }}
        />
      )}

      {entry?.view === "healthchecks" && <CustomersView />}
    </div>
  );
}
