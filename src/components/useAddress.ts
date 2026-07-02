"use client";

import { useSyncExternalStore } from "react";
import { SAMPLE_ADDRESS } from "@/server/seed";

const KEY = "tfr-address";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("tfr-address-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("tfr-address-change", callback);
  };
}

const getSnapshot = () => window.localStorage.getItem(KEY) ?? SAMPLE_ADDRESS;
const getServerSnapshot = () => SAMPLE_ADDRESS;

/**
 * Saved address — persisted in localStorage. Drives the header chip,
 * "How your reps voted", and the digest. Falls back to the placeholder
 * sample address until the user enters their own.
 */
export function useAddress() {
  const address = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function setAddress(next: string) {
    window.localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event("tfr-address-change"));
  }

  return { address, setAddress };
}
