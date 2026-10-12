import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Site-wide link: Next's <Link> without viewport prefetching. Each prefetch of a
 * prerendered page is a Vercel ISR read, and list pages (/guide, state pages)
 * held hundreds of links — one visit cost 300+ reads. Navigation stays client-side.
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
