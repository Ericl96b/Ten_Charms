// Generates the app icon (vector, in code) at every size the manifest needs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

function petal(cx, cy, r, angle) {
  const a = (angle * Math.PI) / 180;
  return `<circle cx="${cx + Math.sin(a) * r}" cy="${cy - Math.cos(a) * r}" r="${r * 0.82}"/>`;
}

export function iconSvg({ maskable = false, rounded = true } = {}) {
  const s = 512;
  const scale = maskable ? 0.72 : 1;
  const c = s / 2;
  const ringR = 150 * scale;
  const petalR = 62 * scale;
  const petals = [0, 72, 144, 216, 288].map((a) => petal(c, c, petalR, a)).join('');
  const sx = c + 172 * scale;
  const sy = c - 172 * scale;
  const k = 46 * scale;
  const sparkle = `M${sx} ${sy - k}Q${sx + k * 0.14} ${sy - k * 0.14} ${sx + k} ${sy}Q${sx + k * 0.14} ${sy + k * 0.14} ${sx} ${sy + k}Q${sx - k * 0.14} ${sy + k * 0.14} ${sx - k} ${sy}Q${sx - k * 0.14} ${sy - k * 0.14} ${sx} ${sy - k}Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
<rect width="${s}" height="${s}" rx="${rounded && !maskable ? 112 : 0}" fill="#F6D2D8"/>
<circle cx="${c}" cy="${c}" r="${ringR}" fill="#FFF8F4" stroke="#C9973F" stroke-width="${22 * scale}"/>
<g fill="#C7406E">${petals}</g>
<circle cx="${c}" cy="${c}" r="${26 * scale}" fill="#F6D27F"/>
<path d="${sparkle}" fill="#D9A441"/>
</svg>`;
}

export async function buildIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  const render = (svg, size, file) => sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(join(outDir, file));
  // iOS applies its own corner mask, so the touch icon is square-cornered.
  await render(iconSvg({ rounded: false }), 180, 'apple-touch-icon.png');
  await render(iconSvg(), 192, 'icon-192.png');
  await render(iconSvg(), 512, 'icon-512.png');
  await render(iconSvg({ maskable: true }), 192, 'icon-maskable-192.png');
  await render(iconSvg({ maskable: true }), 512, 'icon-maskable-512.png');
  writeFileSync(join(outDir, 'icon.svg'), iconSvg());
}
