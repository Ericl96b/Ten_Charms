// Turns any painted portraits in assets/portraits into 256 px and 512 px web versions.
// Missing files are normal: the game falls back to monogram placeholders for them.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const NAME = /^(pip|marigold|briar|hoot|nightshade|lumi|mallow|velvet|fennel|sable|mossback|lunaria)-(neutral|happy|sad|smug|intense)\.png$/;

export async function buildPortraits(srcDir, outDir) {
  const found = [];
  if (!existsSync(srcDir)) return found;
  for (const file of readdirSync(srcDir)) {
    if (!NAME.test(file)) {
      if (file.toLowerCase().endsWith('.png')) console.warn(`Ignoring portrait with an unexpected name: ${file}`);
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    const base = file.replace('.png', '');
    try {
      for (const size of [256, 512]) {
        await sharp(join(srcDir, file)).resize(size, size, { fit: 'cover' }).webp({ quality: 82 }).toFile(join(outDir, `${base}-${size}.webp`));
      }
      found.push(base);
    } catch (err) {
      console.warn(`Skipping unreadable portrait ${file}: ${err.message}`);
    }
  }
  return found.sort();
}
