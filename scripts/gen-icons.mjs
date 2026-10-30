// Generates the toolbar/store icons (no dependencies): a blue folder-tab with a white "T",
// anti-aliased by 4x4 supersampling, RGBA PNG. Run: node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// Shapes in unit coordinates (0..1): [x0, y0, x1, y1, radius].
const inRoundRect = (x, y, [x0, y0, x1, y1, r]) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const BODY = [0.06, 0.16, 0.94, 0.92, 0.14];
const TAB = [0.06, 0.06, 0.5, 0.3, 0.09];
const BAR = [0.27, 0.38, 0.73, 0.5, 0.05];
const STEM = [0.44, 0.38, 0.56, 0.8, 0.05];
const BLUE = [0x2f, 0x6f, 0xde];
const WHITE = [0xff, 0xff, 0xff];

/** Colour + coverage of one sample point. */
const sample = (x, y) => {
  if (inRoundRect(x, y, BAR) || inRoundRect(x, y, STEM)) return WHITE;
  if (inRoundRect(x, y, BODY) || inRoundRect(x, y, TAB)) return BLUE;
  return null;
};

const png = (size) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const SS = 4;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = [0];
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      // Colour averaged over covered samples (straight alpha), alpha = coverage.
      row.push(a ? Math.round(r / a) : 0, a ? Math.round(g / a) : 0, a ? Math.round(b / a) : 0);
      row.push(Math.round((a / (SS * SS)) * 255));
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

mkdirSync("public/icon", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icon/${size}.png`, png(size));
}
