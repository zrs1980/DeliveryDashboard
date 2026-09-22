"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { C } from "@/lib/constants";
import CustomerProfilePanel from "@/components/dashboard/CustomerProfilePanel";
import CsContracts from "@/components/dashboard/CsContracts";
import CsTriage from "@/components/dashboard/CsTriage";
import CsDraftQueue from "@/components/dashboard/CsDraftQueue";
import CsReleases from "@/components/dashboard/CsReleases";

// ─── Customer Success — account overview ─────────────────────────────────────
//
// The CS layer's first visible surface: every customer, how much work has
// actually happened, and how long each has been silent. Reads /api/cs/customers,
// which is gated on cs_layer server-side.
//
// ⚠ NOTHING HERE IS RAG-COLOURED, AND THAT IS DELIBERATE.
//
// "Quiet for 200 days" is a fact. "At risk" is a judgment, and this view is not
// entitled to make it — 40 of 55 customers are quiet simply because their
// implementation finished, so painting the silent ones red would flag three
// quarters of the book on day one and teach everyone to ignore the colour.
// Scoring arrives in Phase 2, and only once contracts (Phase 3) can separate
// "delivered and done" from "going quiet". Until then: neutral type, sorted so
// the silence is visible on its own.
//
// Per the design system, green/amber/red are only ever RAG status. Using them
// decoratively here would be wrong twice over.

interface CsCustomerRow {
  customerNsId:      string;
  name:              string;
  entityid:          string;
  email:             string | null;
  projectCount:      number;
  hoursInWindow:     number;
  lastActivity:      string | null;
  daysSinceActivity: number | null;
}

interface CsResponse {
  windowDays: number;
  total:      number;
  quiet:      number;
  customers:  CsCustomerRow[];
}

type SortKey = "quiet" | "name" | "projects" | "hours";

const nsCustomerUrl = (id: string) =>
  `https://system.na1.netsuite.com/app/common/entity/custjob.nl?id=${id}`;

const fmtH = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1)) + "h";

function fmtQuiet(days: number | null): string {
  if (days === null) return "Never";
  if (days === 0)    return "Today";
  if (days === 1)    return "1 day";
  if (days < 60)     return `${days} days`;
  const months = Math.floor(days / 30);
  if (months < 24)   return `${months} mo`;
  return `${Math.floor(days / 365)} yr`;
}

