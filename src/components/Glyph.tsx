/**
 * Thin-stroke inline icons replacing the prototype's unicode glyphs
 * (✓ ✕ ○ ⌖ ⌄ ⌃), per the handoff's iconography note. Each vote glyph is
 * always paired with its word and border style — never color alone.
 */
const PATHS: Record<string, React.ReactNode> = {
  check: <path d="M2 6.5 L4.8 9.3 L10 3.2" />,
  cross: <path d="M3 3 L9 9 M9 3 L3 9" />,
  circle: <circle cx="6" cy="6" r="3.6" />,
  target: (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <path d="M6 0.8 V3 M6 9 V11.2 M0.8 6 H3 M9 6 H11.2" />
    </>
  ),
  "chevron-down": <path d="M2.5 4.5 L6 8 L9.5 4.5" />,
  "chevron-up": <path d="M2.5 7.5 L6 4 L9.5 7.5" />,
};

export type GlyphName = keyof typeof PATHS;

export function Glyph({
  name,
  className = "",
}: {
  name: GlyphName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={`inline-block size-[1em] shrink-0 align-[-0.1em] ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The glyph conventionally paired with each vote choice. */
export const VOTE_GLYPH: Record<"yes" | "no" | "absent", GlyphName> = {
  yes: "check",
  no: "cross",
  absent: "circle",
};
