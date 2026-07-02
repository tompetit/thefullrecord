import type { VoteChoice } from "@/server/types";
import { Glyph, VOTE_GLYPH } from "./Glyph";

/**
 * The vote badge — glyph + word + border style, never color alone.
 * Yes = green tint; No = warm umber (never red); Absent = dashed border.
 */
const VARIANTS: Record<
  VoteChoice,
  {
    word: string;
    sub: string;
    box: string;
    wordColor: string;
    subColor: string;
  }
> = {
  yes: {
    word: "Yes",
    sub: "VOTED",
    box: "bg-accent-tint border-[1.5px] border-solid border-accent",
    wordColor: "text-accent-deep",
    subColor: "text-accent-soft",
  },
  no: {
    word: "No",
    sub: "VOTED",
    box: "bg-umber-tint border-[1.5px] border-solid border-umber",
    wordColor: "text-umber-deep",
    subColor: "text-umber-soft",
  },
  absent: {
    word: "Absent",
    sub: "NO VOTE",
    box: "bg-transparent border-[1.5px] border-dashed border-[#c9c0ac]",
    wordColor: "text-ink-45",
    subColor: "text-ink-35",
  },
};

export function VoteBadge({
  vote,
  compact = false,
}: {
  vote: VoteChoice;
  compact?: boolean;
}) {
  const v = VARIANTS[vote];
  if (compact) {
    return (
      <span
        className={`inline-flex flex-none items-center gap-1 rounded-md px-2 py-1 ${v.box}`}
      >
        <span
          className={`inline-flex items-center gap-1 font-serif text-[13px] font-black leading-none ${v.wordColor}`}
        >
          <Glyph name={VOTE_GLYPH[vote]} className="text-[11px]" />
          {v.word}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`flex flex-none flex-col items-center gap-0.5 rounded-lg px-3 py-[7px] ${v.box}`}
    >
      <span className={`font-serif text-[17px] font-black leading-none ${v.wordColor}`}>
        {v.word}
      </span>
      <span
        className={`inline-flex items-center gap-0.5 font-sans text-[9.5px] font-semibold tracking-[0.04em] ${v.subColor}`}
      >
        <Glyph name={VOTE_GLYPH[vote]} />
        {v.sub}
      </span>
    </span>
  );
}