export default function CustomerSuccessView() {
  const [data,    setData]    = useState<CsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [q,       setQ]       = useState("");
  const [sort,    setSort]    = useState<SortKey>("quiet");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  // Triage is the default: it is the question the module exists to answer, and
  // the accounts table is reference material by comparison.
  const [mode,     setMode]     = useState<"triage" | "drafts" | "releases" | "accounts" | "renewals">("triage");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/cs/customers");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      setData(json as CsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = needle
      ? data.customers.filter(c =>
          c.name.toLowerCase().includes(needle) ||
          c.entityid.toLowerCase().includes(needle))
      : data.customers.slice();

    // Quiet-first is the default because it is the whole point: an account with
    // nothing happening generates no events and would never surface on its own.
    // "Never" sorts above the merely quiet.
    list.sort((a, b) => {
      switch (sort) {
        case "name":     return a.name.localeCompare(b.name);
        case "projects": return b.projectCount - a.projectCount;
        case "hours":    return b.hoursInWindow - a.hoursInWindow;
        case "quiet":
        default: {
          if (a.daysSinceActivity === null && b.daysSinceActivity === null) return 0;
          if (a.daysSinceActivity === null) return -1;
          if (b.daysSinceActivity === null) return 1;
          return b.daysSinceActivity - a.daysSinceActivity;
        }
      }
    });
    return list;
  }, [data, q, sort]);

  const th = (label: string, key: SortKey, align: "left" | "right" = "left") => (
    <th
      onClick={() => setSort(key)}
      style={{
        textAlign: align, padding: "8px 12px", fontSize: 11, fontWeight: 700,
        letterSpacing: 0.4, textTransform: "uppercase",
        color: sort === key ? C.blue : C.textSub,
        borderBottom: `1px solid ${C.border}`, cursor: "pointer", whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {label}{sort === key ? " ↓" : ""}
    </th>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
          Customer Success
        </h2>
        <span style={{ fontSize: 12, color: C.textSub }}>
          Who needs attention, what is drafted, and when contracts fall due.
        </span>
        <div style={{ display: "flex", gap: 2, background: C.alt, border: `1px solid ${C.border}`,
                      borderRadius: 7, padding: 2 }}>
          {(["triage", "drafts", "releases", "accounts", "renewals"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                background: mode === m ? C.blue : "transparent",
                color: mode === m ? "#fff" : C.textMid,
                border: "none", borderRadius: 5, padding: "4px 12px",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
              }}
            >
              {m === "triage" ? "Triage" : m === "drafts" ? "Drafts" : m === "releases" ? "Releases" : m === "accounts" ? "Accounts" : "Renewals"}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            marginLeft: "auto", background: C.blueBg, border: `1px solid ${C.blueBd}`,
            color: C.blue, borderRadius: 6, padding: "5px 12px", fontSize: 12,
            fontWeight: 600, cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1, fontFamily: C.font,
          }}
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{
          background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
          borderRadius: 8, padding: "10px 14px", fontSize: 13, margin: "12px 0",
        }}>
          Could not load customers: {error}
        </div>
      )}

      {mode === "triage" && (
        <div style={{ marginTop: 16 }}>
          <CsTriage />
        </div>
      )}

      {mode === "drafts" && (
        <div style={{ marginTop: 16 }}>
          <CsDraftQueue />
        </div>
      )}

      {mode === "releases" && (
        <div style={{ marginTop: 16 }}>
          <CsReleases />
        </div>
      )}

      {mode === "renewals" && (
        <div style={{ marginTop: 16 }}>
          <CsContracts />
        </div>
      )}

      {mode === "accounts" && loading && !data && (
        <div style={{ padding: "40px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>
          Loading customer activity from NetSuite…
        </div>
      )}

      {mode === "accounts" && data && (
        <>
          {/* Summary */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0" }}>
            <Tile label="Customers"                    value={String(data.total)} />
            <Tile label={`Quiet ${data.windowDays}d+`} value={String(data.quiet)} />
            <Tile label={`Active last ${data.windowDays}d`}
                  value={String(data.total - data.quiet)} />
          </div>

          <div style={{
            fontSize: 12, color: C.textMid, background: C.alt,
            border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "9px 13px", marginBottom: 16, lineHeight: 1.5,
          }}>
            Most of these accounts are quiet because their implementation finished, not
            because they are at risk — which is why nothing here is colour-coded. Telling
            the two apart needs contract data, and that is the next thing to load.
          </div>

          {/* Search */}
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search customers…"
            style={{
              width: "100%", maxWidth: 320, padding: "7px 11px", fontSize: 13,
              border: `1px solid ${C.mid}`, borderRadius: 6, marginBottom: 12,
              fontFamily: C.font, color: C.text,
            }}
          />

          {/* Table */}
          <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: C.surface }}>
              <thead style={{ background: C.alt }}>
                <tr>
                  {th("Customer", "name")}
                  {th("Projects", "projects", "right")}
                  {th(`Hours ${data.windowDays}d`, "hours", "right")}
                  <th style={{
                    textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 700,
                    letterSpacing: 0.4, textTransform: "uppercase", color: C.textSub,
                    borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                  }}>
                    Last activity
                  </th>
                  {th("Quiet for", "quiet", "right")}
                  <th style={{ borderBottom: `1px solid ${C.border}` }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr
                    key={c.customerNsId}
                    onClick={() => setSelected({ id: c.customerNsId, name: c.name })}
                    style={{
                      background: selected?.id === c.customerNsId ? C.blueBg : i % 2 ? C.alt : C.surface,
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ padding: "8px 12px", fontSize: 13, color: C.text, fontWeight: 500 }}>
                      {c.name}
                      <span style={{ color: C.textSub, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                        {c.entityid}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: C.mono, color: c.projectCount ? C.text : C.textSub }}>
                      {c.projectCount}
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: C.mono, color: c.hoursInWindow ? C.text : C.textSub }}>
                      {c.hoursInWindow ? fmtH(c.hoursInWindow) : "—"}
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: 13, fontFamily: C.mono, color: c.lastActivity ? C.textMid : C.textSub }}>
                      {c.lastActivity ?? "—"}
                    </td>
                    <td style={{
                      padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: C.mono,
                      color: c.daysSinceActivity === null ? C.textSub : C.textMid,
                      fontWeight: c.daysSinceActivity === null ? 400 : 500,
                    }}>
                      {fmtQuiet(c.daysSinceActivity)}
                    </td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      <a
                        href={nsCustomerUrl(c.customerNsId)}
                        target="_blank"
                        rel="noreferrer"
                        // The row opens the profile; the link must not do both.
                        onClick={e => e.stopPropagation()}
                        style={{
                          fontSize: 11, color: C.purple, background: C.purpleBg,
                          border: `1px solid ${C.purpleBd}`, borderRadius: 5,
                          padding: "2px 7px", textDecoration: "none", fontWeight: 600,
                        }}
                      >
                        ↗ NetSuite
                      </a>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "28px 12px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                      No customers match “{q}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <CustomerProfilePanel
              key={selected.id}
              customerNsId={selected.id}
              customerName={selected.name}
              onClose={() => setSelected(null)}
            />
          )}

          <p style={{ fontSize: 11, color: C.textSub, marginTop: 10, lineHeight: 1.6 }}>
            Click a customer to see their profile.
            Hours count actual logged time only (<span style={{ fontFamily: C.mono }}>timetype=&apos;A&apos;</span>),
            excluding leave, rolled up from projects to the customer that owns them.
            Customers shown are those with NetSuite status “Customer-Closed Won”; accounts
            outside that filter are not listed even if they have delivery history.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 16px", minWidth: 120, boxShadow: C.sh,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: C.mono, color: C.text, lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.textSub, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
