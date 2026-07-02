import type { BillStatusStep } from "@/server/types";

/**
 * Bill status stepper. Completed = filled green dot + green connector;
 * current/future = hollow dot + neutral connector.
 * Horizontal on mobile, vertical variant for the desktop rail.
 */
export function StatusStepper({
  steps,
  vertical = false,
}: {
  steps: BillStatusStep[];
  vertical?: boolean;
}) {
  if (vertical) {
    return (
      <ol className="flex flex-col">
        {steps.map((step, i) => (
          <li key={step.label} className="flex gap-3">
            <span className="flex flex-col items-center">
              <Node state={step.state} />
              {i < steps.length - 1 && (
                <span
                  className={`w-0.5 flex-1 min-h-6 ${
                    step.state === "done" ? "bg-accent" : "bg-[#ddd6c6]"
                  }`}
                />
              )}
            </span>
            <span className="flex flex-col pb-4">
              <span className="font-sans text-xs font-semibold text-ink-80">
                {step.label}
              </span>
              {step.dateLabel && (
                <span className="font-sans text-[11px] text-ink-45">
                  {step.dateLabel}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="flex items-start">
      {steps.map((step, i) => (
        <li key={step.label} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="flex w-full items-center">
            <span
              className={`h-0.5 flex-1 ${
                i === 0
                  ? "bg-transparent"
                  : steps[i - 1].state === "done"
                    ? "bg-accent"
                    : "bg-[#ddd6c6]"
              }`}
            />
            <Node state={step.state} />
            <span
              className={`h-0.5 flex-1 ${
                i === steps.length - 1
                  ? "bg-transparent"
                  : step.state === "done"
                    ? "bg-accent"
                    : "bg-[#ddd6c6]"
              }`}
            />
          </span>
          <span className="text-center font-sans text-[10.5px] font-semibold leading-tight text-ink-80">
            {step.label}
          </span>
          {step.dateLabel && (
            <span className="-mt-1 font-sans text-[10px] text-ink-45">
              {step.dateLabel}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Node({ state }: { state: BillStatusStep["state"] }) {
  return state === "done" ? (
    <span className="size-3 flex-none rounded-full bg-accent" />
  ) : (
    <span className="size-3 flex-none rounded-full border-2 border-[#ddd6c6] bg-paper" />
  );
}
