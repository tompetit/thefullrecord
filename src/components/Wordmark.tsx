import Link from "next/link";

/** "The **Full** Record" — Source Serif, "Full" at weight 900 against 400. */
export function Wordmark({
  className = "text-[19px]",
  asLink = true,
}: {
  className?: string;
  asLink?: boolean;
}) {
  const mark = (
    <span className={`whitespace-nowrap font-serif font-normal text-ink ${className}`}>
      The <span className="font-black">Full</span> Record
    </span>
  );
  if (!asLink) return mark;
  return (
    <Link href="/" className="inline-flex min-h-11 items-center">
      {mark}
    </Link>
  );
}
