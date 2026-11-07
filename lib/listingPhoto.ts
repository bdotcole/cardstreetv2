/**
 * Every seller photo is uploaded as a real JPEG, whatever the picker handed us.
 *
 * The listing form names each upload `<ts>_front.jpg` and asks Storage for
 * image/jpeg, but supabase-js drops that contentType for a Blob body: the
 * object takes the blob's own type and the bytes are whatever the phone gave
 * us. On 2026-11-07 a seller's two back photos arrived as HEIC (the iPhone
 * default, passed through untouched by a file picker) and were stored as
 * image/heic under a .jpg name. The Next.js image optimizer cannot transform
 * HEIC, so it served the file as-is, and the Android WebView, Chrome and
 * Firefox cannot decode it either: buyers saw a broken image where the back
 * of the card should be. A RAW (DNG) pair from 2026-10-08 sat in a draft the
 * same way.
 *
 * So the photo is decoded here, on the device that picked it, and re-encoded
 * as a JPEG no larger than PHOTO_MAX_EDGE on its long side:
 * - The browser's own decoder goes first (an <img>): it handles JPEG, PNG,
 *   WebP everywhere and HEIC on Safari, bakes EXIF orientation in, and shrinks
 *   a 12-megapixel camera shot to something the optimizer and the buyer's
 *   phone handle quickly.
 * - HEIC/HEIF the browser refuses goes through libheif (WASM, loaded only when
 *   such a file turns up, so the listing form pays nothing for it otherwise).
 * - Anything the browser cannot decode (RAW, an exotic container) throws
 *   UnsupportedPhotoError so the form asks for a JPEG instead of uploading
 *   bytes nothing can render.
 *
 * Re-encoding also strips EXIF, so a seller's GPS position never leaves their
 * phone inside a listing photo. Browser-only: it needs a document.
 */

/** Longest side of an uploaded photo, in pixels. Plenty to inspect a card's
 *  edges when zoomed, a quarter of the bytes of a raw camera shot. */
export const PHOTO_MAX_EDGE = 2048;
export const PHOTO_JPEG_QUALITY = 0.88;

export class UnsupportedPhotoError extends Error {
    readonly code = 'UNSUPPORTED_PHOTO';
    constructor(message = 'This photo format cannot be used. Please choose a JPEG or PNG.') {
        super(message);
        this.name = 'UnsupportedPhotoError';
    }
}

export type PhotoContainer = 'jpeg' | 'png' | 'gif' | 'webp' | 'heif' | 'avif' | 'tiff' | 'unknown';

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
    String.fromCharCode(...bytes.subarray(start, end));

// ISOBMFF brands that mean "HEIF family" (https://github.com/strukturag/libheif/issues/83).
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/**
 * What the bytes say the file is. The picker's `type` is often empty or a
 * guess from the extension, and the extension is whatever the phone chose.
 */
export function sniffPhotoContainer(head: Uint8Array): PhotoContainer {
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
    if (head.length >= 4 && head[0] === 0x89 && ascii(head, 1, 4) === 'PNG') return 'png';
    if (head.length >= 4 && ascii(head, 0, 4) === 'GIF8') return 'gif';
    if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'webp';
    if (head.length >= 4 && (ascii(head, 0, 4) === 'II*\0' || ascii(head, 0, 4) === 'MM\0*')) return 'tiff';
    if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
        const major = ascii(head, 8, 12).replace(/\0/g, ' ').trim();
        if (major === 'avif' || major === 'avis') return 'avif';
        if (HEIF_BRANDS.has(major)) {
            // mif1 is a generic brand AVIF files use too; the compatible-brand
            // list that follows tells them apart.
            const compat = ascii(head, 16, Math.min(head.length, 64));
            return major === 'mif1' && /avi[fs]/.test(compat) ? 'avif' : 'heif';
        }
    }
    return 'unknown';
}

function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

