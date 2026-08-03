"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type ShopImage = { id: string; filename: string; url: string };

/** Long enough to actually look at a picture, short enough to feel alive. */
const ADVANCE_MS = 4500;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Read as an external store rather than inside an effect, so the first client
 * render already knows the answer instead of starting the slideshow and then
 * stopping it a frame later.
 */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export default function AboutGallery({ images, shopName }: { images: ShopImage[]; shopName: string }) {
  const [selected, setSelected] = useState(0);
  const [wantsPlay, setWantsPlay] = useState(true);
  const [held, setHeld] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const current = Math.min(selected, Math.max(images.length - 1, 0));
  // Someone looking at a picture should not have it pulled away, so pointing at
  // the gallery or tabbing into it holds the current frame.
  const running = wantsPlay && !reducedMotion && !held && images.length > 1;

  // A timeout rather than an interval: it is rescheduled by every change, so
  // picking a thumbnail gives that image a full turn instead of whatever was
  // left of the previous tick.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      setSelected((index) => (index + 1) % images.length);
    }, ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [running, selected, images.length]);

  if (images.length === 0) {
    return (
      <div className="service-gallery-empty">
        <div className="lattice"/>
        <b>아직 등록된 작업 이미지가 없습니다.</b>
        <span>샵에서 올리면 여기 표시됩니다.</span>
      </div>
    );
  }

  return (
    <div
      className="service-gallery"
      role="group"
      aria-roledescription="이미지 슬라이드"
      aria-label={`${shopName} 작업 이미지`}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div className="service-main-image">
        {/* Every frame stays mounted and cross-fades. Swapping one src would
            show the gap while the next image decodes, on every advance. */}
        {images.map((image, index) => (
          // Shop artwork is stored in the site's object storage.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={image.id}
            src={image.url}
            className={index === current ? "active" : ""}
            alt={index === current ? `${shopName} 작업 예시 ${index + 1}` : ""}
            aria-hidden={index === current ? undefined : true}
            loading={index === 0 ? undefined : "lazy"}
          />
        ))}
        <span>{current + 1} / {images.length}</span>
        {images.length > 1 && !reducedMotion && (
          <button
            type="button"
            className="gallery-play"
            onClick={() => setWantsPlay((playing) => !playing)}
            aria-label={wantsPlay ? "자동 넘김 멈추기" : "자동 넘김 시작하기"}
          >
            {wantsPlay ? "❚❚" : "▶"}
          </button>
        )}
      </div>
      {images.length > 1 && <div className="service-thumbnails">{images.map((image, index) => (
        <button
          type="button"
          className={current === index ? "active" : ""}
          onClick={() => setSelected(index)}
          key={image.id}
          aria-label={`작업 이미지 ${index + 1}`}
          aria-pressed={current === index}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt=""/>
        </button>
      ))}</div>}
    </div>
  );
}
