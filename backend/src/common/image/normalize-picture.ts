import { BadRequestException } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';

import { LOGO_MAX_BYTES, LOGO_TYPES, validateLogo } from '../../modules/company/company.service';

/**
 * Picture normalisation shared by every picture the program stores.
 *
 * Logos and item pictures need the same guarantees — a bounded upload size, a
 * real (not merely claimed) image type, a sane pixel count, no animation, and
 * re-encoding so the stored bytes are always something we produced. They differ
 * only in the words shown to the user and in the final dimensions, so the logic
 * lives here and the wording is passed in.
 *
 * The original upload is never stored. Anything that comes back out of this
 * function is WebP that this process encoded.
 */
export interface PictureLabels {
  /** «الشعار» / «صورة الصنف» — used in the Arabic half of every message. */
  subjectAr: string;
  /** «The logo» / «The item picture» — used in the English half. */
  subjectEn: string;
  /** Longest edge of the stored picture. */
  maxDimension: number;
  /** Largest pixel count accepted before decoding. */
  maxPixels: number;
}

export interface NormalizedPicture {
  data: Uint8Array<ArrayBuffer>;
  mime: string;
  width: number;
  height: number;
}

const GENERIC_QUALITY = [
  [1024, 82],
  [768, 76],
  [512, 68],
  [384, 60],
  [256, 50],
  [128, 42],
] as const;

/// Validates, resizes and recompresses a source picture.
///
/// `maxBytes` is the upload cap applied before decoding; the pixel cap is
/// enforced by sharp so a decompression bomb cannot allocate the machine's
/// memory.
export async function normalizePicture(
  data: Buffer,
  mime: string,
  labels: PictureLabels,
  maxBytes: number = LOGO_MAX_BYTES,
): Promise<NormalizedPicture> {
  const normalised = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (!LOGO_TYPES[normalised]) {
    throw new BadRequestException(
      `${labels.subjectAr} يجب أن يكون صورة PNG أو JPEG أو WebP / ${labels.subjectEn} must be PNG, JPEG or WebP.`,
    );
  }
  if (data.length === 0) {
    throw new BadRequestException(
      `ملف ${labels.subjectAr} فارغ / The ${stripArticle(labels.subjectEn)} file is empty.`,
    );
  }
  if (data.length > maxBytes) {
    throw new BadRequestException(
      `حجم ${labels.subjectAr} يتجاوز ${Math.round(maxBytes / 1024 / 1024)} ميجابايت / The ${stripArticle(labels.subjectEn)} exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    );
  }

  // The magic bytes are checked as well as the declared type: a caller can send
  // anything while claiming "image/png".
  const checked = validateLogo(data, normalised, maxBytes);
  const input = Buffer.from(checked.data);

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { failOn: 'error', limitInputPixels: labels.maxPixels }).metadata();
  } catch {
    throw new BadRequestException(
      `تعذّر فتح الصورة. اختر ملف PNG أو JPEG أو WebP سليمًا / The ${stripArticle(labels.subjectEn)} could not be decoded.`,
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 32 || height < 32 || width * height > labels.maxPixels || (metadata.pages ?? 1) > 1) {
    throw new BadRequestException(
      `يجب أن تكون أبعاد ${labels.subjectAr} ٣٢ × ٣٢ بكسل على الأقل، وألا تتجاوز الصورة المتحركة الحد المسموح / Use a non-animated ${stripArticle(labels.subjectEn)} of at least 32 × 32 pixels and no more than the pixel limit.`,
    );
  }

  for (const [bound, quality] of GENERIC_QUALITY) {
    const edge = Math.min(bound, labels.maxDimension);
    try {
      const encoded = await sharp(input, { failOn: 'error', limitInputPixels: labels.maxPixels })
        .rotate()
        .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 5 })
        .toBuffer();
      if (encoded.length <= maxBytes) {
        const out = await sharp(encoded).metadata();
        return {
          data: Uint8Array.from(encoded),
          mime: 'image/webp',
          width: out.width ?? edge,
          height: out.height ?? edge,
        };
      }
    } catch {
      throw new BadRequestException(
        `تعذّر ضغط الصورة. اختر صورة صالحة وحاول مرة أخرى / The ${stripArticle(labels.subjectEn)} could not be resized.`,
      );
    }
  }

  throw new BadRequestException(
    `تعذّر ضغط الصورة إلى الحجم المسموح. اختر صورة أصغر / The ${stripArticle(labels.subjectEn)} remains too large after compression; choose a smaller image.`,
  );
}

/// "The item picture" → "item picture", so it can sit after "The".
function stripArticle(subjectEn: string): string {
  return subjectEn.replace(/^the\s+/i, '');
}
