/**
 * Official photo placeholder — circular diagonal hatch with a mono "photo"
 * label. Accepts a real photo URL in production; falls back gracefully.
 */
export function Avatar({
  size = 44,
  src,
  alt = "",
}: {
  size?: number;
  src?: string;
  alt?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className="flex-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="hatch flex flex-none items-center justify-center rounded-full font-mono text-[8px] text-hatch-label"
      style={{ width: size, height: size }}
    >
      photo
    </span>
  );
}
