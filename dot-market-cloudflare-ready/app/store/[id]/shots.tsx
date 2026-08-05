"use client";

import { useState } from "react";
import type { StoreImage } from "../../../db/store";

/** Big picture with thumbnails under it. Nothing moves on its own here. */
export default function Shots({ images, name }: { images: StoreImage[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const current = Math.min(selected, images.length - 1);

  return (
    <div className="store-shots">
      <div className="store-shot-main">
        <img src={`/api/store-images/${images[current].id}`} alt={`${name} 사진 ${current + 1}`}/>
      </div>
      {images.length > 1 && (
        <div className="store-shot-strip">
          {images.map((image, index) => (
            <button
              type="button"
              key={image.id}
              className={index === current ? "on" : ""}
              onClick={() => setSelected(index)}
              aria-label={`${index + 1}번째 사진 보기`}
              aria-pressed={index === current}
            >
              <img src={`/api/store-images/${image.id}`} alt="" loading="lazy"/>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
