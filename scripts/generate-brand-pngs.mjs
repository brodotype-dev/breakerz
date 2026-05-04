import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const BRAND = join(ROOT, "public", "brand");
const APP = join(ROOT, "app");

async function rasterize(svgPath, outPath, size) {
  const svg = await readFile(svgPath);
  const opts = typeof size === "number" ? { width: size, height: size } : size;
  const buf = await sharp(svg, { density: 384 }).resize(opts).png().toBuffer();
  await writeFile(outPath, buf);
  console.log(`✓ ${outPath} (${typeof size === "number" ? `${size}×${size}` : `${size.width}×${size.height}`})`);
}

await mkdir(BRAND, { recursive: true });

await rasterize(join(BRAND, "icon-gradient.svg"), join(APP, "icon.png"), 512);
await rasterize(join(BRAND, "icon-gradient.svg"), join(APP, "apple-icon.png"), 180);
await rasterize(join(BRAND, "og-card.svg"), join(APP, "opengraph-image.png"), { width: 1200, height: 630 });
await rasterize(join(BRAND, "og-card.svg"), join(APP, "twitter-image.png"), { width: 1200, height: 630 });
await rasterize(join(BRAND, "wordmark.svg"), join(BRAND, "wordmark-email.png"), { width: 480, height: 98 });
