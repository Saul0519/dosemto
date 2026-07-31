export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SupportedImageMime = (typeof IMAGE_MIME_TYPES)[number];

const EXTENSIONS: Record<SupportedImageMime, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
};

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  return null;
}

export function extensionForMime(mime: SupportedImageMime) {
  return mime === "image/jpeg" ? "jpg" : EXTENSIONS[mime][0];
}

function filenameExtension(filename: string) {
  const match = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export async function validateImageFile(
  file: File,
  options: { maxBytes: number; requiredMime?: SupportedImageMime },
) {
  if (file.size <= 0 || file.size > options.maxBytes) {
    throw new Error(`이미지 한 장은 최대 ${Math.floor(options.maxBytes / 1024 / 1024)}MB까지 올릴 수 있습니다.`);
  }

  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const detectedMime = detectImageMime(header);
  if (!detectedMime) {
    throw new Error("파일의 실제 형식을 확인할 수 없습니다. PNG, JPG, WEBP, GIF만 사용할 수 있습니다.");
  }
  if (options.requiredMime && detectedMime !== options.requiredMime) {
    throw new Error(`변환 도안은 실제 ${extensionForMime(options.requiredMime).toUpperCase()} 파일이어야 합니다.`);
  }

  const extension = filenameExtension(file.name);
  if (!EXTENSIONS[detectedMime].includes(extension)) {
    throw new Error(`파일 확장자와 실제 이미지 형식이 일치하지 않습니다: ${file.name.slice(0, 100)}`);
  }

  return {
    mime: detectedMime,
    extension: extensionForMime(detectedMime),
  };
}

