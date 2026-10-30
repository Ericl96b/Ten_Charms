// Builds the static site. `--dev` keeps developer test hooks; production strips them entirely.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcons } from './icons.mjs';
import { buildPortraits } from './portraits.mjs';
import { buildAudioManifest } from './audio-manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const out = join(root, dev ? 'dist-dev' : 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const fontFiles = [
  ['fraunces', 'fraunces-latin-600-normal.woff2'],
  ['fraunces', 'fraunces-latin-600-italic.woff2'],
  ['fraunces', 'fraunces-latin-800-normal.woff2'],
  ['nunito', 'nunito-latin-600-normal.woff2'],
  ['nunito', 'nunito-latin-700-normal.woff2'],
  ['nunito', 'nunito-latin-800-normal.woff2'],
];
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const [pkg, file] of fontFiles) {
  cpSync(join(root, 'node_modules', '@fontsource', pkg, 'files', file), join(out, 'fonts', file));
}

await buildIcons(join(out, 'icons'));
const portraits = await buildPortraits(join(root, 'assets', 'portraits'), join(out, 'portraits'));
const audio = buildAudioManifest(join(root, 'assets', 'audio'), join(out, 'audio'));

await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  format: 'esm',
  target: ['safari15'],
  outfile: join(out, 'app.js'),
  define: {
    __DEV__: JSON.stringify(dev),
    __PORTRAITS__: JSON.stringify(portraits),
    __AUDIO_FILES__: JSON.stringify(audio),
  },
  logLevel: 'warning',
});
await build({
  entryPoints: [join(root, 'src', 'ui', 'styles', 'index.css')],
  bundle: true,
  minify: !dev,
  external: ['fonts/*'],
  outfile: join(out, 'app.css'),
  logLevel: 'warning',
});

cpSync(join(root, 'public'), out, { recursive: true });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// The precache list and the version both come from the built files, so any change yields an update.
const files = walk(out).map((p) => relative(out, p).replaceAll('\\', '/')).filter((p) => p !== 'sw.js');
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest('hex').slice(0, 12);
const sw = readFileSync(join(root, 'src', 'sw.js'), 'utf8')
  .replace('__VERSION__', version)
  .replace('__ASSETS__', JSON.stringify(['./', ...files.filter((f) => f !== 'index.html'), 'index.html']));
writeFileSync(join(out, 'sw.js'), sw);

const total = walk(out).reduce((n, p) => n + statSync(p).size, 0);
console.log(`Built ${dev ? 'development' : 'production'} to ${relative(root, out)}: ${files.length + 1} files, ${(total / 1024).toFixed(0)} KB, version ${version}`);
if (!existsSync(join(out, 'index.html'))) throw new Error('index.html missing from build');
