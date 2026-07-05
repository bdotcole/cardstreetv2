import sharp from 'sharp';

/**
 * Sealed-packshot processing: remove the white studio background so boxes and
 * packs sit cleanly on the app's dark tiles, then trim and encode WebP.
 *
 * Single source of truth for the algorithm — used by the monthly
 * /api/cron/mirror-images run (incremental, new PriceCharting ingests) and by
 * scripts/ingest/mirror-sealed-images.ts (bulk backfill / re-runs). Tuned on
 * samples from every image host 2026-07-05; the tricky cases documented on the
 * constants below are real regressions found during tuning — re-verify against
 * them (script --sample mode) before changing values.
 */

// Flood fill: a border-connected pixel joins the background only when it is
// nearly pure white. The threshold sits above JPEG-noise white but below
// "light artwork" — pale product art (icy skies, white logos) must survive
// (Chien-Pao ex pack art measured min-channel 230-245 and was eaten at 216).
const BG_MIN_CHANNEL = 245;   // min(r,g,b) at least this bright
const BG_NEUTRALITY = 10;     // max channel spread (keeps colored art out)
// Products cropped at the frame edge can cover most of the border (an ETB
// packshot measured only 56% white border on a pure-white background), so the
// white-border gate is deliberately low; genuinely non-white backgrounds
// measure near 0 against the strict threshold.
const WHITE_BORDER_GATE = 0.3;
// Feather: a few dilation rings around the removed region get a brightness-
// scaled alpha ramp, melting JPEG halos and soft drop shadows into the tile.
const FEATHER_RINGS = 3;
const FEATHER_MIN_CHANNEL = 200;

const MAX_EDGE = 700;
const WEBP_QUALITY = 82;

function isBg(data: Buffer | Uint8Array, i: number): boolean {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  return mn >= BG_MIN_CHANNEL && mx - mn <= BG_NEUTRALITY;
}

/** Remove the white background from an RGBA buffer in place. */
function stripWhiteBackground(
  data: Buffer,
  width: number,
  height: number
): { removedFrac: number; whiteBorderFrac: number } {
  const n = width * height;
  const mask = new Uint8Array(n); // 1 = background
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;

  let whiteBorder = 0, borderCount = 0;
  const seed = (x: number, y: number) => {
    const p = y * width + x;
    borderCount++;
    if (isBg(data, p * 4)) {
      whiteBorder++;
      if (!mask[p]) { mask[p] = 1; queue[qt++] = p; }
    }
  };
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { seed(0, y); seed(width - 1, y); }

  const whiteBorderFrac = whiteBorder / Math.max(1, borderCount);
  // Not a white-background packshot — leave it alone.
  if (whiteBorderFrac < WHITE_BORDER_GATE) return { removedFrac: 0, whiteBorderFrac };

  while (qh < qt) {
    const p = queue[qh++];
    const x = p % width, y = (p / width) | 0;
    if (x > 0 && !mask[p - 1] && isBg(data, (p - 1) * 4)) { mask[p - 1] = 1; queue[qt++] = p - 1; }
    if (x < width - 1 && !mask[p + 1] && isBg(data, (p + 1) * 4)) { mask[p + 1] = 1; queue[qt++] = p + 1; }
    if (y > 0 && !mask[p - width] && isBg(data, (p - width) * 4)) { mask[p - width] = 1; queue[qt++] = p - width; }
    if (y < height - 1 && !mask[p + width] && isBg(data, (p + width) * 4)) { mask[p + width] = 1; queue[qt++] = p + width; }
  }

  for (let p = 0; p < n; p++) if (mask[p]) data[p * 4 + 3] = 0;

  // Feather rings: bright pixels near the removed region fade by brightness so
  // anti-aliased edges and shadow remnants blend into any tile color.
  let band = mask;
  for (let ring = 0; ring < FEATHER_RINGS; ring++) {
    const next = new Uint8Array(band);
    const fade = 1 - (ring + 1) / (FEATHER_RINGS + 1); // outer rings fade more
    for (let p = 0; p < n; p++) {
      if (band[p]) continue;
      const x = p % width, y = (p / width) | 0;
      const touches =
        (x > 0 && band[p - 1]) || (x < width - 1 && band[p + 1]) ||
        (y > 0 && band[p - width]) || (y < height - 1 && band[p + width]);
      if (!touches) continue;
      next[p] = 1;
      const i = p * 4;
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      if (mn >= FEATHER_MIN_CHANNEL) {
        const t = (mn - FEATHER_MIN_CHANNEL) / (255 - FEATHER_MIN_CHANNEL); // 0..1, whiter = fainter
        data[i + 3] = Math.min(data[i + 3], Math.round(255 * (1 - t * (1 - fade * 0.4))));
      }
    }
    band = next;
  }

  return { removedFrac: qt / n, whiteBorderFrac };
}

export interface ProcessedSealedImage {
  buffer: Buffer;
  stripped: boolean;
  whiteBorderFrac: number;
}

/**
 * Download a packshot, strip its white background (when it has one), trim to
 * the content bounding box, and encode WebP with alpha.
 * Returns null when the image is entirely background (blank placeholder).
 * Throws on fetch/decode errors — callers count those as failures and retry
 * on their next run.
 */
export async function processSealedImage(url: string): Promise<ProcessedSealedImage | null> {
  const res = await fetch(url, { headers: { 'User-Agent': 'cardstreet-image-mirror/1.0' } });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  const base = sharp(input, { limitInputPixels: 50_000_000 }).rotate();
  const { data, info } = await base.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const { removedFrac, whiteBorderFrac } = stripWhiteBackground(data, width, height);
  if (removedFrac > 0.98) return null;

  let img = sharp(data, { raw: { width, height, channels: 4 } });

  if (removedFrac > 0) {
    // Trim to the content bounding box with a 2% margin.
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX > minX && maxY > minY) {
      const mx = Math.round((maxX - minX) * 0.02), my = Math.round((maxY - minY) * 0.02);
      const left = Math.max(0, minX - mx), top = Math.max(0, minY - my);
      img = img.extract({
        left,
        top,
        width: Math.min(width, maxX + mx + 1) - left,
        height: Math.min(height, maxY + my + 1) - top,
      });
    }
  }

  const buffer = await img
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  return { buffer, stripped: removedFrac > 0, whiteBorderFrac };
}

/** Storage prefix for mirrored sealed images inside the card-images bucket. */
export const SEALED_MIRROR_PREFIX = 'sealed';

/** True when a sealed image_url already points at our processed mirror. */
export function isMirroredSealedUrl(url: string | null | undefined): boolean {
  return !!url && url.includes(`/card-images/${SEALED_MIRROR_PREFIX}/`);
}
