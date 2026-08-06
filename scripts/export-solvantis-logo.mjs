import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const brandDir = path.join(root, 'public', 'brand');
const outputDir = path.join(brandDir, 'png');

await mkdir(outputDir, { recursive: true });

const exports = [
  { source: 'solvantis-logo.svg', output: 'solvantis-logo-1200.png', width: 1200 },
  { source: 'solvantis-logo.svg', output: 'solvantis-logo-600.png', width: 600 },
  { source: 'solvantis-logo-reversed.svg', output: 'solvantis-logo-reversed-1200.png', width: 1200 },
  { source: 'solvantis-logo-reversed.svg', output: 'solvantis-logo-reversed-600.png', width: 600 },
  { source: 'solvantis-symbol.svg', output: 'solvantis-symbol-512.png', width: 512 },
  { source: 'solvantis-symbol.svg', output: 'solvantis-symbol-256.png', width: 256 },
  { source: 'solvantis-favicon.svg', output: 'solvantis-icon-512.png', width: 512 },
  { source: 'solvantis-favicon.svg', output: 'solvantis-icon-192.png', width: 192 },
  { source: 'solvantis-favicon.svg', output: 'solvantis-icon-32.png', width: 32 },
  { source: 'solvantis-favicon.svg', output: 'solvantis-icon-24.png', width: 24 },
  { source: 'solvantis-favicon.svg', output: 'solvantis-icon-16.png', width: 16 },
];

for (const asset of exports) {
  const sourcePath = path.join(brandDir, asset.source);
  const outputPath = path.join(outputDir, asset.output);
  await sharp(sourcePath, { density: 384 })
    .resize({ width: asset.width })
    .png({ compressionLevel: 9, palette: false })
    .toFile(outputPath);
  console.log(`Exported ${path.relative(root, outputPath)}`);
}