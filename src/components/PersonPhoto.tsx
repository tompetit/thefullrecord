"use client";

import { useState } from "react";
import { Monogram } from "@/components/guide/ui";

/** Official portrait with a monogram fallback if the image is missing or fails to load. */
export function PersonPhoto({ name, url, size = 56 }: { name: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <Monogram name={name} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`Portrait of ${name}`}
      loading="lazy"
      width={size}
      height={Math.round(size * 1.22)}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="flex-none rounded-[2px] bg-neutral-chip object-cover"
      style={{ width: size, height: Math.round(size * 1.22) }}
    />
  );
}
