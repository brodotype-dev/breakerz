#!/usr/bin/env node
// Generates PWA icons from public/brand/icon-gradient.svg.
// Run once: `node scripts/generate-pwa-icons.mjs`. Outputs are committed.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = readFileSync(resolve(root, 'public/brand/icon-gradient.svg'));

// Maskable icons need ~20% safe-zone padding (per W3C maskable spec).
// We render the SVG smaller and pad the rest with the brand background.
async function maskable(size) {
  const inner = Math.round(size * 0.7);
  const pad = Math.round((size - inner) / 2);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 10, g: 14, b: 26, alpha: 1 }, // matches --background #0a0e1a
    },
  })
    .composite([{ input: await sharp(src).resize(inner, inner).png().toBuffer(), top: pad, left: pad }])
    .png()
    .toFile(resolve(root, `public/icons/icon-${size}-maskable.png`));
}

async function any(size, name) {
  return sharp(src)
    .resize(size, size)
    .png()
    .toFile(resolve(root, `public/icons/${name}`));
}

await Promise.all([
  any(192, 'icon-192.png'),
  any(512, 'icon-512.png'),
  any(180, 'apple-touch-icon.png'),
  maskable(512),
]);

console.log('PWA icons written to public/icons/');
