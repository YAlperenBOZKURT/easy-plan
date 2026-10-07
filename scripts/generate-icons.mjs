import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(resolve(root, 'assets/branding/easy-plan.svg'));
async function png(path, size) {
  const data = await sharp(svg).resize(size, size).png().toBuffer();
  const destination = resolve(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
  return data;
}
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  await png(`mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png`, size);
}
await mkdir(resolve(root, 'web/public/icons'), { recursive: true });
await writeFile(resolve(root, 'web/public/icons/easy-plan.svg'), svg);
for (const size of [192, 512]) await png(`web/public/icons/easy-plan-${size}.png`, size);

// Windows supports PNG-compressed ICO frames. Keep small sizes crisp too.
const sizes = [16, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(size => sharp(svg).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const entry = 6 + 16 * i;
  header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(resolve(root, 'mobile/windows/runner/resources/app_icon.ico'), Buffer.concat([header, ...frames]));
console.log('Easy Plan launcher, web and Windows icons generated.');
