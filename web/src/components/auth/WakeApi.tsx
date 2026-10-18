"use client";

import { useEffect } from "react";
import { wakeApi } from "@/lib/api";

/** Starts the API while the visitor fills in the form, so submitting doesn't wait for it. */
export function WakeApi() {
  useEffect(() => {
    wakeApi().catch(() => {});
  }, []);
  return null;
}
