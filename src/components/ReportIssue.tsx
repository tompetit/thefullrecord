"use client";

import { useState } from "react";
import type { IssueReport } from "@/server/types";

/**
 * "Report an issue" — a lightweight inline control scoped to one specific
 * summary or pair. Present on every AI summary and every Said-vs-did pair.
 */
export function ReportIssue({
  subjectType,
  subjectId,
}: {
  subjectType: IssueReport["subjectType"];
  subjectId: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setState("sending");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId, message }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <span className="font-sans text-[11px] text-ink-45">
        Report received — thank you.
      </span>
    );
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 cursor-pointer items-center font-sans text-[11px] text-ink-45 underline"
      >
        Report an issue
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="absolute left-0 top-full z-10 mt-1 flex w-64 flex-col gap-2 rounded-lg border border-card-strong bg-paper-raised p-3 shadow-card-raised"
        >
          <label className="font-sans text-[11px] font-semibold text-ink-80">
            What looks wrong in this summary?
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="rounded-md border border-chip-border bg-paper p-2 font-sans text-[12px] text-ink-80 outline-none focus:border-ink"
          />
          {state === "error" && (
            <span className="font-sans text-[11px] text-umber-deep">
              Could not send — try again.
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={state === "sending" || !message.trim()}
              className="min-h-11 cursor-pointer rounded-lg bg-ink px-3 font-sans text-[12px] font-bold text-paper disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Send report"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 cursor-pointer font-sans text-[12px] text-ink-45 underline"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </span>
  );
}
