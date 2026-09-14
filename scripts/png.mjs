// Minimal PNG reader/writer (8-bit RGB/RGBA, non-interlaced) — enough for
// checking image sizes and dropping the alpha channel from store images.
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunks(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  const list = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    list.push({ type: buffer.toString('latin1', offset + 4, offset + 8), data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return list;
}

export function pngInfo(buffer) {
  const header = chunks(buffer).find((chunk) => chunk.type === 'IHDR').data;
  const colorType = header[9];
  return {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
    bitDepth: header[8],
    colorType,
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

export function decodePng(buffer) {
  const info = pngInfo(buffer);
  const channels = { 2: 3, 6: 4 }[info.colorType];
  if (info.bitDepth !== 8 || !channels) throw new Error(`unsupported PNG (depth ${info.bitDepth}, color type ${info.colorType})`);
  const raw = zlib.inflateSync(Buffer.concat(chunks(buffer).filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = info.width * channels;
  const pixels = Buffer.alloc(stride * info.height);
  for (let y = 0; y < info.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width: info.width, height: info.height, channels, pixels };
}

export function encodePng({ width, height, channels, pixels }) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Store screenshots and promo tiles must be 24-bit PNGs: flatten onto white.
export function withoutAlpha(buffer) {
  const image = decodePng(buffer);
  if (image.channels === 3) return buffer;
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let i = 0, j = 0; i < image.pixels.length; i += 4, j += 3) {
    const alpha = image.pixels[i + 3];
    for (let k = 0; k < 3; k++) rgb[j + k] = Math.round((image.pixels[i + k] * alpha + 255 * (255 - alpha)) / 255);
  }
  return encodePng({ width: image.width, height: image.height, channels: 3, pixels: rgb });
}
