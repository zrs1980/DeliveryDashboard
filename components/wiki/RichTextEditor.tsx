"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { C } from "@/lib/constants";

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

function ToolBtn({
  active, onClick, title, disabled, children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      disabled={disabled}
      style={{
        background: active ? C.blueBg : "transparent",
        color: active ? C.blue : disabled ? C.textSub : C.textMid,
        border: active ? `1px solid ${C.blueBd}` : "1px solid transparent",
        borderRadius: 5, padding: "3px 7px", fontSize: 12, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: C.font,
        minWidth: 28, lineHeight: "18px",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return (
    <div style={{ width: 1, height: 20, background: C.border, margin: "0 3px", alignSelf: "center", flexShrink: 0 }} />
  );
}

export function RichTextEditor({ content, onChange, placeholder, minHeight = 380 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: placeholder ?? "Start writing…",
      }),
    ],
    content,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        style: [
          `min-height:${minHeight}px`,
          "padding:16px 18px",
          "outline:none",
          `font-family:${C.font}`,
          "font-size:14px",
          `color:${C.text}`,
          "line-height:1.7",
        ].join(";"),
      },
    },
  });

  if (!editor) return null;

  const btn = (
    active: boolean,
    onClick: () => void,
    label: React.ReactNode,
    title?: string,
    disabled = false
  ) => (
    <ToolBtn key={title} active={active} onClick={onClick} title={title} disabled={disabled}>
      {label}
    </ToolBtn>
  );

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", background: C.surface }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2,
        padding: "7px 10px", borderBottom: `1px solid ${C.border}`, background: C.alt,
      }}>
        {/* Text style */}
        {btn(editor.isActive("bold"),   () => editor.chain().focus().toggleBold().run(),   <strong>B</strong>,   "Bold (Ctrl+B)")}
        {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <em>I</em>,          "Italic (Ctrl+I)")}
        {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), <s>S</s>,            "Strikethrough")}
        {btn(editor.isActive("code"),   () => editor.chain().focus().toggleCode().run(),   <code style={{ fontFamily: C.mono }}>{"<>"}</code>, "Inline code")}
        <Sep />
        {/* Headings */}
        {([1, 2, 3] as const).map(level =>
          btn(
            editor.isActive("heading", { level }),
            () => editor.chain().focus().toggleHeading({ level }).run(),
            `H${level}`, `Heading ${level}`, false
          )
        )}
        <Sep />
        {/* Lists */}
        {btn(editor.isActive("bulletList"),  () => editor.chain().focus().toggleBulletList().run(),  "•—", "Bullet list")}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "1.", "Numbered list")}
        <Sep />
        {/* Blocks */}
        {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), <span style={{ fontStyle: "italic" }}>"</span>, "Blockquote")}
        {btn(editor.isActive("codeBlock"),  () => editor.chain().focus().toggleCodeBlock().run(),  <span style={{ fontFamily: C.mono, fontSize: 11 }}>{"{ }"}</span>, "Code block")}
        {btn(false, () => editor.chain().focus().setHorizontalRule().run(), "—", "Horizontal rule")}
        <Sep />
        {/* History */}
        {btn(false, () => editor.chain().focus().undo().run(), "↩", "Undo", !editor.can().undo())}
        {btn(false, () => editor.chain().focus().redo().run(), "↪", "Redo", !editor.can().redo())}
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} />

      {/* ProseMirror content styles */}
      <style>{`
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: ${C.textSub};
          pointer-events: none;
          float: left;
          height: 0;
        }
        .tiptap h1 { font-size: 22px; font-weight: 800; margin: 0 0 14px; color: ${C.text}; }
        .tiptap h2 { font-size: 18px; font-weight: 700; margin: 22px 0 10px; padding-bottom: 7px; border-bottom: 1px solid ${C.border}; color: ${C.text}; }
        .tiptap h3 { font-size: 15px; font-weight: 700; margin: 18px 0 7px; color: ${C.text}; }
        .tiptap h4 { font-size: 13px; font-weight: 700; margin: 14px 0 5px; color: ${C.text}; }
        .tiptap p  { margin: 0 0 10px; }
        .tiptap ul, .tiptap ol { padding-left: 22px; margin: 8px 0; }
        .tiptap li { margin: 3px 0; line-height: 1.6; }
        .tiptap blockquote {
          margin: 12px 0; padding: 8px 14px;
          background: ${C.blueBg}; border-left: 3px solid ${C.blueBd};
          border-radius: 0 6px 6px 0; color: ${C.textMid};
        }
        .tiptap code {
          background: ${C.alt}; border: 1px solid ${C.border};
          border-radius: 4px; padding: 1px 5px;
          font-family: ${C.mono}; font-size: 12px;
        }
        .tiptap pre {
          background: ${C.alt}; border: 1px solid ${C.border};
          border-radius: 8px; padding: 12px 16px; margin: 12px 0;
          overflow-x: auto;
        }
        .tiptap pre code {
          background: none; border: none; padding: 0;
          font-family: ${C.mono}; font-size: 12.5px; line-height: 1.6;
        }
        .tiptap hr { border: none; border-top: 1px solid ${C.border}; margin: 20px 0; }
        .tiptap strong { font-weight: 700; }
        .tiptap em { font-style: italic; }
        .tiptap s { text-decoration: line-through; }
      `}</style>
    </div>
  );
}
