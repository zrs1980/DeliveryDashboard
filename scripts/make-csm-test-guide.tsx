/**
 * Renders the CSM agent testing guide to a PDF.
 *
 *   PDF_FONT_DIR=./public/fonts npx tsx scripts/make-csm-test-guide.tsx
 *
 * ⚠ PDF_FONT_DIR MUST BE SET ON THE COMMAND LINE, as the other two PDF scripts
 * require. `Font.register` runs at module load, and imports are hoisted above
 * any assignment inside this file — so setting it here is too late and the
 * fonts resolve to C:\fonts.
 *
 * ⚠ NEVER use fontStyle, or a fontWeight other than 400/500/700. Only those DM
 * Sans faces are registered and react-pdf throws on anything else, killing the
 * whole document rather than one line.
 */
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font, renderToBuffer,
} from "@react-pdf/renderer";

if (!process.env.PDF_FONT_DIR) {
  console.error(
    "PDF_FONT_DIR is not set. Run:\n"
    + "  PDF_FONT_DIR=./public/fonts npx tsx scripts/make-csm-test-guide.tsx");
  process.exit(1);
}

const FONT_BASE = process.env.PDF_FONT_DIR;
Font.register({
  family: "DM Sans",
  fonts: [
    { src: `${FONT_BASE}/DMSans-Regular.ttf`, fontWeight: 400 },
    { src: `${FONT_BASE}/DMSans-Medium.ttf`,  fontWeight: 500 },
    { src: `${FONT_BASE}/DMSans-Bold.ttf`,    fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback(w => [w]);

const C = {
  text: "#0D1117", mid: "#4A5568", sub: "#8A95A3",
  line: "#E2E5EA", alt: "#F7F9FC",
  blue: "#1A56DB", blueBg: "#EBF5FF", blueBd: "#93C5FD",
  green: "#0C6E44", greenBg: "#E6F7F0", greenBd: "#A7E3C4",
  amber: "#92600A", amberBg: "#FFF8E6", amberBd: "#F5D990",
  red: "#C0392B", redBg: "#FEF0EF", redBd: "#F5B8B5",
  mono: "Courier",
};

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 52, paddingHorizontal: 46,
          fontFamily: "DM Sans", fontSize: 10, color: C.text, lineHeight: 1.5 },
  h1:   { fontSize: 21, fontWeight: 700, marginBottom: 4 },
  sub:  { fontSize: 10, color: C.sub, marginBottom: 20 },
  h2:   { fontSize: 13, fontWeight: 700, marginTop: 18, marginBottom: 7,
          paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: C.line },
  h3:   { fontSize: 10.5, fontWeight: 700, marginTop: 11, marginBottom: 4 },
  p:    { marginBottom: 6 },
  li:   { flexDirection: "row", marginBottom: 4 },
  liNum:{ width: 16, fontWeight: 700, color: C.blue },
  liDot:{ width: 11, color: C.sub },
  liTx: { flex: 1 },
  code: { fontFamily: C.mono, fontSize: 9, backgroundColor: C.alt,
          paddingVertical: 5, paddingHorizontal: 8, borderRadius: 3,
          borderWidth: 1, borderColor: C.line, marginBottom: 7 },
  inline: { fontFamily: C.mono, fontSize: 9 },
  callout: { borderWidth: 1, borderRadius: 5, padding: 9, marginBottom: 9, marginTop: 3 },
  calloutTitle: { fontWeight: 700, marginBottom: 2 },
  row:  { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line,
          paddingVertical: 5 },
  th:   { fontSize: 8.5, fontWeight: 700, color: C.sub, textTransform: "uppercase" },
  foot: { position: "absolute", bottom: 26, left: 46, right: 46,
          flexDirection: "row", justifyContent: "space-between",
          fontSize: 8, color: C.sub, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 },
});

const Num = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <View style={s.li}><Text style={s.liNum}>{n}.</Text><Text style={s.liTx}>{children}</Text></View>
);
const Dot = ({ children }: { children: React.ReactNode }) => (
  <View style={s.li}><Text style={s.liDot}>—</Text><Text style={s.liTx}>{children}</Text></View>
);
const Callout = ({ tone, title, children }: {
  tone: "blue" | "green" | "amber" | "red"; title: string; children: React.ReactNode;
}) => {
  const c = tone === "green" ? [C.greenBg, C.greenBd, C.green]
          : tone === "amber" ? [C.amberBg, C.amberBd, C.amber]
          : tone === "red"   ? [C.redBg, C.redBd, C.red]
          : [C.blueBg, C.blueBd, C.blue];
  return (
    <View style={[s.callout, { backgroundColor: c[0], borderColor: c[1] }]}>
      <Text style={[s.calloutTitle, { color: c[2] }]}>{title}</Text>
      <Text>{children}</Text>
    </View>
  );
};
const Row = ({ cells, header = false, widths }: {
  cells: string[]; header?: boolean; widths: number[];
}) => (
  <View style={s.row}>
    {cells.map((c, i) => (
      <Text key={i} style={[
        { width: `${widths[i]}%`, paddingRight: 6 },
        header ? s.th : { fontSize: 9.5 },
      ]}>{c}</Text>
    ))}
  </View>
);

