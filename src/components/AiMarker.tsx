import { ReportIssue } from "./ReportIssue";
import type { IssueReport } from "@/server/types";

/**
 * AI transparency marker — present on every AI-generated summary.
 * Reads as rigor, not a legal disclaimer.
 */
export function AiMarker({
  billTextUrl,
  subjectType,
  subjectId,
}: {
  billTextUrl: string;
  subjectType: IssueReport["subjectType"];
  subjectId: string;
}) {
  return (
    <div className="mt-[9px] flex flex-wrap items-center gap-1.5 font-sans text-[11px] text-ink-45">
      <span className="rounded-full border border-chip-border px-2 py-0.5">
        AI summary —{" "}
        <a
          href={billTextUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink-60 underline"
        >
          read the bill text ↗
        </a>
      </span>
      <ReportIssue subjectType={subjectType} subjectId={subjectId} />
    </div>
  );
}
