"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { C } from "@/lib/constants";
import { RichTextEditor } from "@/components/wiki/RichTextEditor";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WikiCategory {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  icon: string | null;
  children: WikiCategory[];
}

interface WikiPage {
  id: number;
  title: string;
  slug: string;
  body: string;
  category_id: number | null;
  author: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  wiki_categories?: { id: number; name: string; slug: string } | null;
}

type WikiView = "home" | "page" | "edit";

interface EditForm {
  title: string;
  slug: string;
  content: string;
  category_id: string;
  author: string;
  is_pinned: boolean;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function escHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFmt(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g,
      `<code style="background:#F7F9FC;border:1px solid #E2E5EA;border-radius:4px;padding:1px 6px;font-family:'DM Mono',monospace;font-size:12px">$1</code>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      `<a href="$2" target="_blank" rel="noopener" style="color:#1A56DB;text-decoration:none;border-bottom:1px solid #93C5FD">$1</a>`);
}

function renderMd(raw: string): string {
  const blocks = raw.split(/\n\n+/);
  return blocks.map(block => {
    block = block.trim();
    if (!block) return "";

    // Code block
    const codeMatch = block.match(/^```(?:\w*)?\n?([\s\S]*?)```$/);
    if (codeMatch) {
      return `<pre style="background:#F7F9FC;border:1px solid #E2E5EA;border-radius:8px;padding:14px 16px;overflow-x:auto;margin:14px 0"><code style="font-family:'DM Mono',monospace;font-size:12.5px;line-height:1.6;color:#0D1117">${escHtml(codeMatch[1].trim())}</code></pre>`;
    }

    // Headings (each line evaluated independently)
    if (/^#{1,4} /.test(block)) {
      return block.split("\n").map(line => {
        const m4 = line.match(/^#### (.+)$/);
        const m3 = line.match(/^### (.+)$/);
        const m2 = line.match(/^## (.+)$/);
        const m1 = line.match(/^# (.+)$/);
        if (m4) return `<h4 style="font-size:13px;font-weight:700;color:#0D1117;margin:16px 0 6px">${inlineFmt(escHtml(m4[1]))}</h4>`;
        if (m3) return `<h3 style="font-size:16px;font-weight:700;color:#0D1117;margin:20px 0 8px">${inlineFmt(escHtml(m3[1]))}</h3>`;
        if (m2) return `<h2 style="font-size:19px;font-weight:700;color:#0D1117;margin:26px 0 10px;padding-bottom:8px;border-bottom:1px solid #E2E5EA">${inlineFmt(escHtml(m2[1]))}</h2>`;
        if (m1) return `<h1 style="font-size:24px;font-weight:800;color:#0D1117;margin:0 0 16px">${inlineFmt(escHtml(m1[1]))}</h1>`;
        return `<p style="margin:0 0 10px;color:#0D1117;line-height:1.7;font-size:14px">${inlineFmt(escHtml(line))}</p>`;
      }).join("\n");
    }

    // Horizontal rule
    if (/^---+$/.test(block)) {
      return `<hr style="border:none;border-top:1px solid #E2E5EA;margin:24px 0"/>`;
    }

    // Blockquote
    if (block.startsWith("> ")) {
      const content = block.split("\n").map(l => l.replace(/^> ?/, "")).join("<br/>");
      return `<blockquote style="margin:14px 0;padding:10px 16px;background:#EBF5FF;border-left:3px solid #93C5FD;border-radius:0 6px 6px 0;color:#4A5568;font-size:14px;line-height:1.6">${inlineFmt(escHtml(content))}</blockquote>`;
    }

    // List
    if (/^(?:[-*]|\d+\.) /.test(block)) {
      const lines = block.split("\n");
      const isOl = /^\d+\. /.test(lines[0]);
      const items = lines.map(l => {
        const m = l.match(/^(?:[-*]|\d+\.) (.+)$/);
        return m ? `<li style="margin:4px 0;line-height:1.6;color:#0D1117">${inlineFmt(escHtml(m[1]))}</li>` : "";
      }).filter(Boolean).join("\n");
      const listStyle = `style="margin:10px 0;padding-left:22px;color:#0D1117"`;
      return isOl ? `<ol ${listStyle}>${items}</ol>` : `<ul ${listStyle}>${items}</ul>`;
    }

    // Default: paragraph
    const content = block.split("\n").map(l => inlineFmt(escHtml(l))).join("<br/>");
    return `<p style="margin:0 0 12px;color:#0D1117;line-height:1.7;font-size:14px">${content}</p>`;
  }).join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "");
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function flattenCats(cats: WikiCategory[], depth = 0): Array<{ id: number; name: string; depth: number }> {
  return cats.flatMap(c => [
    { id: c.id, name: c.name, depth },
    ...flattenCats(c.children ?? [], depth + 1),
  ]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WikiView({ userEmail }: { userEmail?: string | null }) {
  const [view, setView]               = useState<WikiView>("home");
  const [pages, setPages]             = useState<WikiPage[]>([]);
  const [categories, setCategories]   = useState<WikiCategory[]>([]);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WikiPage[]>([]);
  const [searching, setSearching]     = useState(false);
  const [loading, setLoading]         = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isNew, setIsNew]             = useState(false);
  const [editorKey, setEditorKey]     = useState(0); // force re-mount on new/edit switch

  const defaultAuthor = userEmail?.split("@")[0]?.replace(/\./g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "CEBA Staff";

  const [editForm, setEditForm] = useState<EditForm>({
    title: "", slug: "", content: "", category_id: "", author: defaultAuthor, is_pinned: false,
  });

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Load categories + pages ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pagesRes, catsRes] = await Promise.all([
        fetch("/api/wiki/pages"),
        fetch("/api/wiki/categories"),
      ]);
      const [pagesData, catsData] = await Promise.all([pagesRes.json(), catsRes.json()]);
      setPages(pagesData.pages ?? []);
      setCategories(catsData.categories ?? []);
    } catch {
      setError("Failed to load wiki data. Check that the Supabase schema has been applied.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/wiki/search?q=${encodeURIComponent(searchQuery)}`);
        const d = await r.json();
        setSearchResults(d.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [searchQuery]);

