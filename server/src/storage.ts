import { mkdir, rm, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { config } from './config.ts';
import { newId } from './ids.ts';
import type { CardImageRow } from './types.ts';

const MAX_EDGE = 1600;
const THUMB_EDGE = 400;

/** Yüklenen görselin diskteki yeri: uploads/<user_id>/YYYY/MM/<id>.webp */
export async function saveImage(userId: string, input: Buffer) {
  const id = newId();
  const now = new Date();
  const dir = `${userId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const file = `${dir}/${id}.webp`;
  const thumb = `${dir}/${id}.thumb.webp`;

  await mkdir(resolve(config.uploadsDir, dir), { recursive: true });

  const image = sharp(input, { failOn: 'none' }).rotate(); // EXIF yönünü uygula
  const meta = await image.metadata();

  const main = await image
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  await sharp(main.data).toFile(resolve(config.uploadsDir, file));

  await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(resolve(config.uploadsDir, thumb));

  return {
    file,
    thumb,
    bytes: main.info.size,
    width: main.info.width ?? meta.width ?? 0,
    height: main.info.height ?? meta.height ?? 0,
  };
}

export async function removeImageFiles(rows: Pick<CardImageRow, 'file' | 'thumb'>[]) {
  await Promise.all(
    rows.flatMap((row) =>
      [row.file, row.thumb].map((relative) =>
        unlink(resolve(config.uploadsDir, relative)).catch(() => undefined),
      ),
    ),
  );
}

/** Hesap silinince kullanıcının tüm görsel klasörü kaldırılır. */
export async function removeUserFiles(userId: string) {
  await rm(resolve(config.uploadsDir, userId), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * İstenen yolun gerçekten bu kullanıcının klasörü altında kaldığını doğrular —
 * "../" ile başkasının dosyasına çıkılmasını engeller.
 */
export function resolveOwnedUpload(userId: string, relative: string): string | undefined {
  const base = resolve(config.uploadsDir, userId);
  const target = resolve(config.uploadsDir, relative);
  if (target !== base && !target.startsWith(base + sep)) return undefined;
  return target;
}

export const uploadDirOf = (relative: string) => dirname(resolve(config.uploadsDir, relative));
