/**
 * Source link — the trust mechanic. Rendered in verified green as a
 * first-class element; never disabled or hidden.
 */
export function SourceLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center font-semibold text-accent no-underline border-b-[1.5px] border-accent pb-px hover:border-b-2 ${className}`}
    >
      {children}
      {" ↗"}
    </a>
  );
}
