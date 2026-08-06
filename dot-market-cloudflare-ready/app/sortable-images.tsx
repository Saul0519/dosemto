"use client";

import { PointerEvent as ReactPointerEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

export type SortableImage = { id: string; url: string; alt: string };

/** Far enough that a scroll gesture is not mistaken for a drag. */
const SLOP = 8;
/** How long a finger has to rest before the tile starts following it. */
const HOLD_MS = 220;

/**
 * A row of pictures that can be dragged into a new order.
 *
 * The first slot is the cover, marked as such, so putting a picture there is
 * the whole of choosing one — there is no separate button to press.
 *
 * Pointer events rather than HTML drag-and-drop, because the latter does
 * nothing on a phone. On a mouse the drag starts immediately; on a finger it
 * waits for a short press, so an ordinary swipe still scrolls the page.
 */
export default function SortableImages({
  images, onReorder, onRemove, busy, children,
}: {
  images: SortableImage[];
  /** Called with the new order once a drag settles on something different. */
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  busy: boolean;
  /** The add-a-picture control, placed after the tiles. */
  children?: React.ReactNode;
}) {
  const [order, setOrder] = useState(images);
  const [dragging, setDragging] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const hold = useRef<number | undefined>(undefined);
  const grab = useRef<{ id: string; x: number; y: number; pointerId: number; live: boolean } | null>(null);
  // What the order was when the drag began, so an unchanged drop saves nothing.
  const before = useRef<string[]>([]);

  // Uploads and deletions arrive from the server; adopt them unless the person
  // is mid-drag, which would yank the tile out from under them.
  useEffect(() => {
    if (!grab.current?.live) setOrder(images);
  }, [images]);

  useEffect(() => () => window.clearTimeout(hold.current), []);

  const indexAt = (x: number, y: number) => {
    const tiles = strip.current?.querySelectorAll("[data-tile]");
    if (!tiles) return -1;
    for (let at = 0; at < tiles.length; at++) {
      const box = tiles[at].getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return at;
    }
    return -1;
  };

  const move = (from: number, to: number) => {
    setOrder((current) => {
      if (from === to || to < 0 || to >= current.length) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };

  const start = (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    grab.current = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, live: false };
    before.current = order.map((image) => image.id);
    const target = event.currentTarget;
    const arm = () => {
      if (!grab.current) return;
      grab.current.live = true;
      // Capture keeps the moves coming even once the pointer leaves the tile.
      // It throws if the pointer is already gone, and that must not take the
      // rest of the drag down with it.
      try {
        target.setPointerCapture(grab.current.pointerId);
      } catch {
        // Without capture the drag still works while the pointer stays inside.
      }
      setDragging(grab.current.id);
    };
    if (event.pointerType === "mouse") arm();
    else hold.current = window.setTimeout(arm, HOLD_MS);
  };

  const over = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = grab.current;
    if (!held) return;
    if (!held.live) {
      // Moved before the press registered: this is a scroll, not a drag.
      if (Math.abs(event.clientX - held.x) > SLOP || Math.abs(event.clientY - held.y) > SLOP) {
        window.clearTimeout(hold.current);
        grab.current = null;
      }
      return;
    }
    const to = indexAt(event.clientX, event.clientY);
    const from = order.findIndex((image) => image.id === held.id);
    if (to >= 0 && from >= 0) move(from, to);
  };

  const end = () => {
    window.clearTimeout(hold.current);
    const held = grab.current;
    grab.current = null;
    setDragging(null);
    if (!held?.live) return;
    const ids = order.map((image) => image.id);
    if (ids.join() !== before.current.join()) onReorder(ids);
  };

  /** Arrow keys do the same job for anyone not using a pointer. */
  const nudge = (event: KeyboardEvent<HTMLDivElement>, at: number) => {
    const to = event.key === "ArrowLeft" ? at - 1 : event.key === "ArrowRight" ? at + 1 : -1;
    if (to < 0 || to >= order.length) return;
    event.preventDefault();
    move(at, to);
    const ids = [...order.map((image) => image.id)];
    ids.splice(to, 0, ids.splice(at, 1)[0]);
    onReorder(ids);
  };

  return (
    <div className="sortable-strip" ref={strip}>
      {order.map((image, at) => (
        <div
          data-tile
          key={image.id}
          className={`sortable-tile${at === 0 ? " is-cover" : ""}${dragging === image.id ? " is-held" : ""}`}
          onPointerDown={(event) => start(image.id, event)}
          onPointerMove={over}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(event) => nudge(event, at)}
          tabIndex={0}
          role="button"
          aria-label={`${at + 1}번째 사진${at === 0 ? " (대표)" : ""}. 끌어서 옮기거나 좌우 화살표로 순서를 바꿉니다.`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.alt} draggable={false}/>
          {at === 0 && <b className="cover-flag">대표</b>}
          <button
            type="button"
            className="tile-drop"
            disabled={busy}
            aria-label="이 사진 지우기"
            // The tile owns the drag, so the button has to keep its click.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemove(image.id)}
          >×</button>
        </div>
      ))}
      {children}
    </div>
  );
}
