"use client";

interface Props {
  href: string;
  color: string;
  bg: string;
  bd: string;
  label: string;
}

export function LinkBtn({ href, color, bg, bd, label }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${bd}`,
        borderRadius: 4,
        padding: "2px 7px",
        textDecoration: "none",
        whiteSpace: "nowrap",
        lineHeight: 1.6,
      }}
    >
      ↗ {label}
    </a>
  );
}
