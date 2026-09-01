/**
 * How big a file is, and how long it runs, read out of its own header.
 *
 * `assets.width`, `height` and `duration_ms` have been nullable columns nothing
 * ever wrote. `GeneratedOutputSchema` requires all three on every output and
 * `generationLibrary.describe` has been faithfully sending null for each, so
 * the gap is on this side rather than in the contract: no screen can use a
 * number nobody records. `JustifiedRows` lays a gallery out by aspect ratio and
 * currently takes it from the ratio the customer *asked* for, held in browser
 * storage, which is the requested shape rather than the delivered one.
 *
 * Measured rather than taken from the request: the customer asked for a size
 * and the provider mostly obliges, but "mostly" is not a number to put in a
 * column, and no provider we use reports the dimensions back. The bytes are the
 * only claim about a file the file itself makes — the same reasoning as
 * `sniffImageMimeType` next door, and the reason this dispatches on magic bytes
 * rather than on `mimeType`, which `describeOutput` guesses from a URL
 * extension.
 *
 * Headers only. Nothing here decodes a pixel or a sample, so it costs
 * microseconds on bytes the mirror already holds in memory.
 *
 * **Unknown is null, never a guess.** Absent is what these columns have always
 * been, so a format this cannot read leaves the row exactly as it is today.
 * Deliberately unread: WebM, OGG and WAV, none of which any provider we have
 * integrated returns — our fallbacks are `video/mp4` and `audio/mpeg`. Each is
 * a self-contained function's worth of work the day one does.
 */

export interface Measurements {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

const none = (): Measurements => ({ width: null, height: null, durationMs: null });

const starts = (bytes: Uint8Array, at: number, signature: number[]): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, index) => bytes[at + index] === byte);

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

