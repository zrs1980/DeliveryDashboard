"use client";
import { useState, useMemo, useEffect } from "react";
import { C } from "@/lib/constants";
import { ProjectTable } from "@/components/dashboard/ProjectTable";
import { useProjects, projectsForCustomer } from "@/lib/use-projects";
import { isLocalAccountId } from "@/lib/crm-accounts";
import type { Project } from "@/lib/types";

// ─── Projects ───────────────────────────────────────────────────────────────
//
// NetSuite is the master. Nothing here creates or edits a project; this is the
// delivery side of an account, read live.
//
// ⚠ `ProjectTable` IS REUSED, NOT REIMPLEMENTED — the same component the
// Portfolio Overview renders, so the health badge, progress-vs-burn bar, hours,
// billable split, budget fit, go-live countdown, notes and the row drill-down
// are identical in both places and cannot drift. Same reasoning as
// ProjectTaskPanel being shared between Portfolio Overview and the PM tab.
//
// Scoped two ways: the whole portfolio (CRM → Projects) or one account's
// delivery history (the account page's Projects tab).

export default function CrmProjects({
  customerNsId, customerName,
}: { customerNsId?: string; customerName?: string }) {
  const { projects, phases, loading, error, refresh } = useProjects();
  const [rows, setRows] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  // Internal projects (PTO, training, the capacity-planning placeholder) are
  // hidden by default for the same reason the Portfolio Overview hides them:
  // they are not client delivery and they crowd out what is. Offered as a
  // toggle rather than removed, because "where did project 419 go" is a real
  // question.
  const [showInternal, setShowInternal] = useState(false);

  useEffect(() => { setRows(projects); }, [projects]);

  const scoped = useMemo(() => {
    let r = customerNsId ? projectsForCustomer(rows, customerNsId) : rows;
    if (!showInternal) r = r.filter(p => !p.isInternal);
    const needle = q.trim().toLowerCase();
    if (needle) {
      r = r.filter(p =>
        (p.client ?? "").toLowerCase().includes(needle) ||
        (p.projectName ?? "").toLowerCase().includes(needle) ||
        (p.pm ?? "").toLowerCase().includes(needle) ||
        String(p.entityid ?? "").toLowerCase().includes(needle));
    }
    return r;
  }, [rows, customerNsId, q, showInternal]);

  const internalHidden = useMemo(() => {
    const base = customerNsId ? projectsForCustomer(rows, customerNsId) : rows;
    return base.filter(p => p.isInternal).length;
  }, [rows, customerNsId]);

  // A local prospect has no NetSuite record, so it can hold no NetSuite
  // project. Said outright — an empty table here would read as "this customer
  // has had no work done", which is a different and much worse claim.
  if (customerNsId && isLocalAccountId(customerNsId)) {
    return (
      <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.7, padding: "6px 0" }}>
        This is a local prospect, so it has no NetSuite projects.<br />
        Delivery history appears once it is linked to a NetSuite account.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {!customerNsId && (
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search client, project, PM or number…"
            style={{ flex: "1 1 240px", maxWidth: 340, padding: "6px 11px", fontSize: 13,
                     border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font }}
          />
        )}
        <span style={{ fontSize: 12, color: C.textSub }}>
          {scoped.length} project{scoped.length === 1 ? "" : "s"}
        </span>
        {internalHidden > 0 && (
          <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: C.textMid }}>
            <input type="checkbox" checked={showInternal}
                   onChange={e => setShowInternal(e.target.checked)} />
            Show {internalHidden} internal
          </label>
        )}
        <button onClick={refresh} disabled={loading} style={{
          marginLeft: "auto", background: C.blueBg, border: `1px solid ${C.blueBd}`,
          color: C.blue, borderRadius: 6, padding: "5px 12px", fontSize: 12,
          fontWeight: 600, cursor: "pointer", fontFamily: C.font,
        }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12,
                      lineHeight: 1.55 }}>
          {error}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div style={{ padding: "30px 0", textAlign: "center", color: C.textSub, fontSize: 13,
                      lineHeight: 1.7 }}>
          Loading projects from NetSuite…<br />
          <span style={{ fontSize: 11.5 }}>
            This also reads ClickUp for each project, so the first load takes a few seconds.
          </span>
        </div>
      )}

      {!loading && scoped.length === 0 && (
        <div style={{ padding: "26px 0", textAlign: "center", color: C.textSub, fontSize: 13,
                      lineHeight: 1.7 }}>
          {q ? `No project matches “${q}”.`
            : customerNsId
              ? `No active NetSuite project for ${customerName ?? "this account"}.`
              : "No active projects."}
          {internalHidden > 0 && !showInternal && (
            <><br /><span style={{ fontSize: 11.5 }}>
              {internalHidden} internal project{internalHidden === 1 ? " is" : "s are"} hidden.
            </span></>
          )}
        </div>
      )}

      {scoped.length > 0 && (
        <ProjectTable
          projects={scoped}
          phases={phases}
          // The table edits notes in place. Writing back into the full list
          // rather than the filtered one keeps the edit when a filter changes —
          // otherwise typing a note then clearing the search would discard it.
          onProjectsChange={updated => setRows(prev => {
            const byId = new Map(updated.map(p => [p.id, p]));
            return prev.map(p => byId.get(p.id) ?? p);
          })}
        />
      )}
    </div>
  );
}
