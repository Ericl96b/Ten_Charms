// Any file dropped in assets/audio named after a sound id replaces the synthesized version of that sound.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const EXT = new Set(['.m4a', '.mp3', '.wav', '.aac']);

export function buildAudioManifest(srcDir, outDir) {
  const manifest = {};
  if (!existsSync(srcDir)) return manifest;
  for (const file of readdirSync(srcDir)) {
    const ext = extname(file).toLowerCase();
    if (!EXT.has(ext)) continue;
    mkdirSync(outDir, { recursive: true });
    cpSync(join(srcDir, file), join(outDir, file));
    manifest[file.slice(0, -ext.length)] = `audio/${file}`;
  }
  return manifest;
}
