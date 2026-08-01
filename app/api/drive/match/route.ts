import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { DriveError, listCustomerFolders, type DriveFolder } from "@/lib/google-drive";
import { matchPrompt, scoreFolders, type MatchCandidate, type MatchContext } from "@/lib/customer-match";

export const revalidate = 0;
export const maxDuration = 45;

const MATCH_TOOL: Anthropic.Tool = {
  name: "report_customer_match",
  description: "Report which customer folder this meeting belongs to, with alternatives.",
  input_schema: {
    type: "object",
    properties: {
      folderId: {
        type: "string",
        description: "Id of the best-matching customer folder. Empty string if there is genuinely no good match.",
      },
      confidence: {
        type: "number",
        description: "0–1. 0.9+ only when an attendee's email domain unambiguously matches the folder.",
      },
      reason: { type: "string", description: "One short sentence explaining the match." },
      alternatives: {
        type: "array",
        description: "Up to 3 other plausible folders, best first.",
        items: {
          type: "object",
          properties: {
            folderId: { type: "string" },
            reason:   { type: "string" },
          },
          required: ["folderId", "reason"],
        },
      },
    },
    required: ["folderId", "confidence", "reason"],
  } as Anthropic.Tool.InputSchema,
};

/**
 * POST /api/drive/match   { title, attendees:[{name,email}], overview? }
 *
 * Returns a ranked customer-folder match. The deterministic scorer always produces
 * a result; Claude re-ranks it when available. A model failure degrades to the
 * fuzzy ranking rather than failing the request — the PM confirms the choice
 * regardless, so a weaker suggestion is still useful.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const ctx: MatchContext = {
      title:     typeof body?.title === "string" ? body.title : "",
      attendees: Array.isArray(body?.attendees) ? body.attendees : [],
      overview:  typeof body?.overview === "string" ? body.overview : undefined,
    };

    let customers: DriveFolder[];
    try {
      customers = await listCustomerFolders(session.user.email);
    } catch (e) {
      const isDrive = e instanceof DriveError;
      return NextResponse.json(
        {
          error: isDrive ? e.message : e instanceof Error ? e.message : "Unknown error",
          needsReauth: isDrive && (e.code === "reauth" || e.code === "no_token"),
        },
        { status: isDrive && e.code === "reauth" ? 403 : 500 },
      );
    }

    const fuzzy = scoreFolders(customers, ctx);
    const byId  = new Map(customers.map(c => [c.id, c]));

    // Fallback shape, used as-is if the model can't be reached.
    let best: MatchCandidate | null = fuzzy[0] ?? null;
    let alternatives: MatchCandidate[] = fuzzy.slice(1, 4);
    let source: "ai" | "fuzzy" = "fuzzy";
    let note: string | null = null;

    if (process.env.ANTHROPIC_API_KEY && customers.length > 0) {
      try {
        const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const message = await client.messages.create({
          model:       "claude-sonnet-4-6",
          max_tokens:  600,
          tools:       [MATCH_TOOL],
          tool_choice: { type: "tool", name: MATCH_TOOL.name },
          messages:    [{ role: "user", content: matchPrompt(ctx, customers, fuzzy) }],
        });

        const block = message.content.find(b => b.type === "tool_use" && b.name === MATCH_TOOL.name);
        if (block && block.type === "tool_use") {
          const input = block.input as {
            folderId?: string; confidence?: number; reason?: string;
            alternatives?: Array<{ folderId?: string; reason?: string }>;
          };

          // Only trust an id that's actually in the folder list — never invent a target.
          const picked = input.folderId ? byId.get(input.folderId) : undefined;
          if (picked) {
            best = {
              folderId:   picked.id,
              folderName: picked.name,
              score:      Math.max(0, Math.min(1, Number(input.confidence) || 0)),
              reason:     (input.reason ?? "").trim() || "Matched by Claude",
            };
            source = "ai";
          } else {
            best = null;
            source = "ai";
            note = (input.reason ?? "").trim() || "Claude found no confident customer match for this meeting.";
          }

          const altList = (input.alternatives ?? [])
            .map(a => {
              const f = a.folderId ? byId.get(a.folderId) : undefined;
              return f ? { folderId: f.id, folderName: f.name, score: 0, reason: (a.reason ?? "").trim() } : null;
            })
            .filter((a): a is MatchCandidate => a !== null && a.folderId !== best?.folderId);

          // Keep fuzzy suggestions the model didn't mention, so nothing plausible is lost.
          const seen = new Set([best?.folderId, ...altList.map(a => a.folderId)].filter(Boolean));
          alternatives = [...altList, ...fuzzy.filter(f => !seen.has(f.folderId))].slice(0, 5);
        }
      } catch (e) {
        console.error("[/api/drive/match] Claude unavailable, using fuzzy match", e);
        note = "Claude wasn't reachable, so this is a plain name/domain match — check it before filing.";
      }
    }

    return NextResponse.json({
      best,
      alternatives,
      allCustomers: customers,
      source,
      note,
    });
  } catch (err) {
    console.error("[/api/drive/match]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
