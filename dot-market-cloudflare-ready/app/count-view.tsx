"use client";

import { useEffect, useRef } from "react";
import type { ViewEvent } from "../db/stats";

/**
 * Tells the server this page was looked at.
 *
 * Renders nothing. The ref guards against the double-invoked effect in
 * development, which would otherwise count every view twice.
 */
export default function CountView({ event }: { event: ViewEvent }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch("/api/stats/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => undefined);
  }, [event]);

  return null;
}
