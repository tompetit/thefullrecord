import type { RelationshipLabel } from "@/server/types";

/**
 * Relationship label pill — describes one statement next to one vote.
 * Never a verdict; no "hypocrite" / "flip-flop" language anywhere.
 */
const LABELS: Record<RelationshipLabel, { text: string; className: string }> = {
  consistent: {
    text: "CONSISTENT",
    className: "text-accent-deep bg-accent-tint border-accent-tint-border",
  },
  in_tension: {
    text: "IN TENSION",
    className: "text-umber-deep bg-umber-tint border-umber-tint-border",
  },
  not_directly_related: {
    text: "NOT DIRECTLY RELATED",
    className: "text-ink-60 bg-neutral-chip border-neutral-chip-border",
  },
};

export function RelationshipPill({ label }: { label: RelationshipLabel }) {
  const l = LABELS[label];
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full border px-[11px] py-1 font-sans text-[10px] font-bold tracking-[0.07em] ${l.className}`}
    >
      {l.text}
    </span>
  );
}

export const relationshipLabelText = (label: RelationshipLabel) =>
  LABELS[label].text;
