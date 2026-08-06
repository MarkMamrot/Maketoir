import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const brandDir = path.join(root, 'public', 'brand');
const outputDir = path.join(brandDir, 'png');

await mkdir(outputDir, { recursive: true });

const sourceSvg = await readFile(path.join(brandDir, 'new logo', 'new logo.svg'), 'utf8');
const sourcePaths = [...sourceSvg.matchAll(/<path(?: class="st0")? d="([^"]+)"\/>/g)].map(match => match[1]);
const markPaths = sourcePaths.slice(-2);

if (markPaths.length !== 2) {
  throw new Error('Expected two icon paths in public/brand/new logo/new logo.svg');
}

const renderPaths = (fill) => markPaths.map(d => `  <path fill="${fill}" d="${d}"/>`).join('\n');
const renderNestedMark = (fill) => `  <svg x="0" y="0" width="64" height="64" viewBox="0 0 305 306.5">\n${markPaths.map(d => `    <path fill="${fill}" d="${d}"/>`).join('\n')}\n  </svg>`;

const svgMasters = {
  'solvantis-symbol.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 305 306.5" role="img" aria-labelledby="title desc">
  <title id="title">Solvantis symbol</title>
  <desc id="desc">Interlocking geometric paths forming the Solvantis symbol.</desc>
${renderPaths('#1EA8C2')}
</svg>`,
  'solvantis-symbol-mono.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 305 306.5" role="img" aria-labelledby="title desc">
  <title id="title">Solvantis monochrome symbol</title>
  <desc id="desc">Interlocking geometric paths forming the Solvantis symbol.</desc>
${renderPaths('#0F172A')}
</svg>`,
  'solvantis-symbol-reversed.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 305 306.5" role="img" aria-labelledby="title desc">
  <title id="title">Solvantis reversed symbol</title>
  <desc id="desc">Solvantis geometric symbol on navy.</desc>
  <rect width="305" height="306.5" rx="60" fill="#0F172A"/>
${renderPaths('#35BFD6')}
</svg>`,
  'solvantis-favicon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 305 306.5" role="img" aria-label="Solvantis">
  <rect width="305" height="306.5" rx="60" fill="#0F172A"/>
${renderPaths('#35BFD6')}
</svg>`,
  'solvantis-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 326 64" role="img" aria-labelledby="title desc">
  <title id="title">Solvantis</title>
  <desc id="desc">Solvantis geometric symbol and wordmark.</desc>
${renderNestedMark('#1EA8C2')}
  <text x="78" y="43" fill="#0F172A" font-family="Montserrat, Arial, sans-serif" font-size="31" font-weight="800" letter-spacing="0">Solvantis</text>
</svg>`,
  'solvantis-logo-reversed.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 326 64" role="img" aria-labelledby="title desc">
  <title id="title">Solvantis reversed logo</title>
  <desc id="desc">Solvantis geometric symbol and white wordmark for dark backgrounds.</desc>
${renderNestedMark('#35BFD6')}
  <text x="78" y="43" fill="#FFFFFF" font-family="Montserrat, Arial, sans-serif" font-size="31" font-weight="800" letter-spacing="0">Solvantis</text>
</svg>`,
};

svgMasters['solvantis-logo-geometric.svg'] = svgMasters['solvantis-logo.svg'];

for (const [filename, contents] of Object.entries(svgMasters)) {
  await writeFile(path.join(brandDir, filename), `${contents}\n`, 'utf8');
  console.log(`Generated ${path.relative(root, path.join(brandDir, filename))}`);
}

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