// For portraits generated on a flat cream background: makes that background transparent.
// Usage: node scripts/remove-cream.mjs assets/portraits/pip-neutral.png [more files...]
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const CREAM = [0xff, 0xf8, 0xf4];
const SOLID_AT = 42;
const CLEAR_AT = 16;

export async function removeCream(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const closeness = (i) => Math.max(Math.abs(data[i] - CREAM[0]), Math.abs(data[i + 1] - CREAM[1]), Math.abs(data[i + 2] - CREAM[2]));
  // Only cream connected to the image's edge goes, so cream inside the character stays.
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, x + (height - 1) * width);
  for (let y = 0; y < height; y++) stack.push(y * width, width - 1 + y * width);
  while (stack.length > 0) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    const d = closeness(i);
    if (d >= SOLID_AT) continue;
    data[i + 3] = d <= CLEAR_AT ? 0 : Math.round((255 * (d - CLEAR_AT)) / (SOLID_AT - CLEAR_AT));
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < width * (height - 1)) stack.push(p + width);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

if (process.argv[1]?.endsWith('remove-cream.mjs')) {
  for (const file of process.argv.slice(2)) {
    writeFileSync(file, await removeCream(readFileSync(file)));
    console.log(`Cleaned ${file}`);
  }
}
