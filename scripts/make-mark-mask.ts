/**
 * Turns a flat, single-colour logo PNG on a white background into a transparent
 * alpha mask, so it can be tinted with `currentColor` like every other mark.
 *
 *     tsx scripts/make-mark-mask.ts <in.png> <out.png>
 *
 * ## Why this exists
 *
 * Wan is the one model in the catalogue with no vector logo published anywhere —
 * not in @lobehub/icons, not in svgl, not in its own GitHub repo, and not on
 * wan.video, which serves a PNG wordmark from a CDN. What we have is a 400×400
 * RGB PNG of the mark on solid white.
 *
 * Dropped in as-is that is a white tile on a near-black canvas. Tinting it is
 * impossible through an `<img>`, which ignores page CSS. So the pixels become an
 * alpha channel instead: the shape is opaque, the white ground is transparent,
 * and the element that carries it paints `currentColor` through the mask. The
 * result sits in the row at the same weight as the seventeen vector marks.
 *
 * ## How the alpha is derived
 *
 * `255 - min(r,g,b)`, normalised so the most saturated pixel reaches full
 * opacity. Two reasons for min-of-channels rather than luminance: it is
 * hue-independent, so this works for any brand colour without a per-logo
 * constant, and it keeps the antialiased edge pixels as partial alpha instead of
 * hardening them into a staircase.
 *
 * Only handles 8-bit non-interlaced colour types 2 and 6, which is what an
 * exported logo is. It exits rather than guessing on anything else.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: tsx scripts/make-mark-mask.ts <in.png> <out.png>");
  process.exit(1);
}

const png = readFileSync(inPath);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
const bitDepth = png[24];
const colorType = png[25];
const interlace = png[28];

if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
  console.error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  process.exit(1);
}
const channels = colorType === 2 ? 3 : 4;

/** Walk the chunk list and concatenate every IDAT — large PNGs split them. */
function idat(buf) {
  const parts = [];
  let at = 8;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") parts.push(buf.subarray(at + 8, at + 8 + len));
    if (type === "IEND") break;
    at += len + 12;
  }
  return Buffer.concat(parts);
}

const raw = inflateSync(idat(png));
const stride = width * channels;
const pixels = Buffer.alloc(height * stride);

/* Undo the per-scanline filters. Each row is prefixed with a filter byte and is
   defined relative to the row above and the pixel to the left, so this has to
   run in order and cannot be parallelised. */
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  const row = pixels.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

  for (let i = 0; i < stride; i++) {
    const a = i >= channels ? row[i - channels] : 0;
    const b = prev[i];
    const c = i >= channels ? prev[i - channels] : 0;
    let value = src[i];
    if (filter === 1) value += a;
    else if (filter === 2) value += b;
    else if (filter === 3) value += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    row[i] = value & 0xff;
  }
}

/* Pass one finds the most saturated pixel so the shape reaches full opacity
   rather than whatever its brand colour happens to measure. */
let darkest = 255;
for (let i = 0; i < width * height; i++) {
  const p = i * channels;
  darkest = Math.min(darkest, pixels[p], pixels[p + 1], pixels[p + 2]);
}
const range = 255 - darkest || 1;

const out = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) {
  out[y * (width * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < width; x++) {
    const p = (y * width + x) * channels;
    const min = Math.min(pixels[p], pixels[p + 1], pixels[p + 2]);
    const alpha = Math.max(0, Math.min(255, Math.round(((255 - min) / range) * 255)));
    const q = y * (width * 4 + 1) + 1 + x * 4;
    // White RGB throughout: only the alpha channel carries the shape, because
    // `mask-image` reads alpha and the colour comes from the element.
    out[q] = 255;
    out[q + 1] = 255;
    out[q + 2] = 255;
    out[q + 3] = alpha;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let table;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6; // RGBA
writeFileSync(
  outPath,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(out, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);

console.log(`${inPath} → ${outPath}  (${width}×${height}, darkest channel ${darkest})`);
