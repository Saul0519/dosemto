/**
 * Writing a real .xlsx, without a library.
 *
 * A spreadsheet file is a zip of XML. Written by hand here because every
 * package that does it is far larger than the part we need, and this runs on a
 * worker where every kilobyte is start-up time paid on somebody's first click.
 *
 * CSV was the other option. It loses the difference between a number and text
 * that looks like one — an order number of 0012 arrives as 12, and a Korean
 * column header arrives as mojibake unless the reader guesses the encoding
 * right. A spreadsheet says what it means.
 *
 * Entries are stored uncompressed. Deflate would need either a table-driven
 * implementation here or a streaming round trip, and a ledger is tens of
 * kilobytes: not worth either.
 */

export type Column = {
  header: string;
  /** Characters wide, roughly. */
  width?: number;
};

/** A cell is text, a number, or empty. */
export type Cell = string | number | null;

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    // Control characters are not allowed in XML at all, and a stray one makes
    // the whole file unopenable rather than showing one odd cell.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** A, B, … Z, AA, AB … */
function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * Three cell looks: plain, bold for the header row, and thousands-separated for
 * money. numFmtId 3 is the built-in `#,##0`, so no format needs defining.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function workbook(sheetName: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function sheet(columns: Column[], rows: Cell[][]) {
  const cols = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 14}" customWidth="1"/>`)
    .join("");

  const cell = (value: Cell, column: number, row: number, style: number) => {
    const reference = `${columnName(column)}${row}`;
    if (value === null || value === "") return "";
    if (typeof value === "number" && Number.isFinite(value)) {
      return `<c r="${reference}" s="${style === 1 ? 1 : 2}"><v>${value}</v></c>`;
    }
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
  };

  const head = `<row r="1">${columns.map((c, i) => cell(c.header, i, 1, 1)).join("")}</row>`;
  const body = rows
    .map((values, index) =>
      `<row r="${index + 2}">${values.map((v, i) => cell(v, i, index + 2, 0)).join("")}</row>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${cols}</cols>
<sheetData>${head}${body}</sheetData>
</worksheet>`;
}

type Entry = { name: string; body: Uint8Array; crc: number; offset: number };

function zip(files: { name: string; text: string }[]) {
  const parts: Uint8Array[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array) => { parts.push(bytes); offset += bytes.length; };

  const header = (size: number) => {
    const view = new DataView(new ArrayBuffer(size));
    return { view, bytes: new Uint8Array(view.buffer) };
  };

  for (const file of files) {
    const body = encoder.encode(file.text);
    const name = encoder.encode(file.name);
    const crc = crc32(body);

    // Local file header: stored, no compression, fixed 1980-01-01 timestamp so
    // the same ledger always produces byte-identical output.
    const { view, bytes } = header(30);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // names are UTF-8
    view.setUint16(8, 0, true);      // stored
    view.setUint16(10, 0, true);
    view.setUint16(12, 33, true);    // 1980-01-01
    view.setUint32(14, crc, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, body.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);

    entries.push({ name: file.name, body, crc, offset });
    push(bytes);
    push(name);
    push(body);
  }

  const directoryStart = offset;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const { view, bytes } = header(46);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 33, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.body.length, true);
    view.setUint32(24, entry.body.length, true);
    view.setUint16(28, name.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    push(bytes);
    push(name);
  }

  const { view, bytes } = header(22);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, offset - directoryStart, true);
  view.setUint32(16, directoryStart, true);
  view.setUint16(20, 0, true);
  push(bytes);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** One sheet, a header row, and the rows under it. */
export function buildXlsx(input: { sheetName: string; columns: Column[]; rows: Cell[][] }) {
  return zip([
    { name: "[Content_Types].xml", text: CONTENT_TYPES },
    { name: "_rels/.rels", text: ROOT_RELS },
    { name: "xl/workbook.xml", text: workbook(input.sheetName) },
    { name: "xl/_rels/workbook.xml.rels", text: WORKBOOK_RELS },
    { name: "xl/styles.xml", text: STYLES },
    { name: "xl/worksheets/sheet1.xml", text: sheet(input.columns, input.rows) },
  ]);
}
