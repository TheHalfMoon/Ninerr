// Pure-JavaScript zero-dependency PNG decoder, encoder, and pixel diff using node:zlib.
// Supports 8-bit RGB (colorType 2) and RGBA (colorType 6) non-interlaced PNG images
// produced by Chromium/Edge CDP Page.captureScreenshot.

import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_PNG_PIXELS = 25_000_000;

/** Decode an 8-bit RGB or RGBA non-interlaced PNG Buffer into { width, height, data: Uint8Array (RGBA) }. */
export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > MAX_PNG_BYTES || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG signature or oversized buffer");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];
  let totalIdatBytes = 0;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error("truncated PNG chunk");
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) throw new Error(`PNG CRC mismatch on chunk ${type}`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (length !== 13) throw new Error("invalid PNG IHDR length");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      if (width === 0 || height === 0 || width > 16_384 || height > 16_384 || width * height > MAX_PNG_PIXELS) {
        throw new Error("PNG dimensions out of bounds");
      }
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`unsupported PNG format (depth=${bitDepth}, colorType=${colorType}, interlace=${interlace})`);
      }
    } else if (type === "IDAT") {
      totalIdatBytes += length;
      if (totalIdatBytes > MAX_PNG_BYTES) throw new Error("PNG IDAT exceeds size limit");
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width === 0 || height === 0 || idatChunks.length === 0) throw new Error("incomplete PNG image");
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const expectedRawBytes = height * (stride + 1);
  const raw = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedRawBytes });
  if (raw.length < expectedRawBytes) throw new Error("PNG inflated data shorter than expected");

  const reconstructed = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const outStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + 1 + x];
      const a = x >= channels ? reconstructed[outStart + x - channels] : 0;
      const b = y > 0 ? reconstructed[prevStart + x] : 0;
      const c = y > 0 && x >= channels ? reconstructed[prevStart + x - channels] : 0;
      let recon = value;
      if (filter === 1) recon = (value + a) & 0xff;
      else if (filter === 2) recon = (value + b) & 0xff;
      else if (filter === 3) recon = (value + ((a + b) >>> 1)) & 0xff;
      else if (filter === 4) recon = (value + paethPredictor(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`unsupported PNG scanline filter ${filter}`);
      reconstructed[outStart + x] = recon;
    }
  }

  if (channels === 4) {
    return { width, height, data: reconstructed };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < reconstructed.length; i += 3, j += 4) {
    rgba[j] = reconstructed[i];
    rgba[j + 1] = reconstructed[i + 1];
    rgba[j + 2] = reconstructed[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode an RGBA Uint8Array (length = width * height * 4) into a valid PNG Buffer. */
export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("invalid PNG encode dimensions");
  }
  if (data.length !== width * height * 4) {
    throw new Error("RGBA pixel buffer length does not match width * height * 4");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const dest = y * (stride + 1);
    raw[dest] = 0; // None filter
    raw.set(data.subarray(y * stride, (y + 1) * stride), dest + 1);
  }
  const compressed = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Compare two PNG Buffers pixel-by-pixel and emit a visual diff PNG highlighting changed pixels.
 */
export function diffPngBuffers(beforeBuffer, afterBuffer, { threshold = 24, emitDiffImage = true } = {}) {
  const before = decodePng(beforeBuffer);
  const after = decodePng(afterBuffer);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const dimensionMismatch = before.width !== after.width || before.height !== after.height;
  const diffRgba = emitDiffImage ? new Uint8Array(width * height * 4) : null;

  let diffPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inBefore = x < before.width && y < before.height;
      const inAfter = x < after.width && y < after.height;
      const bi = (y * before.width + x) * 4;
      const ai = (y * after.width + x) * 4;
      const oi = (y * width + x) * 4;

      const br = inBefore ? before.data[bi] : 0;
      const bg = inBefore ? before.data[bi + 1] : 0;
      const bb = inBefore ? before.data[bi + 2] : 0;
      const ba = inBefore ? before.data[bi + 3] : 0;

      const ar = inAfter ? after.data[ai] : 0;
      const ag = inAfter ? after.data[ai + 1] : 0;
      const ab = inAfter ? after.data[ai + 2] : 0;
      const aa = inAfter ? after.data[ai + 3] : 0;

      const delta = !inBefore || !inAfter
        ? 255
        : Math.max(Math.abs(br - ar), Math.abs(bg - ag), Math.abs(bb - ab), Math.abs(ba - aa));

      if (delta > threshold) {
        diffPixels += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (diffRgba) {
          diffRgba[oi] = 225;
          diffRgba[oi + 1] = 29;
          diffRgba[oi + 2] = 72;
          diffRgba[oi + 3] = 255;
        }
      } else if (diffRgba) {
        const luma = Math.round(0.299 * ar + 0.587 * ag + 0.114 * ab);
        const muted = Math.round(255 - (255 - luma) * 0.28);
        diffRgba[oi] = muted;
        diffRgba[oi + 1] = muted;
        diffRgba[oi + 2] = muted;
        diffRgba[oi + 3] = 255;
      }
    }
  }

  const totalPixels = width * height;
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  return {
    width,
    height,
    beforeSize: { width: before.width, height: before.height },
    afterSize: { width: after.width, height: after.height },
    dimensionMismatch,
    diffPixels,
    totalPixels,
    diffRatio: Number(diffRatio.toFixed(6)),
    diffPercent: Number((diffRatio * 100).toFixed(3)),
    changedRegion: maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    diffPng: diffRgba ? encodePng({ width, height, data: diffRgba }) : null,
  };
}
