// Regenerates app/dose-palette.ts from public/Dose.gpl.
// Run after the painter's palette changes:  node scripts/build-palette.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "public/Dose.gpl";
const TARGET = "app/dose-palette.ts";

const toHex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const luminance = (hex) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Greys return -1 so they sort ahead of the chromatic families.
const hue = (hex) => {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return -1;
  const raw =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
};

const swatches = readFileSync(SOURCE, "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/))
  .filter(Boolean)
  .map((match) => toHex([Number(match[1]), Number(match[2]), Number(match[3])]));

// The file stores one base colour per four consecutive shades.
const families = [];
for (let i = 0; i < swatches.length; i += 4) families.push(swatches.slice(i, i + 4));

families.sort((a, b) => {
  const [hueA, hueB] = [hue(a[0]), hue(b[0])];
  if (hueA < 0 && hueB < 0) return luminance(a[0]) - luminance(b[0]);
  if (hueA < 0) return -1;
  if (hueB < 0) return 1;
  return hueA - hueB;
});

// The source file pads unused slots by repeating one colour. Those rows carry no
// information on a swatch wall, so the display list keeps one of each distinct ramp.
const seenRamp = new Set();
const displayFamilies = families.filter((family) => {
  const key = family.join();
  if (seenRamp.has(key)) return false;
  seenRamp.add(key);
  return new Set(family).size > 1;
});

writeFileSync(
  TARGET,
  [
    "// Generated from public/Dose.gpl — the palette the converter snaps every pixel to.",
    "// 55 base colours x 4 shades. Do not hand-edit; run scripts/build-palette.mjs.",
    "",
    `export const DOSE_FAMILIES: readonly (readonly string[])[] = ${JSON.stringify(families)} as const;`,
    "",
    "// Deduplicated ramps, hue-ordered — what the swatch wall on the site renders.",
    `export const DOSE_DISPLAY_FAMILIES: readonly (readonly string[])[] = ${JSON.stringify(displayFamilies)} as const;`,
    "",
    "export const DOSE_COLOURS: readonly string[] = DOSE_FAMILIES.flat();",
    "",
    "// How many genuinely distinct colours a converted tile can use.",
    `export const DOSE_COLOUR_COUNT = ${new Set(families.flat()).size};`,
    "",
  ].join("\n"),
);

console.log(
  `${families.length} families (${displayFamilies.length} shown), ` +
    `${families.flat().length} swatches, ${new Set(families.flat()).size} unique -> ${TARGET}`,
);
