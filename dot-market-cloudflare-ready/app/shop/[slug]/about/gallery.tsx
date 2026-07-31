"use client";

import { useState } from "react";

type ShopImage = { id: string; filename: string; url: string };

export default function AboutGallery({ images, shopName }: { images: ShopImage[]; shopName: string }) {
  const [selected, setSelected] = useState(0);
  if (images.length === 0) {
    return <div className="service-gallery-empty"><div/><b>작업 이미지 준비 중</b><span>샵 관리자가 완성작과 작업 예시를 등록할 예정입니다.</span></div>;
  }
  const current = images[Math.min(selected, images.length - 1)];
  return (
    <div className="service-gallery">
      <div className="service-main-image">
        {/* Shop artwork is stored in the site's object storage. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url} alt={`${shopName} 작업 예시 ${selected + 1}`}/>
        <span>{selected + 1} / {images.length}</span>
      </div>
      {images.length > 1 && <div className="service-thumbnails">{images.map((image, index) => (
        <button type="button" className={selected === index ? "active" : ""} onClick={() => setSelected(index)} key={image.id} aria-label={`작업 이미지 ${index + 1} 보기`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt=""/>
        </button>
      ))}</div>}
    </div>
  );
}