function Guide() {
  return (
    <Document title="CSM Agent — Testing Guide" author="Loop Services">
      {/* ── Page 1 ─────────────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>CSM Agent — Testing Guide</Text>
        <Text style={s.sub}>
          Loop Services Project Dashboard · Customer Success layer · prompt version 2026-09-25.1
        </Text>

        <Callout tone="green" title="Nothing can reach a customer during this test.">
          There is exactly one code path that sends a CS draft, and it requires a signed-in
          reviewer to press &quot;Approve &amp; send&quot; with a recipient address. The agent has no
          send tool defined, and the nightly worker runs with no mailbox to send from. Running
          the agent writes a database row and nothing else.
        </Callout>

        <Text style={s.h2}>Step 1 — Run two SQL files</Text>
        <Text style={s.p}>
          In Supabase, open SQL Editor and run these in order. Both are safe to re-run.
        </Text>
        <Text style={s.code}>supabase/cs-phase-a.sql{"\n"}supabase/cs-agent-runs.sql</Text>
        <Text style={s.p}>
          The first adds opt-out, suggested roles and the active-negotiation flag. The second
          creates the agent run table and the draft columns. If you skip them the agent returns
          an error naming the file it needs.
        </Text>

        <Text style={s.h2}>Step 2 — Prepare one account</Text>
        <Text style={s.p}>
          The agent refuses an account with no profile, and will not write to anyone whose role
          is unset. Pick an account you know well — Salt and Stone, Oxide and Yield Engineering
          have the most material behind them.
        </Text>
        <Num n={1}>
          <Text>Customer Success → open the account → check a profile exists. If not, Extract one.</Text>
        </Num>
        <Num n={2}>
          <Text>
            CRM → Accounts → the same account → Contacts. Set a role on at least one person.
            Try <Text style={s.inline}>Suggest roles</Text> first, but expect it to decline most:
            only 68 of 949 contacts have a job title, which is the only thing a role can be
            inferred from.
          </Text>
        </Num>
        <Num n={3}>
          <Text>
            Confirm the account has an open flag in Triage. Without one the health check motion
            has no trigger and the agent will correctly refuse to use it.
          </Text>
        </Num>

        <Text style={s.h2}>Step 3 — Run it</Text>
        <Text style={s.p}>
          Customer Success → the account → scroll to <Text style={{ fontWeight: 700 }}>CSM agent</Text> → Run CSM agent.
          It takes roughly 30 to 90 seconds and shows elapsed time while it works.
        </Text>
        <Text style={s.p}>
          When it finishes, open the expander at the bottom of the panel. That is the transcript:
          every tool it called and what came back. It is the most useful part of the whole
          feature — a decision agent you cannot interrogate is one you cannot trust.
        </Text>

        <View style={s.foot} fixed>
          <Text>CSM Agent — Testing Guide</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* ── Page 2 ─────────────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h2}>Step 4 — Read the outcome</Text>

        <Row header widths={[26, 74]} cells={["Outcome", "What it means"]} />
        <Row widths={[26, 74]} cells={[
          "Drafted",
          "It wrote something. Open the Draft Queue to read it — rationale, cited facts, lint hits and the recipient are all there.",
        ]} />
        <Row widths={[26, 74]} cells={[
          "Skipped — no suitable contact",
          "Working correctly. Nobody on the account has a role the motion allows.",
        ]} />
        <Row widths={[26, 74]} cells={[
          "Skipped — nothing specific to say",
          "The profile is too thin to write from. That is an upstream data problem, not an agent fault.",
        ]} />
        <Row widths={[26, 74]} cells={[
          "Blocked",
          "It decided to write and suppression stopped it. The draft is kept, marked rejected, with the reason.",
        ]} />
        <Row widths={[26, 74]} cells={[
          "Needs a person",
          "It raised a human flag: an email is the wrong response here.",
        ]} />

        <Callout tone="blue" title="The most informative test is an account it should refuse.">
          Try one with no open flag, or one where you owe the customer something overdue. A
          well-reasoned skip is the harder behaviour and the one worth trusting. Anything can
          write an email.
        </Callout>

        <Text style={s.h2}>Step 5 — Review a draft (optional)</Text>
        <Text style={s.p}>
          Customer Success → Drafts. Each item shows why it was generated, the evidence behind
          it, which suppression checks ran, and the recipient pre-filled from the contact the
          agent chose. Editing before sending is expected — the difference between what was
          generated and what you send is the most valuable feedback in the system, and it is
          retained.
        </Text>
        <Callout tone="amber" title="Sending is a deliberate act.">
          Approve &amp; send re-runs every suppression check first, refuses an expired draft, and
          sends from your own mailbox. If you do not want to send anything yet, simply do not
          press it. Drafts expire on their own after 14 days.
        </Callout>

        <Text style={s.h2}>Step 6 — Check the numbers</Text>
        <Text style={s.p}>
          Customer Success → Agent. Proposed against skipped, sent unedited against edited,
          rejection reasons, skip categories, and tokens per run. It is empty until you have run
          a few.
        </Text>
        <Text style={s.p}>
          Rejection reasons are split into two groups on purpose. &quot;Wrong person&quot; and &quot;wrong
          timing&quot; are decision failures — the agent chose badly. &quot;Tone off&quot; and &quot;factually
          wrong&quot; are writing failures. They need different fixes, and a change that helps one
          can easily worsen the other.
        </Text>

        <Text style={s.h2}>What it cannot see</Text>
        <Dot>
          <Text>
            <Text style={{ fontWeight: 700 }}>Email.</Text> The app has no Gmail read scope, so the
            agent sees meetings but not correspondence. It is told this explicitly and told to
            prefer skipping when an account looks quiet but it cannot confirm that. Adding the
            scope is a Workspace admin change on the existing service account — no user re-consent.
          </Text>
        </Dot>
        <Dot>
          <Text>
            <Text style={{ fontWeight: 700 }}>Replies.</Text> For the same reason, reply rate cannot
            be measured. It is shown as an explicit gap rather than left off the list.
          </Text>
        </Dot>
        <Dot>
          <Text>
            <Text style={{ fontWeight: 700 }}>Commercial values.</Text> Deliberate. It gets contract
            dates so it can time outreach, never amounts.
          </Text>
        </Dot>

        <View style={s.foot} fixed>
          <Text>CSM Agent — Testing Guide</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* ── Page 3 ─────────────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h2}>Before you turn on the nightly job</Text>
        <Callout tone="red" title="The schedule is already in vercel.json.">
          It will begin on your next deploy if your Vercel plan allows sub-daily crons
          (<Text style={s.inline}>*/5 7-8 * * *</Text>). If you want to hold it back, delete that
          line from vercel.json. The manual button is unaffected either way.
        </Callout>
        <Text style={s.p}>
          The recommendation from the specification is to run it manually on ten accounts where
          you already know the right answer — some that should be emailed, some that should not,
          one where you owe the customer work — and to be satisfied with at least eight, including
          the rationales.
        </Text>
        <Text style={s.p}>
          Then check tokens per run on the Agent tab before letting it process ten a night.
        </Text>

        <Text style={s.h2}>Known limits worth expecting</Text>
        <Dot>
          <Text>
            <Text style={{ fontWeight: 700 }}>Contact roles are mostly unset.</Text> 14 of 458
            contacts on won accounts have a job title. Expect skips for &quot;no suitable contact&quot;
            until roles are filled in by hand. This is the single biggest thing limiting the agent
            today.
          </Text>
        </Dot>
        <Dot>
          <Text>
            <Text style={{ fontWeight: 700 }}>Commitments start empty.</Text> They accumulate as you
            process meetings through the wizard. Until then the agent is told that the absence of
            commitments is unknown rather than clear.
          </Text>
        </Dot>
        <Dot>
          <Text>
            <Text style={{ fontWeight: 700 }}>The release motion is not wired.</Text> It will refuse
            and say so.
          </Text>
        </Dot>

        <Text style={s.h2}>If something goes wrong</Text>
        <Row header widths={[42, 58]} cells={["Symptom", "Cause"]} />
        <Row widths={[42, 58]} cells={[
          "Error naming a .sql file",
          "That file has not been run in Supabase yet.",
        ]} />
        <Row widths={[42, 58]} cells={[
          "\"has no profile\"",
          "Extract a profile on the account first.",
        ]} />
        <Row widths={[42, 58]} cells={[
          "Always skipping, no suitable contact",
          "No contact has a role. Set one in CRM → Contacts.",
        ]} />
        <Row widths={[42, 58]} cells={[
          "Run says it hit a budget",
          "It was forced to decide early. That is a default, not a considered call — re-run it.",
        ]} />
        <Row widths={[42, 58]} cells={[
          "Agent tab is empty",
          "Nothing has run in the selected window. Try 90 days.",
        ]} />

        <Text style={[s.h3, { marginTop: 16 }]}>Reference</Text>
        <Text style={s.p}>
          Specification: <Text style={s.inline}>docs/08-CSM-AGENT.md</Text>. Implementation notes and
          the reasoning behind each guardrail are in <Text style={s.inline}>CLAUDE.md</Text> under
          &quot;The CSM agent&quot;.
        </Text>

        <View style={s.foot} fixed>
          <Text>CSM Agent — Testing Guide</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

async function main() {
  const buf = await renderToBuffer(<Guide />);
  const out = path.resolve("docs/CSM-Agent-Testing-Guide.pdf");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, buf);
  console.log(`Wrote ${out} (${Math.round(buf.length / 1024)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
