/**
 * Gera o ícone do Drop Tracker (hexágono âmbar sobre fundo escuro) em
 * public/drop-tracker.ico (16, 24, 32, 48, 64, 128 e 256 px) e um preview
 * PNG 256x256 em public/drop-tracker.preview.png.
 *
 * Sem dependências: desenha com supersampling e monta o .ico na mão.
 *
 *   node tools/make-icon.mjs
 */

import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SUPERSAMPLE = 4;

const BG_TOP = [27, 36, 52];
const BG_BOTTOM = [9, 13, 20];
const RING_TOP = [255, 208, 137];
const RING_BOTTOM = [232, 148, 42];
const GLOW = [255, 179, 71];

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Cobertura de um SDF: 1 bem dentro, 0 bem fora, AA de ~1px. */
const coverage = (d) => clamp(0.5 - d);

/** SDF de retângulo de cantos arredondados (x,y no centro). */
function sdfRoundRect(x, y, halfW, radius) {
  const qx = Math.abs(x) - (halfW - radius);
  const qy = Math.abs(y) - (halfW - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/** SDF de hexágono pontudo (vértice pra cima), apótema = a. */
function sdfHexagon(x, y, apothem) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  return Math.max(ax, 0.5 * ax + 0.8660254 * ay) - apothem;
}

/** Desenha um tamanho e devolve RGBA reto (não pré-multiplicado). */
function render(size) {
  const ss = SUPERSAMPLE;
  const n = size * ss;
  const acc = new Float64Array(size * size * 4); // premultiplicado

  const half = size / 2;
  const radius = size * 0.22;
  const apothem = size * 0.335 * 0.8660254;
  const ringWidth = Math.max(1.15, size * 0.075);
  const glowRadius = size * 0.22;

  for (let sy = 0; sy < n; sy += 1) {
    for (let sx = 0; sx < n; sx += 1) {
      // coordenadas em "pixels finais"
      const px = (sx + 0.5) / ss;
      const py = (sy + 0.5) / ss;
      const x = px - half;
      const y = py - half;

      // compõe as camadas DESTE sample, em pré-multiplicado
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;

      // --- fundo: retângulo arredondado com gradiente vertical
      const bgCov = coverage(sdfRoundRect(x, y, half, radius));
      if (bgCov > 0) {
        const t = clamp(py / size);
        let r = lerp(BG_TOP[0], BG_BOTTOM[0], t);
        let g = lerp(BG_TOP[1], BG_BOTTOM[1], t);
        let b = lerp(BG_TOP[2], BG_BOTTOM[2], t);

        // brilho âmbar suave no centro, dá profundidade
        const rad = Math.hypot(x, y);
        const glow = Math.max(0, 1 - rad / (half * 1.1)) ** 2 * 0.08;
        r = lerp(r, GLOW[0], glow);
        g = lerp(g, GLOW[1], glow);
        b = lerp(b, GLOW[2], glow);

        cr = r * bgCov;
        cg = g * bgCov;
        cb = b * bgCov;
        ca = bgCov;
      }

      // --- halo do anel (fora do hexágono)
      const h = sdfHexagon(x, y, apothem);
      if (h > 0 && h < glowRadius && bgCov > 0) {
        const ga = (1 - h / glowRadius) ** 2 * 0.22 * bgCov;
        if (ga > 0.001) {
          cr = GLOW[0] * ga + cr * (1 - ga);
          cg = GLOW[1] * ga + cg * (1 - ga);
          cb = GLOW[2] * ga + cb * (1 - ga);
          ca = ga + ca * (1 - ga);
        }
      }

      // --- anel hexagonal
      const ringCov = coverage(h) - coverage(h + ringWidth);
      if (ringCov > 0.001) {
        const t = clamp((py - (half - apothem * 1.15)) / (apothem * 2.3));
        const r = lerp(RING_TOP[0], RING_BOTTOM[0], t);
        const g = lerp(RING_TOP[1], RING_BOTTOM[1], t);
        const b = lerp(RING_TOP[2], RING_BOTTOM[2], t);
        cr = r * ringCov + cr * (1 - ringCov);
        cg = g * ringCov + cg * (1 - ringCov);
        cb = b * ringCov + cb * (1 - ringCov);
        ca = ringCov + ca * (1 - ringCov);
      }

      // acumula para o box filter (média, não composição)
      const fx = Math.min(size - 1, Math.max(0, Math.floor(px)));
      const fy = Math.min(size - 1, Math.max(0, Math.floor(py)));
      const j = (fy * size + fx) * 4;
      acc[j] += cr;
      acc[j + 1] += cg;
      acc[j + 2] += cb;
      acc[j + 3] += ca;
    }
  }

  // --- downsample (box filter) + desmultiplica
  // O acumulador já somou os ss² samples de cada pixel final, então aqui só
  // normaliza pela quantidade e desfaz o pré-multiplicado.
  const out = new Uint8ClampedArray(size * size * 4);
  const per = ss * ss;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const j = (y * size + x) * 4;
      const a = acc[j + 3] / per;
      const r = acc[j] / per;
      const g = acc[j + 1] / per;
      const b = acc[j + 2] / per;

      const o = j;
      if (a > 0.0001) {
        out[o] = Math.round(clamp(r / a, 0, 255));
        out[o + 1] = Math.round(clamp(g / a, 0, 255));
        out[o + 2] = Math.round(clamp(b / a, 0, 255));
      }
      out[o + 3] = Math.round(clamp(a) * 255);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ ICO */

function icoImage(rgba, size) {
  const maskRow = Math.ceil(size / 32) * 4;
  const maskSize = maskRow * size;
  const pixelSize = size * size * 4;
  const buf = Buffer.alloc(40 + pixelSize + maskSize);

  buf.writeUInt32LE(40, 0); // biSize
  buf.writeInt32LE(size, 4); // biWidth
  buf.writeInt32LE(size * 2, 8); // biHeight (XOR + AND)
  buf.writeUInt16LE(1, 12); // biPlanes
  buf.writeUInt16LE(32, 14); // biBitCount
  buf.writeUInt32LE(0, 16); // biCompression
  buf.writeUInt32LE(pixelSize + maskSize, 20); // biSizeImage
  buf.writeInt32LE(0, 24);
  buf.writeInt32LE(0, 28);
  buf.writeUInt32LE(0, 32);
  buf.writeUInt32LE(0, 36);

  // XOR: BGRA, de baixo pra cima
  let o = 40;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      buf[o++] = rgba[i + 2];
      buf[o++] = rgba[i + 1];
      buf[o++] = rgba[i];
      buf[o++] = rgba[i + 3];
    }
  }
  // AND mask: tudo zero (transparência vem do alfa)
  return buf;
}

function buildIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function buildPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filtro none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- main */

const images = SIZES.map((size) => ({ size, data: icoImage(render(size), size) }));
const ico = buildIco(images);

await writeFile(`${PUBLIC}drop-tracker.ico`, ico);
await writeFile(`${PUBLIC}favicon.ico`, ico);

const preview = render(256);
const png = buildPng(Buffer.from(preview.buffer, preview.byteOffset, preview.byteLength), 256);
await writeFile(`${PUBLIC}drop-tracker.preview.png`, png);

console.log(`ico  : ${(ico.length / 1024).toFixed(1)} KB (${SIZES.join(', ')} px)`);
console.log(`png  : ${(png.length / 1024).toFixed(1)} KB (256 px)`);