  // ── Page load ─────────────────────────────────────────────────────────────
  async function loadPage(slug: string) {
    setPageLoading(true);
    setConfirmDelete(false);
    try {
      const r = await fetch(`/api/wiki/pages/${slug}`);
      const d = await r.json();
      if (d.page) { setSelectedPage(d.page); setView("page"); }
    } finally {
      setPageLoading(false);
    }
  }

  // ── Open editor ───────────────────────────────────────────────────────────
  function openEdit(page?: WikiPage) {
    setError(null);
    setEditorKey(k => k + 1);
    if (page) {
      setEditForm({ title: page.title, slug: page.slug, content: page.body, category_id: page.category_id?.toString() ?? "", author: page.author, is_pinned: page.is_pinned });
      setIsNew(false);
    } else {
      setEditForm({ title: "", slug: "", content: "", category_id: "", author: defaultAuthor, is_pinned: false });
      setIsNew(true);
    }
    setView("edit");
  }

  // ── Save page ─────────────────────────────────────────────────────────────
  async function savePage() {
    if (!editForm.title.trim() || !editForm.slug.trim()) {
      setError("Title and slug are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title:       editForm.title.trim(),
        slug:        editForm.slug.trim(),
        content:     editForm.content,
        category_id: editForm.category_id ? parseInt(editForm.category_id) : null,
        author:      editForm.author.trim() || defaultAuthor,
        is_pinned:   editForm.is_pinned,
      };
      const url    = isNew ? "/api/wiki/pages" : `/api/wiki/pages/${editForm.slug}`;
      const method = isNew ? "POST" : "PUT";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Save failed");
      await loadData();
      await loadPage(editForm.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete page ───────────────────────────────────────────────────────────
  async function deletePage(slug: string) {
    setSaving(true);
    try {
      await fetch(`/api/wiki/pages/${slug}`, { method: "DELETE" });
      await loadData();
      setSelectedPage(null);
      setConfirmDelete(false);
      setView("home");
    } finally {
      setSaving(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const flatCats      = flattenCats(categories);
  const filteredPages = categoryFilter ? pages.filter(p => p.category_id === categoryFilter) : pages;
  const pinnedPages   = pages.filter(p => p.is_pinned);
  const recentPages   = [...pages].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 10);

  // ── Page card ─────────────────────────────────────────────────────────────
  function PageCard({ p }: { p: WikiPage }) {
    return (
      <button
        onClick={() => loadPage(p.slug)}
        style={{
          display: "block", width: "100%", background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "12px 16px", cursor: "pointer", textAlign: "left",
          fontFamily: C.font, boxShadow: C.sh,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 3 }}>
              {p.is_pinned && <span style={{ marginRight: 5, fontSize: 12 }}>📌</span>}
              {p.title}
            </div>
            <div style={{ fontSize: 11.5, color: C.textSub, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {p.wiki_categories?.name && (
                <span style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
                  {p.wiki_categories.name}
                </span>
              )}
              <span>by {p.author}</span>
              <span style={{ color: C.border }}>·</span>
              <span>{timeAgo(p.updated_at)}</span>
            </div>
          </div>
          <span style={{ fontSize: 11, color: C.textSub, flexShrink: 0, marginTop: 2 }}>→</span>
        </div>
      </button>
    );
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  function CategoryItem({ cat, depth = 0 }: { cat: WikiCategory; depth?: number }) {
    const isActive = categoryFilter === cat.id;
    return (
      <div>
        <button
          onClick={() => { setCategoryFilter(cat.id); setView("home"); setSearchQuery(""); }}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            width: "100%", padding: `6px 14px 6px ${14 + depth * 14}px`,
            background: isActive ? C.blueBg : "none", border: "none",
            borderLeft: isActive ? `3px solid ${C.blue}` : "3px solid transparent",
            cursor: "pointer", textAlign: "left", fontSize: 12.5,
            color: isActive ? C.blue : C.textMid, fontFamily: C.font,
            fontWeight: isActive ? 600 : 400,
          }}
        >
          <span style={{ fontSize: 13 }}>{cat.icon ?? "📁"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</span>
        </button>
        {cat.children?.map(child => <CategoryItem key={child.id} cat={child} depth={depth + 1} />)}
      </div>
    );
  }

  const Sidebar = () => (
    <aside style={{
      width: 240, flexShrink: 0, background: C.surface, borderRadius: 12,
      border: `1px solid ${C.border}`, boxShadow: C.sh, padding: "16px 0",
      alignSelf: "flex-start", position: "sticky", top: 80,
      maxHeight: "calc(100vh - 108px)", overflowY: "auto",
    }}>
      {/* Search */}
      <div style={{ padding: "0 14px 12px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.textSub, pointerEvents: "none" }}>🔍</span>
          <input
            type="text"
            placeholder="Search wiki…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", background: C.alt,
              border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "7px 10px 7px 30px", fontSize: 12, color: C.text,
              fontFamily: C.font, outline: "none",
            }}
          />
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: "8px 0" }}>
        <button
          onClick={() => { setView("home"); setCategoryFilter(null); setSearchQuery(""); }}
          style={{
            display: "flex", alignItems: "center", gap: 7, width: "100%",
            padding: "7px 14px", border: "none",
            borderLeft: view === "home" && !categoryFilter && !searchQuery ? `3px solid ${C.blue}` : "3px solid transparent",
            background: view === "home" && !categoryFilter && !searchQuery ? C.blueBg : "none",
            cursor: "pointer", textAlign: "left", fontSize: 12.5, fontWeight: 600,
            color: view === "home" && !categoryFilter && !searchQuery ? C.blue : C.textMid,
            fontFamily: C.font,
          }}
        >
          🏠 <span>Home</span>
        </button>

        <div style={{ padding: "10px 14px 4px", fontSize: 10, fontWeight: 700, color: C.textSub, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Categories
        </div>
        {categories.map(cat => <CategoryItem key={cat.id} cat={cat} />)}
        {categories.length === 0 && !loading && (
          <div style={{ padding: "4px 14px", fontSize: 12, color: C.textSub, fontStyle: "italic" }}>No categories</div>
        )}
      </div>

      {/* New Page */}
      <div style={{ padding: "12px 14px 4px", borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={() => openEdit()}
          style={{
            width: "100%", background: "linear-gradient(135deg, #1A56DB, #2563EB)",
            color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px",
            fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
            display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
          }}
        >
          + New Page
        </button>
      </div>

      {/* Stats */}
      <div style={{ padding: "12px 14px 4px", display: "flex", gap: 10 }}>
        <div style={{ fontSize: 11, color: C.textSub }}>
          <span style={{ fontFamily: C.mono, fontWeight: 700, color: C.textMid }}>{pages.length}</span> pages
        </div>
        <div style={{ fontSize: 11, color: C.textSub }}>
          <span style={{ fontFamily: C.mono, fontWeight: 700, color: C.textMid }}>{flatCats.length}</span> categories
        </div>
      </div>
    </aside>
  );

  // ── Home view ─────────────────────────────────────────────────────────────
  function HomeView() {
    // Search results
    if (searchQuery.trim()) {
      return (
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: C.text, marginBottom: 4 }}>
            Search Results
          </div>
          <div style={{ fontSize: 12, color: C.textSub, marginBottom: 20 }}>
            {searching ? "Searching…" : `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${searchQuery}"`}
          </div>
          {!searching && searchResults.length === 0 && (
            <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 14, marginBottom: 8 }}>No pages found for "{searchQuery}"</div>
              <button onClick={() => openEdit()} style={{ marginTop: 12, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                + Create a page
              </button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {searchResults.map(p => <PageCard key={p.id} p={p} />)}
          </div>
        </div>
      );
    }

    // Category filtered list
    if (categoryFilter) {
      const cat = flatCats.find(c => c.id === categoryFilter);
      return (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: C.text }}>{cat?.name ?? "Category"}</div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>
                {filteredPages.length} page{filteredPages.length !== 1 ? "s" : ""}
              </div>
            </div>
            <button onClick={() => openEdit()} style={{ background: "linear-gradient(135deg, #1A56DB, #2563EB)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
              + New Page
            </button>
          </div>
          {filteredPages.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 14, marginBottom: 16 }}>No pages in this category yet.</div>
              <button onClick={() => openEdit()} style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                + Create first page
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredPages.map(p => <PageCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      );
    }

    // Default home
    return (
      <div>
        {/* Hero */}
        <div style={{
          background: "linear-gradient(135deg, #0A0F1E 0%, #0D1B35 50%, #0A1628 100%)",
          borderRadius: 12, padding: "24px 28px", marginBottom: 24, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
        }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📚 Company Wiki</div>
            <div style={{ fontSize: 13, color: "#94A3B8" }}>
              CEBA Solutions internal knowledge base — SOPs, guides, and company resources.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
            {[
              { val: pages.length,    label: "pages" },
              { val: flatCats.length, label: "categories" },
              { val: pinnedPages.length, label: "pinned" },
            ].map(({ val, label }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: C.mono, fontWeight: 700, color: "#93C5FD", fontSize: 20, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 10, color: "#64748B", marginTop: 3 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Empty state */}
        {pages.length === 0 && (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 8 }}>No pages yet</div>
            <div style={{ fontSize: 13, color: C.textSub, marginBottom: 24 }}>
              Run the wiki schema in Supabase then create your first page.
            </div>
            <button onClick={() => openEdit()} style={{ background: "linear-gradient(135deg, #1A56DB, #2563EB)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 28px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
              + Create First Page
            </button>
          </div>
        )}

        {/* Pinned */}
        {pinnedPages.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              📌 Pinned Pages
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              {pinnedPages.map(p => (
                <button
                  key={p.id}
                  onClick={() => loadPage(p.slug)}
                  style={{
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: "14px 16px", cursor: "pointer", textAlign: "left", fontFamily: C.font, boxShadow: C.sh,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 5 }}>{p.title}</div>
                  <div style={{ fontSize: 11, color: C.textSub }}>{p.wiki_categories?.name ?? "General"}</div>
                  <div style={{ fontSize: 10, color: C.textSub, marginTop: 4 }}>{timeAgo(p.updated_at)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recently Updated */}
        {recentPages.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              🕐 Recently Updated
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentPages.map(p => <PageCard key={p.id} p={p} />)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Page view ─────────────────────────────────────────────────────────────
  function PageViewContent() {
    if (pageLoading) {
      return <div style={{ padding: "60px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>Loading…</div>;
    }
    if (!selectedPage) return null;

    return (
      <div>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textSub, marginBottom: 20, flexWrap: "wrap" }}>
          <button onClick={() => setView("home")} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontFamily: C.font, fontSize: 12, padding: 0 }}>
            Home
          </button>
          {selectedPage.wiki_categories?.name && (
            <>
              <span>/</span>
              <button
                onClick={() => { setCategoryFilter(selectedPage.category_id); setView("home"); }}
                style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontFamily: C.font, fontSize: 12, padding: 0 }}
              >
                {selectedPage.wiki_categories.name}
              </button>
            </>
          )}
          <span>/</span>
          <span style={{ color: C.text, fontWeight: 600 }}>{selectedPage.title}</span>
        </div>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: "0 0 8px", fontFamily: C.font }}>
              {selectedPage.is_pinned && <span style={{ marginRight: 8, fontSize: 20 }}>📌</span>}
              {selectedPage.title}
            </h1>
            <div style={{ fontSize: 12, color: C.textSub, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {selectedPage.wiki_categories?.name && (
                <span style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 5, padding: "2px 8px", fontSize: 11 }}>
                  {selectedPage.wiki_categories.name}
                </span>
              )}
              <span>by <strong style={{ color: C.textMid }}>{selectedPage.author}</strong></span>
              <span style={{ color: C.border }}>·</span>
              <span>Updated {timeAgo(selectedPage.updated_at)}</span>
              <span style={{ color: C.border }}>·</span>
              <span>Created {new Date(selectedPage.created_at).toLocaleDateString("en-AU")}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => openEdit(selectedPage)}
              style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}
            >
              ✏️ Edit
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{ background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}
              >
                🗑 Delete
              </button>
            ) : (
              <>
                <button
                  onClick={() => deletePage(selectedPage.slug)}
                  disabled={saving}
                  style={{ background: C.red, color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{ background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: C.border, marginBottom: 28 }} />

        {/* Body — HTML from WYSIWYG editor, or legacy Markdown */}
        {selectedPage.body ? (
          <div
            className="wiki-body"
            style={{ maxWidth: 760, fontFamily: C.font }}
            dangerouslySetInnerHTML={{
              __html: selectedPage.body.trimStart().startsWith("<")
                ? selectedPage.body
                : renderMd(selectedPage.body),
            }}
          />
        ) : (
          <div style={{ padding: "40px 0", textAlign: "center", color: C.textSub, fontSize: 14 }}>
            This page has no content yet.
            <div style={{ marginTop: 14 }}>
              <button onClick={() => openEdit(selectedPage)} style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                ✏️ Add Content
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Edit view ─────────────────────────────────────────────────────────────
  function EditViewContent() {
    return (
      <div style={{ maxWidth: 900 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: C.text }}>{isNew ? "✨ New Page" : "✏️ Edit Page"}</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>
              {isNew ? "Create a new wiki page" : `Editing: ${editForm.title || editForm.slug}`}
            </div>
          </div>
          <button
            onClick={() => { setView(selectedPage ? "page" : "home"); setError(null); }}
            style={{ background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}
          >
            Cancel
          </button>
        </div>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.red, fontWeight: 500 }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: "grid", gap: 16 }}>
          {/* Title + Slug */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Title *</label>
              <input
                type="text"
                value={editForm.title}
                onChange={e => {
                  const title = e.target.value;
                  setEditForm(f => ({ ...f, title, ...(isNew ? { slug: slugify(title) } : {}) }));
                }}
                placeholder="Page title"
                style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: C.text, fontFamily: C.font, outline: "none", background: C.surface }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Slug * {!isNew && <span style={{ fontWeight: 400, fontSize: 10 }}>(locked after creation)</span>}
              </label>
              <input
                type="text"
                value={editForm.slug}
                onChange={e => isNew && setEditForm(f => ({ ...f, slug: e.target.value }))}
                placeholder="page-slug"
                readOnly={!isNew}
                style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: isNew ? C.text : C.textSub, fontFamily: C.mono, outline: "none", background: isNew ? C.surface : C.alt, cursor: isNew ? "text" : "default" }}
              />
            </div>
          </div>

          {/* Category + Author + Pinned */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 16, alignItems: "end" }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Category</label>
              <select
                value={editForm.category_id}
                onChange={e => setEditForm(f => ({ ...f, category_id: e.target.value }))}
                style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: C.text, fontFamily: C.font, outline: "none", background: C.surface }}
              >
                <option value="">— No Category —</option>
                {flatCats.map(c => (
                  <option key={c.id} value={c.id}>
                    {"  ".repeat(c.depth)}{c.depth > 0 ? "└ " : ""}{c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Author</label>
              <input
                type="text"
                value={editForm.author}
                onChange={e => setEditForm(f => ({ ...f, author: e.target.value }))}
                placeholder="Your name"
                style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: C.text, fontFamily: C.font, outline: "none", background: C.surface }}
              />
            </div>
            <div style={{ paddingBottom: 2 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: C.textMid, fontWeight: 600, whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={editForm.is_pinned}
                  onChange={e => setEditForm(f => ({ ...f, is_pinned: e.target.checked }))}
                  style={{ width: 15, height: 15, cursor: "pointer" }}
                />
                📌 Pinned
              </label>
            </div>
          </div>

          {/* WYSIWYG editor */}
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Content
            </label>
            <RichTextEditor
              key={editorKey}
              content={editForm.content}
              onChange={html => setEditForm(f => ({ ...f, content: html }))}
              placeholder="Start writing your page content here…"
            />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
            <button
              onClick={() => { setView(selectedPage ? "page" : "home"); setError(null); }}
              style={{ background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}
            >
              Cancel
            </button>
            <button
              onClick={savePage}
              disabled={saving}
              style={{
                background: saving ? C.alt : "linear-gradient(135deg, #1A56DB, #2563EB)",
                color: saving ? C.textSub : "#fff", border: "none", borderRadius: 8,
                padding: "9px 24px", fontSize: 13, fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer", fontFamily: C.font,
                boxShadow: saving ? "none" : "0 2px 8px rgba(26,86,219,0.3)",
              }}
            >
              {saving ? "Saving…" : isNew ? "✓ Create Page" : "✓ Save Changes"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 260, color: C.textSub, fontSize: 14, fontFamily: C.font }}>
        Loading wiki…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", fontFamily: C.font }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: C.sh, padding: "24px 28px" }}>
        {view === "home" && <HomeView />}
        {view === "page" && <PageViewContent />}
        {view === "edit" && <EditViewContent />}
      </main>
    </div>
  );
}