/** What a file measures, or all-null when nothing here can read it. */
export function measure(bytes: Uint8Array): Measurements {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return png(view, bytes);
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return jpeg(view, bytes);
  if (starts(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return gif(view, bytes);
  if (starts(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return webp(view, bytes);
  // `ftyp` at byte 4 is ISO base media: mp4, and QuickTime, which is the same
  // container with a different brand.
  if (bytes.length > 12 && ascii(bytes, 4, 4) === "ftyp") return isoBaseMedia(view, bytes);
  if (starts(bytes, 0, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return mp3(view, bytes);

  return none();
}

/* -- images ------------------------------------------------------------- */

/** IHDR is mandated to be the first chunk, so both numbers sit at fixed offsets. */
function png(view: DataView, bytes: Uint8Array): Measurements {
  if (bytes.length < 24) return none();
  return { width: view.getUint32(16), height: view.getUint32(20), durationMs: null };
}

function gif(view: DataView, bytes: Uint8Array): Measurements {
  if (bytes.length < 10) return none();
  return { width: view.getUint16(6, true), height: view.getUint16(8, true), durationMs: null };
}

/**
 * The size lives in whichever start-of-frame marker the encoder used, and which
 * one that is depends on the encoding — baseline, progressive, arithmetic — so
 * the segment chain has to be walked rather than indexed into.
 */
function jpeg(view: DataView, bytes: Uint8Array): Measurements {
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // A run of 0xff is padding before the real marker byte.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers: no length field to skip by.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Entropy-coded data starts here and no frame header follows it.
    if (marker === 0xda || marker === 0xd9) break;

    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    // C0-CF are the frame headers, less DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5), durationMs: null };
    }
    offset += 2 + length;
  }
  return none();
}

/**
 * Three encodings under one RIFF wrapper, and the size is in a different place
 * in each: lossy (`VP8 `), lossless (`VP8L`), and the extended form (`VP8X`)
 * that carries a canvas size because it may hold animation or alpha.
 */
function webp(view: DataView, bytes: Uint8Array): Measurements {
  const at = 20; // RIFF(4) size(4) WEBP(4) chunk-tag(4) chunk-size(4)
  const chunk = bytes.length >= at ? ascii(bytes, 12, 4) : "";

  if (chunk === "VP8 " && bytes.length >= at + 10 && starts(bytes, at + 3, [0x9d, 0x01, 0x2a])) {
    // 14-bit width and height, each with two scaling bits above it.
    return { width: view.getUint16(at + 6, true) & 0x3fff, height: view.getUint16(at + 8, true) & 0x3fff, durationMs: null };
  }
  if (chunk === "VP8L" && bytes.length >= at + 5 && bytes[at] === 0x2f) {
    const packed = view.getUint32(at + 1, true);
    // Stored one less than the real size, 14 bits each.
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1, durationMs: null };
  }
  if (chunk === "VP8X" && bytes.length >= at + 10) {
    const dimension = (offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
    return { width: dimension(at + 4) + 1, height: dimension(at + 7) + 1, durationMs: null };
  }
  return none();
}

/* -- mp4 / mov ---------------------------------------------------------- */

interface Box {
  type: string;
  /** First byte of the payload, past the size and type fields. */
  body: number;
  /** One past the last byte of the whole box. */
  end: number;
}

/**
 * The boxes directly inside a range, without descending.
 *
 * Sizes are trusted only so far as they stay inside the parent — a truncated
 * download would otherwise walk off the end of the buffer, and this runs on
 * bytes a third party sent us.
 */
function children(view: DataView, bytes: Uint8Array, start: number, end: number): Box[] {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let body = offset + 8;
    if (size === 1) {
      // 64-bit size, which a long recording's `mdat` really does use.
      if (body + 8 > end) break;
      size = Number(view.getBigUint64(body));
      body += 8;
    } else if (size === 0) {
      size = end - offset; // Runs to the end of the parent.
    }
    if (size < body - offset || offset + size > end) break;
    found.push({ type: ascii(bytes, offset + 4, 4), body, end: offset + size });
    offset += size;
  }
  return found;
}

const child = (view: DataView, bytes: Uint8Array, box: Box, type: string): Box | undefined =>
  children(view, bytes, box.body, box.end).find((c) => c.type === type);

/**
 * Duration from the movie header, dimensions from the first track that has any.
 *
 * The track header's are the display dimensions — after the rotation matrix —
 * which is what a gallery wants: a portrait clip shot on a phone reports
 * portrait, rather than the landscape frame it is stored as. An audio track
 * carries zeroes, which is how the video track is picked out without reading
 * its codec.
 */
function isoBaseMedia(view: DataView, bytes: Uint8Array): Measurements {
  const moov = children(view, bytes, 0, bytes.length).find((box) => box.type === "moov");
  if (!moov) return none();

  const result = none();

  const mvhd = child(view, bytes, moov, "mvhd");
  if (mvhd && mvhd.body + 4 <= bytes.length) {
    const version = view.getUint8(mvhd.body);
    const at = mvhd.body + 4;
    if (version === 1 ? at + 28 <= mvhd.end : at + 16 <= mvhd.end) {
      const timescale = version === 1 ? view.getUint32(at + 16) : view.getUint32(at + 8);
      const duration = version === 1 ? Number(view.getBigUint64(at + 20)) : view.getUint32(at + 12);
      // All-ones is the container's way of saying it does not know.
      const unknown = version === 1 ? duration >= Number.MAX_SAFE_INTEGER : duration === 0xffffffff;
      if (timescale > 0 && !unknown) result.durationMs = Math.round((duration / timescale) * 1000);
    }
  }

  for (const trak of children(view, bytes, moov.body, moov.end).filter((box) => box.type === "trak")) {
    const tkhd = child(view, bytes, trak, "tkhd");
    if (!tkhd || tkhd.body + 4 > bytes.length) continue;
    const at = tkhd.body + (view.getUint8(tkhd.body) === 1 ? 88 : 76);
    if (at + 8 > tkhd.end) continue;
    // 16.16 fixed point.
    const width = Math.round(view.getUint32(at) / 65536);
    const height = Math.round(view.getUint32(at + 4) / 65536);
    if (width > 0 && height > 0) {
      result.width = width;
      result.height = height;
      break;
    }
  }

  return result;
}

/* -- mp3 ---------------------------------------------------------------- */

// Layer III only, which is what "mp3" means in practice. Index 0 is "free" and
// 15 is invalid; both are zero here and rejected as falsy.
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Duration only — an mp3 has no dimensions.
 *
 * Two answers, in order of honesty. A Xing or Info header states the frame
 * count outright, which is the only correct answer for a variable bit rate
 * file. Without one the file is assumed constant rate and the duration is
 * arithmetic on its length, which is exact for the constant-rate files our
 * audio provider actually returns and approximate for anything else.
 */
function mp3(view: DataView, bytes: Uint8Array): Measurements {
  let start = 0;
  if (starts(bytes, 0, [0x49, 0x44, 0x33]) && bytes.length > 10) {
    // ID3v2's length is synchsafe: seven bits per byte, so no byte can look
    // like a frame sync.
    start = 10 + (((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f));
  }

  // Bounded: past a sensible tag this is not an mp3, and scanning a whole file
  // for a byte pair would find one in almost anything.
  const limit = Math.min(bytes.length - 4, start + 65_536);
  let at = -1;
  for (let index = Math.max(0, start); index <= limit; index += 1) {
    if (bytes[index] === 0xff && (bytes[index + 1]! & 0xe0) === 0xe0) {
      at = index;
      break;
    }
  }
  if (at < 0) return none();

  const header = bytes[at + 1]!;
  const rates = bytes[at + 2]!;
  const mode = bytes[at + 3]!;
  const version = (header >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5, 1 = reserved
  const layer = (header >> 1) & 0x03; // 1 = Layer III
  if (version === 1 || layer !== 1) return none();

  const sampleRate = SAMPLE_RATES[version]?.[(rates >> 2) & 0x03];
  const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[(rates >> 4) & 0x0f];
  if (!sampleRate || !bitrate) return none();

  // The Xing header sits after the side information, whose size depends on both
  // the MPEG version and whether the file is mono.
  const mono = ((mode >> 6) & 0x03) === 3;
  const xing = at + 4 + (version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17);
  if (xing + 12 <= bytes.length) {
    const tag = ascii(bytes, xing, 4);
    const flags = view.getUint32(xing + 4);
    // Bit 0 of the flags says a frame count is present; without it the tag is
    // there for the seek table alone and tells us nothing about length.
    if ((tag === "Xing" || tag === "Info") && (flags & 1) !== 0) {
      const samplesPerFrame = version === 3 ? 1152 : 576;
      const samples = view.getUint32(xing + 8) * samplesPerFrame - encoderPadding(bytes, xing, flags);
      if (samples > 0) return { width: null, height: null, durationMs: Math.round((samples * 1000) / sampleRate) };
    }
  }

  // kbps is bits per millisecond, so this is bits over rate with no conversion.
  return { width: null, height: null, durationMs: Math.round(((bytes.length - at) * 8) / bitrate) };
}

/**
 * The silence the encoder added at each end, which is not part of the audio.
 *
 * An mp3 frame is a fixed number of samples, so the encoder pads the last one
 * out and prepends its own decoder delay. The frame count therefore always
 * overstates the recording — by about 40ms at 44.1kHz, which is nothing on a
 * three-minute track and 30% of a half-second voice preview. The LAME tag that
 * follows the Xing fields records both numbers precisely so a player can trim
 * them, and subtracting them here is what makes this agree with `ffprobe`
 * exactly rather than approximately.
 *
 * Zero when the tag is absent or truncated, which only costs us the trim.
 */
function encoderPadding(bytes: Uint8Array, xing: number, flags: number): number {
  // The optional Xing fields come first, each present only if its flag is set.
  const lame = xing + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
  // Nine bytes of encoder name, then version, lowpass, replay gain, flags and
  // bitrate — 21 in all — then twelve bits of delay and twelve of padding.
  const at = lame + 21;
  if (at + 3 > bytes.length) return 0;
  const delay = (bytes[at]! << 4) | (bytes[at + 1]! >> 4);
  const padding = ((bytes[at + 1]! & 0x0f) << 8) | bytes[at + 2]!;
  return delay + padding;
}
