/**
 * Summary-provenance marker — present on every summary. AI-generated text
 * gets the AI marker; official CRS/LRS text is labeled as such (never
 * pass official text off as AI or vice versa). Reads as rigor, not a
 * legal disclaimer.
 */
export function AiMarker({
  billTextUrl,
  source = "ai",
  amended = false,
}: {
  billTextUrl: string;
  source?: "ai" | "official";
  /** The motion concerns an amendment, so the summary may describe the amended bill. */
  amended?: boolean;
}) {
  return (
    <div className="mt-[9px] flex flex-wrap items-center gap-1.5 font-sans text-[11px] text-ink-45">
      <span className="rounded-full border border-chip-border px-2 py-0.5">
        {source === "ai" ? "AI summary" : amended ? "Latest official summary of the bill (as amended)" : "Official summary"} —{" "}
        <a
          href={billTextUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-ink-60 underline"
        >
          read the bill text ↗
        </a>
      </span>
    </div>
  );
}
