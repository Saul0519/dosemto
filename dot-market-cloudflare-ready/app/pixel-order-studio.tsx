"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import TurnstileCaptcha from "./turnstile-captcha";
import { BASE_DEADLINE, DEADLINE_CHOICES, deadlineLabel } from "../db/deadlines";
import AccountChip from "./account-chip";

type RGB = [number, number, number];

type Pricing = {
  tilePrice: number;
  deadlineMultipliers: Record<string, number>;
};

type Shop = {
  slug: string;
  name: string;
  description: string;
  pricing: Pricing;
};

const FALLBACK_PRICING: Pricing = {
  tilePrice: 2000,
  deadlineMultipliers: {
    "1": 1.55,
    "2": 1.4,
    "3": 1.3,
    "4": 1.2,
    "5": 1.12,
    "6": 1.06,
    "7": 1,
  },
};

const SAMPLE_SWATCHES = [
  "#191919",
  "#007b00",
  "#7dca19",
  "#e2e232",
  "#d57d32",
  "#fc0000",
  "#b04bd5",
  "#323ffc",
  "#497efc",
  "#5bd8d2",
  "#7db037",
  "#f7eb4c",
  "#956c4c",
  "#cfaf9f",
  "#d9d6d0",
];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 15v4h14v-4"/></>,
    grid: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></>,
    discord: <><path d="M8 8.7a10 10 0 0 1 8 0M7.3 17.5c3.1 1.5 6.3 1.5 9.4 0"/><path d="M9.4 14.2h.01M14.6 14.2h.01"/><path d="M6.2 6.5C3.8 10 3.1 13.4 3.5 17c2.1 1.6 4 2.4 5.9 2.8l1.1-1.6M17.8 6.5c2.4 3.5 3.1 6.9 2.7 10.5-2.1 1.6-4 2.4-5.9 2.8l-1.1-1.6"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/><path d="m3 8 5-5M16 3l5 5M21 16l-5 5M8 21l-5-5"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function parseGpl(text: string): RGB[] {
  const colors = text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as RGB);
  const seen = new Set<string>();
  return colors.filter((color) => {
    const key = color.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nearestPaletteColor(r: number, g: number, b: number, palette: RGB[]) {
  let best = palette[0] ?? ([r, g, b] as RGB);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const red = r - color[0];
    const green = g - color[1];
    const blue = b - color[2];
    const distance = red * red * 0.3 + green * green * 0.59 + blue * blue * 0.11;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best;
}

function formatWon(value: number) {
  return `${Math.round(value / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function PixelOrderStudio({ shop, captchaSiteKey, userName, loginConfigured, slots, openOrderId }: {
  shop: Shop;
  captchaSiteKey: string;
  /** Signed-in Discord display name, or null when signed out. */
  userName: string | null;
  loginConfigured: boolean;
  /** How full the shop's queue was when the page was rendered. */
  slots: { enabled: boolean; used: number; max: number; full: boolean };
  /** Set when this visitor already has an unfinished order at this shop. */
  openOrderId: string | null;
}) {
  const [palette, setPalette] = useState<RGB[]>([]);
  const pricing = shop.pricing ?? FALLBACK_PRICING;
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [gridX, setGridX] = useState(5);
  const [cropFrom, setCropFrom] = useState<"top" | "center" | "bottom">("bottom");
  const [deadline, setDeadline] = useState<number>(BASE_DEADLINE);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [note, setNote] = useState("");
  const [orderState, setOrderState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [orderMessage, setOrderMessage] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [largePreview, setLargePreview] = useState("");
  const [previewMode, setPreviewMode] = useState<"fit" | "actual">("fit");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputWidth = gridX * 32;
  const imageRatio = sourceImage
    ? sourceImage.naturalHeight / sourceImage.naturalWidth
    : 7 / 5;
  const rawOutputHeight = Math.max(32, Math.round(outputWidth * imageRatio));
  const gridY = Math.max(1, Math.floor(rawOutputHeight / 32));
  const outputHeight = gridY * 32;
  const trimPixels = rawOutputHeight - outputHeight;
  const minimumGridX = sourceImage
    ? Math.max(1, Math.ceil(sourceImage.naturalWidth / sourceImage.naturalHeight))
    : 1;

  useEffect(() => {
    fetch("/Dose.gpl")
      .then((response) => response.text())
      .then((text) => setPalette(parseGpl(text)))
      .catch(() => setPalette(SAMPLE_SWATCHES.map((hex) => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ])));
  }, []);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => {
    if (!largePreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLargePreview("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [largePreview]);

  const setUploadedFile = useCallback((nextFile: File | undefined) => {
    const extension = nextFile?.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (!nextFile || !["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) {
      setOrderMessage("PNG, JPG, JPEG, WEBP, GIF 파일만 선택할 수 있습니다.");
      return;
    }
    const url = URL.createObjectURL(nextFile);
    const image = new Image();
    image.onload = () => {
      setFile(nextFile);
      setSourceUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
      setSourceImage(image);
      setGridX((current) => Math.max(
        current,
        Math.ceil(image.naturalWidth / image.naturalHeight),
      ));
      setOrderMessage("");
      setOrderState("idle");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setOrderMessage("이미지를 읽지 못했습니다. 다른 파일로 시도해 주세요.");
    };
    image.src = url;
  }, []);

  const renderConverted = useCallback(() => {
    const preview = previewCanvasRef.current;
    const exported = exportCanvasRef.current;
    if (!sourceImage || !preview || !exported || palette.length === 0) return;
    setIsRendering(true);
    const width = outputWidth;
    const height = outputHeight;
    exported.width = width;
    exported.height = height;
    const exportContext = exported.getContext("2d", { willReadFrequently: true });
    if (!exportContext) return;
    exportContext.imageSmoothingEnabled = true;
    exportContext.imageSmoothingQuality = "high";
    exportContext.clearRect(0, 0, width, height);
    const cropOffset = cropFrom === "top"
      ? -trimPixels
      : cropFrom === "center"
        ? -Math.floor(trimPixels / 2)
        : 0;
    exportContext.drawImage(sourceImage, 0, cropOffset, width, rawOutputHeight);
    const imageData = exportContext.getImageData(0, 0, width, height);
    const data = imageData.data;
    const colorCache = new Map<number, RGB>();
    for (let index = 0; index < data.length; index += 4) {
      const key = (data[index] >> 3) << 10 | (data[index + 1] >> 3) << 5 | (data[index + 2] >> 3);
      let color = colorCache.get(key);
      if (!color) {
        color = nearestPaletteColor(data[index], data[index + 1], data[index + 2], palette);
        colorCache.set(key, color);
      }
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
    }
    exportContext.putImageData(imageData, 0, 0);

    preview.width = width;
    preview.height = height;
    const previewContext = preview.getContext("2d");
    if (!previewContext) return;
    previewContext.imageSmoothingEnabled = false;
    previewContext.drawImage(exported, 0, 0);
    previewContext.strokeStyle = "rgba(255,255,255,.82)";
    previewContext.lineWidth = Math.max(1, width / 420);
    for (let x = 32; x < width; x += 32) {
      previewContext.beginPath();
      previewContext.moveTo(x, 0);
      previewContext.lineTo(x, height);
      previewContext.stroke();
    }
    for (let y = 32; y < height; y += 32) {
      previewContext.beginPath();
      previewContext.moveTo(0, y);
      previewContext.lineTo(width, y);
      previewContext.stroke();
    }
    setIsRendering(false);
  }, [sourceImage, palette, outputWidth, outputHeight, rawOutputHeight, trimPixels, cropFrom]);

  useEffect(() => {
    const frame = requestAnimationFrame(renderConverted);
    return () => cancelAnimationFrame(frame);
  }, [renderConverted]);

  const tileCount = gridX * gridY;
  const basePrice = tileCount * pricing.tilePrice;
  const multiplier = pricing.deadlineMultipliers[String(deadline)] ?? 1;
  const totalPrice = Math.round((basePrice * multiplier) / 100) * 100;
  const rushPrice = totalPrice - basePrice;

  const changePictureWidth = (delta: number) => {
    setGridX((value) => clamp(value + delta, minimumGridX, 30));
  };

  const cropLabel = trimPixels === 0
    ? "자르기 없음 (32px 단위로 정확히 맞음)"
    : cropFrom === "top"
      ? `위쪽 ${trimPixels}px 자름`
      : cropFrom === "bottom"
        ? `아래쪽 ${trimPixels}px 자름`
        : `위·아래 합계 ${trimPixels}px 나눠 자름`;

  const downloadPreview = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !file) return;
    const link = document.createElement("a");
    link.download = `dot-order_${gridX}x${gridY}_${file.name.replace(/\.[^.]+$/, "")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const openLargePreview = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !sourceImage) return;
    setPreviewMode("fit");
    setLargePreview(canvas.toDataURL("image/png"));
  };

  const submitOrder = async () => {
    if (!file || !previewCanvasRef.current) {
      setOrderMessage("먼저 주문할 이미지를 올려 주세요.");
      return;
    }
    setOrderState("sending");
    setOrderMessage("");
    const previewBlob = await new Promise<Blob | null>((resolve) => previewCanvasRef.current?.toBlob(resolve, "image/png"));
    if (!previewBlob) {
      setOrderState("error");
      setOrderMessage("주문 이미지를 만드는 중 문제가 생겼습니다.");
      return;
    }
    const form = new FormData();
    form.append("preview", previewBlob, `converted_${gridX}x${gridY}.png`);
    if (file.size <= 8 * 1024 * 1024) form.append("original", file, file.name);
    form.append("note", note.trim());
    form.append("gridX", String(gridX));
    form.append("gridY", String(gridY));
    form.append("deadline", String(deadline));
    form.append("shopSlug", shop.slug);
    form.append("cropLabel", cropLabel);
    form.append("tileCount", String(tileCount));
    form.append("totalPrice", String(totalPrice));
    form.append("originalFilename", file.name);
    form.append("captchaToken", captchaToken);
    try {
      const response = await fetch("/api/orders", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "주문 전송에 실패했습니다.");
      setOrderState("sent");
      setOrderMessage(`주문이 전송되었습니다. 주문번호 ${result.orderId}`);
    } catch (error) {
      setOrderState("error");
      setOrderMessage(error instanceof Error ? error.message : "주문 전송에 실패했습니다.");
    } finally {
      setCaptchaToken("");
      setCaptchaResetKey((value) => value + 1);
    }
  };

  return (
    <main className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="샵 목록으로 이동">
          <span className="brand-mark"><i/><i/><i/><i/></span>
          <span>DOT MARKET</span>
        </Link>
        <nav className="market-nav" aria-label="주요 메뉴">
          <Link className="active" href={`/shop/${shop.slug}`}>주문 제작</Link>
          <Link href={`/shop/${shop.slug}/about`}>샵 소개</Link>
        </nav>
        <AccountChip userName={userName} next={`/shop/${shop.slug}`}/>
        <Link className="admin-link" href="/admin"><Icon name="lock" size={15}/> 샵 관리자</Link>
      </header>

      <section className="hero" id="studio">
        <p className="eyebrow">{shop.name.toUpperCase()} · PAINTER&apos;S EASEL</p>
        <h1>이미지를 올리고 가로 칸 수만 정하세요.</h1>
        <p>세로 칸 수와 총 장수는 원본 비율대로 붙습니다. 도안 PNG는 주문하지 않아도 받아 갈 수 있습니다.</p>
      </section>

      <div className="workspace">
        <section className="studio-card" aria-label="이미지 변환 작업실">
          <div className="work-panels">
            <div
              className={`upload-zone ${isDraggingOver ? "is-dragging" : ""}`}
              onDragOver={(event: DragEvent) => { event.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                setIsDraggingOver(false);
                setUploadedFile(event.dataTransfer.files[0]);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                onChange={(event: ChangeEvent<HTMLInputElement>) => setUploadedFile(event.target.files?.[0])}
              />
              <span className="upload-icon"><Icon name="upload" size={30}/></span>
              <strong>{file ? "다른 이미지로 바꾸기" : "그릴 이미지를 올려주세요"}</strong>
              <small>PNG · JPG · WEBP · GIF. 끌어다 놓아도 됩니다.</small>
              <button type="button" onClick={() => fileInputRef.current?.click()}>파일 선택</button>
              {file && <span className="file-pill">{file.name}</span>}
            </div>

            <figure className="original-panel">
              <figcaption>원본</figcaption>
              <div className="image-frame original-frame">
                {/* Object URLs from user-selected local files are intentionally rendered without optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {sourceUrl ? <img src={sourceUrl} alt="업로드한 원본"/> : <div className="empty-preview"><Icon name="image" size={34}/><span>원본 미리보기</span></div>}
              </div>
            </figure>

            <figure className="converted-panel">
              <figcaption>변환·분할 결과 <span className="complete-badge"><Icon name="check" size={13}/> 자동 변환</span></figcaption>
              <div className="image-frame converted-frame">
                {sourceImage ? (
                  <canvas
                    ref={previewCanvasRef}
                    aria-label={`${gridX} 곱하기 ${gridY} 격자로 분할한 변환 이미지`}
                  />
                ) : <div className="empty-preview mosaic"><Icon name="grid" size={34}/><span>변환 결과</span></div>}
                {isRendering && <span className="rendering-chip">변환 중</span>}
                {sourceImage && <span className="tile-chip">한 칸 32 × 32</span>}
                {sourceImage && <button className="expand-preview-button" type="button" onClick={openLargePreview}><Icon name="expand" size={15}/> 전체화면</button>}
              </div>
            </figure>
          </div>

          <canvas ref={exportCanvasRef} className="hidden-canvas" aria-hidden="true"/>

          <div className="controls" id="how">
            <div className="control-block grid-control">
              <label><Icon name="grid" size={17}/> 가로 칸 수</label>
              <div className="dimension-row">
                <button type="button" onClick={() => changePictureWidth(-1)} aria-label="그림 가로 크기 한 칸 줄이기">−</button>
                <input className="picture-size-input" aria-label="그림 가로 격자 수" type="number" min={minimumGridX} max="30" value={gridX} onChange={(event) => setGridX(clamp(Number(event.target.value) || minimumGridX, minimumGridX, 30))}/>
                <button type="button" onClick={() => changePictureWidth(1)} aria-label="그림 가로 크기 한 칸 늘리기">＋</button>
              </div>
              <small>한 칸이 캔버스 한 장, 32px입니다. {gridX}칸이면 폭 {outputWidth}px. 세로는 사진 비율대로 붙고, 30칸까지 올릴 수 있습니다.</small>
            </div>

            <div className="control-block auto-result-block">
              <label><Icon name="image" size={18}/> 자동 계산 결과</label>
              <div className="auto-size-result">
                <span>비율 유지 <b>{outputWidth} × {rawOutputHeight}px</b></span>
                <span>32×32 박스 <b>{gridX} × {gridY} = {tileCount}장</b></span>
              </div>
              <small>{trimPixels === 0 ? `최종 ${outputWidth}×${outputHeight}px · 32px 단위로 정확히 맞습니다.` : `세로 ${rawOutputHeight}px에서 남는 ${trimPixels}px를 잘라 최종 ${outputWidth}×${outputHeight}px로 만듭니다.`}</small>
            </div>
          </div>

          {sourceImage && trimPixels > 0 && (
            <div className="crop-choice" aria-labelledby="crop-choice-title">
              <div><b id="crop-choice-title">어디를 자를까요?</b><small>선택한 부분이 잘려 나가며, 미리보기와 주문 파일에 똑같이 적용됩니다.</small></div>
              <div className="crop-buttons">
                <button type="button" className={cropFrom === "top" ? "active" : ""} onClick={() => setCropFrom("top")}>위쪽 {trimPixels}px 자르기</button>
                <button type="button" className={cropFrom === "center" ? "active" : ""} onClick={() => setCropFrom("center")}>위·아래 나눠 자르기</button>
                <button type="button" className={cropFrom === "bottom" ? "active" : ""} onClick={() => setCropFrom("bottom")}>아래쪽 {trimPixels}px 자르기</button>
              </div>
            </div>
          )}

          <button className="download-button" type="button" onClick={downloadPreview} disabled={!sourceImage}><Icon name="download" size={18}/> 변환 도안 PNG 다운로드</button>
        </section>

        <aside className="summary-card" id="price">
          <h2>주문 요약</h2>
          <div className="spec-list">
            <div><span><Icon name="grid"/> 규격</span><b>{gridX} × {gridY}</b></div>
            <div><span><Icon name="layers"/> 총</span><b>{tileCount}장</b></div>
            <div><span><Icon name="image"/> 한 장</span><b>32 × 32</b></div>
          </div>

          <div className="deadline-block">
            <h3>마감 <small style={{ color: "var(--ink-3)", fontWeight: 500 }}>기본이 기준 가격</small></h3>
            <div className="deadline-grid two">
              {DEADLINE_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={deadline === choice.value ? "active" : ""}
                  onClick={() => setDeadline(choice.value)}
                  aria-pressed={deadline === choice.value}
                >
                  <b>{choice.label}</b>
                  <span>{choice.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="price-breakdown">
            <h3>금액 내역</h3>
            <div><span>작품 제작 ({tileCount}장)</span><b>{formatWon(basePrice)}</b></div>
            <div><span>마감 조정 ({deadlineLabel(deadline)})</span><b className={rushPrice > 0 ? "rush" : ""}>{rushPrice > 0 ? `+${formatWon(rushPrice)}` : "추가 없음"}</b></div>
          </div>

          {slots.enabled && (
            <div className={`slot-line${slots.full ? " full" : ""}`}>
              <b>접수 슬롯</b>
              <strong>{slots.used}<i>/{slots.max}</i></strong>
              <span>{slots.full
                ? "진행 중인 작업이 끝나면 다시 열립니다. 도안 변환과 다운로드는 그대로 쓰실 수 있습니다."
                : `${slots.max - slots.used}칸 남았습니다.`}</span>
            </div>
          )}

          <div className="total-price"><span>예상 금액</span><strong>{formatWon(totalPrice)}</strong></div>

          <div className="contact-fields">
            <label>요청사항 <span>선택</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="화가가 알아야 할 내용을 적어주세요." rows={2}/></label>
          </div>

          {userName ? <>
            <div className="order-player">
              <span>주문자</span>
              <b>{userName}</b>
              <small>이 디스코드 계정으로 접수되고, 진행 상황도 여기로 안내됩니다.</small>
            </div>

            {openOrderId && (
              <div className="open-order-note">
                <b>이미 이 샵에 진행 중인 주문이 있습니다</b>
                <code>{openOrderId}</code>
                <span>한 샵에 한 번에 한 건만 맡길 수 있습니다. 지금 주문이 마감되거나 취소되면 다시 주문할 수 있습니다.</span>
                <a href="/me">내 주문 보기 →</a>
              </div>
            )}

            {!slots.full && !openOrderId && <TurnstileCaptcha siteKey={captchaSiteKey} resetKey={captchaResetKey} onToken={setCaptchaToken}/>}

            <button className="order-button" type="button" onClick={submitOrder} disabled={Boolean(openOrderId) || slots.full || orderState === "sending" || !captchaToken}>
              {openOrderId ? "진행 중인 주문이 끝나야 합니다" : slots.full ? "지금은 접수 슬롯이 가득 찼습니다" : orderState === "sending" ? "보내는 중…" : !captchaSiteKey ? "봇 방지 설정이 필요합니다" : !captchaToken ? "봇 방지 확인을 먼저 해주세요" : orderState === "sent" ? "주문 전송 완료" : <><Icon name="discord" size={21}/> 주문 넣기 <span>→</span></>}
            </button>
            <p className={`order-status ${orderState}`}>{orderMessage || <><Icon name="lock" size={14}/> 변환 도안과 주문 내용이 샵 디스코드로 함께 전송됩니다.</>}</p>
          </> : <div className="order-login">
            <b>주문하려면 디스코드 로그인이 필요합니다</b>
            <span>연락처를 따로 적지 않아도 되고, 수락·거절·완성 알림이 디스코드로 갑니다. 도안 변환과 PNG 다운로드는 로그인 없이 그대로 쓰실 수 있습니다.</span>
            {loginConfigured
              ? <a className="order-button" href={`/login?next=${encodeURIComponent(`/shop/${shop.slug}`)}`}>디스코드로 로그인 <span>→</span></a>
              : <p className="order-status error">마인크래프트 로그인이 아직 설정되지 않았습니다. 샵 관리자에게 알려주세요.</p>}
          </div>}
        </aside>
      </div>

      {largePreview && (
        <div className="large-preview-modal" role="dialog" aria-modal="true" aria-label="변환 결과 전체화면" onMouseDown={(event) => { if (event.target === event.currentTarget) setLargePreview(""); }}>
          <header>
            <div><b>변환·분할 결과</b><span>{gridX} × {gridY}칸 · {outputWidth} × {outputHeight}px</span></div>
            <div className="preview-view-controls" role="group" aria-label="미리보기 배율">
              <button type="button" className={previewMode === "fit" ? "active" : ""} onClick={() => setPreviewMode("fit")}>화면에 크게 맞춤</button>
              <button type="button" className={previewMode === "actual" ? "active" : ""} onClick={() => setPreviewMode("actual")}>실제 크기 100%</button>
            </div>
            <button className="close-preview-button" type="button" onClick={() => setLargePreview("")} aria-label="전체화면 닫기"><Icon name="close" size={22}/></button>
          </header>
          <div className={`large-preview-stage ${previewMode}`}>
            {/* The data URL is created locally from the converted canvas. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={largePreview} alt={`${gridX} 곱하기 ${gridY} 격자의 변환 결과`} width={outputWidth} height={outputHeight}/>
          </div>
          <p>{previewMode === "fit" ? "화면을 최대한 채워 크게 표시한 모습입니다." : "이미지 1px을 화면 1px로 표시합니다. 화면보다 크면 스크롤해서 확인하세요."}</p>
        </div>
      )}

    </main>
  );
}
