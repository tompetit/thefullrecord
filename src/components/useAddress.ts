"use client";

import { useSyncExternalStore } from "react";

const KEY = "tfr-address";
let fallbackAddress = "";

function subscribe(callback: () => void) {
  try { window.localStorage.removeItem(KEY); } catch { /* Storage may be unavailable. */ }
  window.addEventListener("storage", callback);
  window.addEventListener("tfr-address-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("tfr-address-change", callback);
  };
}

function getSnapshot() {
  try {
    return window.sessionStorage.getItem(KEY) ?? fallbackAddress;
  } catch {
    return fallbackAddress;
  }
}
const getServerSnapshot = () => "";

/** Addresses stay in this tab's session; a sample is never treated as the visitor's home. */
export function useAddress() {
  const address = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function setAddress(next: string) {
    fallbackAddress = next.trim();
    try {
      // Remove the previous version's persistent copy, if present.
      window.localStorage.removeItem(KEY);
      if (fallbackAddress) window.sessionStorage.setItem(KEY, fallbackAddress);
      else window.sessionStorage.removeItem(KEY);
    } catch {
      // Storage can be disabled; the lookup must still work.
    }
    window.dispatchEvent(new Event("tfr-address-change"));
  }

  return { address, setAddress, clearAddress: () => setAddress("") };
}
