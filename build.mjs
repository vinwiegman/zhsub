import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'extension/dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const opts = {
  entryPoints: {
    content: 'extension/src/content/index.js',
    background: 'extension/src/background/index.js',
    'yt-bridge': 'extension/src/main/yt-bridge.js',
    popup: 'extension/src/popup/popup.js',
  },
  // The overlay preview harness lives outside the extension bundle.

  bundle: true,
  format: 'esm',
  target: 'chrome111',
  outdir,
  logLevel: 'info',
  // Content scripts cannot be ES modules in MV3, so emit plain IIFEs for those.
  splitting: false,
};

const iife = { ...opts, format: 'iife' };

if (watch) {
  const ctx = await esbuild.context(iife);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(iife);
}

await cp('extension/src/content/overlay.css', `${outdir}/overlay.css`);
await cp('extension/src/popup/popup.html', `${outdir}/popup.html`);

// Standalone overlay preview — lets us check pinyin layout without loading
// the extension into a browser profile.
await esbuild.build({
  entryPoints: ['demo/demo.js'],
  bundle: true,
  format: 'iife',
  outfile: 'demo/demo.bundle.js',
  target: 'chrome111',
  logLevel: 'warning',
});
