// Generates the PWA icons (PNG) with no dependencies: a tiny rasteriser + zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Shapes in unit coordinates (maskable-safe: art within the central 70%).
const BG = [20, 23, 31, 255], SKY = [47, 111, 208, 255], YEL = [255, 210, 58, 255], RED = [210, 58, 42, 255], DARK = [40, 40, 46, 255], GLASS = [150, 200, 235, 255];
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function art(x, y) {
  if (inRect(x, y, 0.2, 0.3, 0.8, 0.33)) return YEL; // rotor blade
  if (inRect(x, y, 0.485, 0.33, 0.515, 0.42)) return DARK; // mast
  if (inEllipse(x, y, 0.42, 0.53, 0.06, 0.07) && x < 0.42) return GLASS;
  if (inEllipse(x, y, 0.47, 0.53, 0.13, 0.11)) return RED; // cabin
  if (inRect(x, y, 0.55, 0.5, 0.78, 0.53)) return RED; // boom
  if (inRect(x, y, 0.75, 0.43, 0.79, 0.53)) return YEL; // fin
  if (inRect(x, y, 0.33, 0.68, 0.62, 0.7)) return DARK; // skid
  if (inRect(x, y, 0.4, 0.62, 0.42, 0.68) || inRect(x, y, 0.53, 0.62, 0.55, 0.68)) return DARK;
  return null;
}
const make = (size, maskable) =>
  png(size, (x, y) => {
    const a = art(x, y);
    if (a) return a;
    const inCircle = (x - 0.5) ** 2 + (y - 0.5) ** 2 < 0.36 ** 2;
    if (inCircle) return y > 0.58 ? [95, 154, 60, 255] : SKY;
    if (maskable) return BG;
    // Rounded square for the regular icon.
    const r = 0.18, dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    return dx * dx + dy * dy <= r * r ? BG : [0, 0, 0, 0];
  });

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', make(192, false));
writeFileSync('public/icons/icon-512.png', make(512, false));
writeFileSync('public/icons/maskable-512.png', make(512, true));
console.log('icons written');
