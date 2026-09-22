import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// ─── Per-customer release document ──────────────────────────────────────────
//
// The deliverable docs/05-RELEASE-MATCHING.md calls the core value of the whole
// build: each customer gets only what affects them, with reasoning written about
// their account.
//
//   "The 'why it matters to you specifically' block is the entire point. If that
//    section reads generically, the document has failed and is no better than
//    the vendor's own notes."
//
// A4 portrait rather than the 16:9 deck used for status reports — this is a
// document to read and forward internally, possibly to a CFO, not something
// presented on a screen.
//
// ⚠ NEVER use fontStyle, or a fontWeight that is not registered below. Only DM
// Sans 400/500/700 exist, and react-pdf throws on anything else — killing the
// whole render rather than that one line. This reached production once already
// in StatusReportPdf via an italic note.

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
Font.registerHyphenationCallback(w => [w]);

const P = {
  ink:     "#0D1117",
  body:    "#2B3440",
  muted:   "#6B7683",
  line:    "#E2E5EA",
  accent:  "#1A56DB",
  accentBg:"#EBF5FF",
  warnBg:  "#FFF8E6",
  warnBd:  "#F5D990",
  warn:    "#92600A",
};

const s = StyleSheet.create({
  page: {
    paddingTop: 54, paddingBottom: 54, paddingHorizontal: 54,
    fontFamily: "DM Sans", fontSize: 10.5, color: P.body, lineHeight: 1.5,
  },
  coverWrap: { marginBottom: 26 },
  eyebrow: { fontSize: 9, letterSpacing: 1.4, color: P.accent, fontWeight: 700, marginBottom: 8 },
  title:   { fontSize: 23, fontWeight: 700, color: P.ink, lineHeight: 1.2, marginBottom: 6 },
  sub:     { fontSize: 11, color: P.muted },
  rule:    { height: 2, backgroundColor: P.accent, width: 52, marginTop: 14, marginBottom: 18 },

  intro:   { fontSize: 11, color: P.body, marginBottom: 20, lineHeight: 1.6 },

  sectionHead: { fontSize: 12.5, fontWeight: 700, color: P.ink, marginTop: 14, marginBottom: 9 },

  item:      { marginBottom: 15, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: P.line },
  itemLast:  { marginBottom: 15, paddingBottom: 0 },
  itemTitle: { fontSize: 11.5, fontWeight: 700, color: P.ink, marginBottom: 4 },
  tagRow:    { flexDirection: "row", marginBottom: 6 },
  tag: {
    fontSize: 7.5, fontWeight: 700, letterSpacing: 0.6, color: P.accent,
    backgroundColor: P.accentBg, paddingVertical: 2, paddingHorizontal: 6,
    borderRadius: 3, marginRight: 5,
  },
  tagWarn: {
    fontSize: 7.5, fontWeight: 700, letterSpacing: 0.6, color: P.warn,
    backgroundColor: P.warnBg, paddingVertical: 2, paddingHorizontal: 6,
    borderRadius: 3, marginRight: 5,
  },
  what:  { fontSize: 10, color: P.muted, marginBottom: 7 },
  whyLabel: { fontSize: 8.5, fontWeight: 700, letterSpacing: 0.8, color: P.accent, marginBottom: 3 },
  why:   { fontSize: 10.5, color: P.ink, lineHeight: 1.55 },

  actionBox: {
    backgroundColor: P.warnBg, borderWidth: 1, borderColor: P.warnBd,
    borderRadius: 5, padding: 12, marginTop: 6, marginBottom: 16,
  },
  actionHead: { fontSize: 10.5, fontWeight: 700, color: P.warn, marginBottom: 5 },

  close: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: P.line,
           fontSize: 10.5, color: P.body, lineHeight: 1.6 },
  footer: { position: "absolute", bottom: 28, left: 54, right: 54,
            flexDirection: "row", justifyContent: "space-between" },
  footText: { fontSize: 8, color: P.muted },
  more: { fontSize: 9.5, color: P.muted, marginTop: 4 },
});

export interface ReleasePdfItem {
  title:        string;
  description:  string;
  category:     string | null;
  reasoning:    string;
  actionRequired: boolean;
  modules:      string[];
}

export interface ReleasePdfProps {
  customerName: string;
  product:      string;
  version:      string;
  releaseDate:  string | null;
  preparedBy:   string;
  intro:        string;
  items:        ReleasePdfItem[];
}

const CATEGORY_LABEL: Record<string, string> = {
  new_feature:     "NEW",
  enhancement:     "IMPROVED",
  deprecation:     "BEING RETIRED",
  breaking_change: "BREAKING CHANGE",
};

// Caps exist so a document never silently becomes the release note it replaces.
// Anything beyond is stated, never dropped in silence.
const MAX_ITEMS = 7;

export function ReleasePdf({
  customerName, product, version, releaseDate, preparedBy, intro, items,
}: ReleasePdfProps) {
  const shown = items.slice(0, MAX_ITEMS);
  const overflow = items.length - shown.length;
  const actions = shown.filter(i => i.actionRequired);
  const productLabel = product === "loop_erp" ? "Loop ERP" : "NetSuite";

  return (
    <Document title={`${productLabel} ${version} — ${customerName}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.coverWrap}>
          <Text style={s.eyebrow}>{productLabel.toUpperCase()} {version.toUpperCase()}</Text>
          <Text style={s.title}>What changes for {customerName}</Text>
          <Text style={s.sub}>
            {releaseDate ? `Release ${releaseDate} · ` : ""}Prepared by {preparedBy}
          </Text>
          <View style={s.rule} />
        </View>

        <Text style={s.intro}>{intro}</Text>

        {actions.length > 0 && (
          <View style={s.actionBox}>
            <Text style={s.actionHead}>Needs a decision before the release lands</Text>
            {actions.map((a, i) => (
              <Text key={i} style={{ fontSize: 10, color: P.body, marginBottom: 2 }}>
                • {a.title}
              </Text>
            ))}
          </View>
        )}

        <Text style={s.sectionHead}>
          {shown.length} {shown.length === 1 ? "item" : "items"} relevant to your setup
        </Text>

        {shown.map((item, i) => (
          <View key={i} style={i === shown.length - 1 ? s.itemLast : s.item} wrap={false}>
            <Text style={s.itemTitle}>{item.title}</Text>
            <View style={s.tagRow}>
              {item.category && (
                <Text style={item.category === "deprecation" || item.category === "breaking_change" ? s.tagWarn : s.tag}>
                  {CATEGORY_LABEL[item.category] ?? item.category.toUpperCase()}
                </Text>
              )}
              {item.modules.slice(0, 2).map((m, k) => (
                <Text key={k} style={s.tag}>{m.toUpperCase()}</Text>
              ))}
            </View>
            <Text style={s.what}>{item.description}</Text>
            {/* The entire point of the document. */}
            <Text style={s.whyLabel}>WHY THIS MATTERS TO YOU</Text>
            <Text style={s.why}>{item.reasoning}</Text>
          </View>
        ))}

        {overflow > 0 && (
          <Text style={s.more}>
            {overflow} further {overflow === 1 ? "item" : "items"} may be relevant — happy to walk through them.
          </Text>
        )}

        <Text style={s.close}>
          This covers only the changes we think touch how you actually use {productLabel} —
          not the full release. If you would like to talk any of it through, or want the
          complete notes, just reply.
        </Text>

        <View style={s.footer} fixed>
          <Text style={s.footText}>{customerName} · {productLabel} {version}</Text>
          <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export default ReleasePdf;
