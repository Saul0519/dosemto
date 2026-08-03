"use client";

import { useRouter } from "next/navigation";

/**
 * Re-shuffles the market list.
 *
 * The shuffle seed is made here, on click, rather than while the page renders.
 * A server component may not call Math.random during render — it runs more than
 * once per request, so the server and the browser would disagree about the
 * order. Choosing the seed from an event and carrying it in the URL keeps every
 * render of that URL identical, and pressing this again gives a new one.
 */
export default function ShuffleButton({ active, label, hint }: {
  active: boolean;
  label: string;
  hint: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      title={hint}
      aria-current={active ? "true" : undefined}
      onClick={() => {
        const seed = Math.floor(Math.random() * 1_000_000_000) + 1;
        router.push(`/?sort=random&seed=${seed}#shops`, { scroll: false });
      }}
    >
      {active ? `${label} ↻` : label}
    </button>
  );
}