async function encodeJpeg(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<Blob> {
    const { width, height } = fitWithin(sourceWidth, sourceHeight, PHOTO_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new UnsupportedPhotoError();
    // JPEG has no alpha channel: a transparent PNG would otherwise come out
    // on black, which reads as a photo taken in the dark.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
    if (!blob || blob.size === 0) throw new UnsupportedPhotoError();
    return blob;
}

/**
 * Decode with the browser's own image pipeline. An <img>, not
 * createImageBitmap: every engine applies EXIF orientation to an <img> and
 * draws it oriented, while createImageBitmap's orientation handling differs
 * by engine and version.
 */
async function decodeNatively(blob: Blob): Promise<Blob> {
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.decoding = 'async';
        const loaded = new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('The browser could not decode this image'));
        });
        img.src = url;
        await loaded;
        if (typeof img.decode === 'function') {
            await img.decode();
        }
        if (!img.naturalWidth || !img.naturalHeight) {
            throw new Error('The browser decoded this image to nothing');
        }
        return await encodeJpeg(img, img.naturalWidth, img.naturalHeight);
    } finally {
        URL.revokeObjectURL(url);
    }
}

type LibheifImage = import('libheif-js/libheif-wasm/libheif-bundle.mjs').LibheifImage;
type LibheifModule = import('libheif-js/libheif-wasm/libheif-bundle.mjs').LibheifModule;

let libheifLoading: Promise<LibheifModule> | null = null;

/**
 * libheif, loaded on first use: ~2 MB of WASM and glue, so never eagerly.
 * The ES module build, not `libheif-js/wasm-bundle`: the CommonJS build's
 * dynamic-require shim makes webpack warn on every compile.
 */
function loadLibheif(): Promise<LibheifModule> {
    if (!libheifLoading) {
        libheifLoading = (async () => {
            const { default: factory } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
            const libheif = await factory();
            if (libheif.ready) await libheif.ready;
            return libheif;
        })().catch((error) => {
            libheifLoading = null;
            throw error;
        });
    }
    return libheifLoading;
}

async function decodeHeifWithLibheif(blob: Blob): Promise<Blob> {
    const libheif = await loadLibheif();
    const decoder = new libheif.HeifDecoder();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let images: LibheifImage[] = [];
    try {
        images = decoder.decode(bytes);
        const primary = images[0];
        if (!primary) throw new UnsupportedPhotoError();
        const width = primary.get_width();
        const height = primary.get_height();
        // libheif applies the file's rotation/mirror boxes itself, so the
        // pixels it hands back are already the right way up.
        const pixels = new ImageData(width, height);
        await new Promise<void>((resolve, reject) => {
            primary.display(pixels, (result) => (result ? resolve() : reject(new UnsupportedPhotoError())));
        });
        // Scale at bitmap creation where the engine allows it, so a 24 MP
        // phone photo never needs a full-size canvas; otherwise draw the full
        // image once and let encodeJpeg scale it.
        const target = fitWithin(width, height, PHOTO_MAX_EDGE);
        let source: CanvasImageSource;
        let sourceWidth = width;
        let sourceHeight = height;
        try {
            source = await createImageBitmap(pixels, {
                resizeWidth: target.width,
                resizeHeight: target.height,
                resizeQuality: 'high',
            });
            sourceWidth = source.width;
            sourceHeight = source.height;
        } catch {
            const full = document.createElement('canvas');
            full.width = width;
            full.height = height;
            const ctx = full.getContext('2d');
            if (!ctx) throw new UnsupportedPhotoError();
            ctx.putImageData(pixels, 0, 0);
            source = full;
        }
        try {
            return await encodeJpeg(source, sourceWidth, sourceHeight);
        } finally {
            if ('close' in source && typeof source.close === 'function') source.close();
        }
    } finally {
        for (const image of images) {
            try { image.free(); } catch { /* already freed */ }
        }
        try { decoder.decoder.delete(); } catch { /* already deleted */ }
    }
}

/**
 * The JPEG to upload for a photo the seller just picked or took. Throws
 * UnsupportedPhotoError when nothing on this device can decode it.
 */
export async function normalizeListingPhoto(input: Blob): Promise<Blob> {
    if (typeof document === 'undefined') {
        throw new Error('normalizeListingPhoto needs a browser document');
    }
    const head = new Uint8Array(await input.slice(0, 64).arrayBuffer());
    const container = sniffPhotoContainer(head);
    try {
        return await decodeNatively(input);
    } catch (nativeError) {
        if (nativeError instanceof UnsupportedPhotoError) throw nativeError;
        if (container !== 'heif') throw new UnsupportedPhotoError();
    }
    return decodeHeifWithLibheif(input);
}
