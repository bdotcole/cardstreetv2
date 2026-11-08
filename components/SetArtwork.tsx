'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { getSetLogoUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { seriesBadge, setCode } from '@/lib/setSeries';

interface SetArtworkSet {
  id: string;
  name: string;
  series?: string | null;
  images: { logo?: string; symbol?: string; product?: string };
}

interface SetArtworkProps {
  set: SetArtworkSet;
  /** next/image sizes hint for the tile this fills. */
  sizes?: string;
}

/** Where the picture's ink sits, as fractions of its width and height. */
interface InkBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Measured {
  url: string;
  box: InkBox | null;
  width: number;
  height: number;
}

// The sample is coarse on purpose: a 64px scan of a 480px picture costs
// nothing and bounds are only needed to the nearest percent.
const SAMPLE_PX = 64;
// Air left around the ink, as a fraction of the tile, and the zoom limits. A
// picture that is nearly all canvas is not blown up past 2.5x into mush.
const AIR = 0.06;
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 2.5;
// The Thai official site's product shots carry the series wordmark in the
// top-left corner of a square canvas, well clear of the product in the
// middle (measured over all 25 of them: wordmark within x < 28%, y < 30%;
// product from x >= 28%). A near-square picture whose ink shrinks by more
// than this when that corner is ignored had a separate element there, and
// the product alone is what the tile should fit.
const CORNER = { x: 0.3, y: 0.36 };
const CORNER_SHRINK = 0.85;

interface Extent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const emptyExtent = (w: number, h: number): Extent => ({ x0: w, y0: h, x1: -1, y1: -1 });

const grow = (e: Extent, x: number, y: number) => {
  if (x < e.x0) e.x0 = x;
  if (x > e.x1) e.x1 = x;
  if (y < e.y0) e.y0 = y;
  if (y > e.y1) e.y1 = y;
};

/**
 * Bounds of the ink in a loaded picture: everything that is neither
 * transparent nor near-white. Null when the picture cannot be read (a
 * cross-origin host without CORS taints the canvas) or has no ink.
 */
const measureInk = (img: HTMLImageElement): InkBox | null => {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return null;
  const w = iw >= ih ? SAMPLE_PX : Math.max(8, Math.round((SAMPLE_PX * iw) / ih));
  const h = ih >= iw ? SAMPLE_PX : Math.max(8, Math.round((SAMPLE_PX * ih) / iw));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const full = emptyExtent(w, h);
    const outsideCorner = emptyExtent(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 40 || (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235)) continue;
        grow(full, x, y);
        if (x >= CORNER.x * w || y >= CORNER.y * h) grow(outsideCorner, x, y);
      }
    }
    if (full.x1 < 0) return null;
    const ratio = iw / ih;
    let box = full;
    if (ratio >= 0.7 && ratio <= 1.3 && outsideCorner.x1 >= 0) {
      const narrower = outsideCorner.x1 - outsideCorner.x0 < CORNER_SHRINK * (full.x1 - full.x0);
      const shorter = outsideCorner.y1 - outsideCorner.y0 < CORNER_SHRINK * (full.y1 - full.y0);
      if (narrower || shorter) box = outsideCorner;
    }
    // Half a sample pixel of slack each side, since the scan is coarse.
    return {
      x0: Math.max(0, box.x0 - 0.5) / w,
      y0: Math.max(0, box.y0 - 0.5) / h,
      x1: Math.min(w, box.x1 + 1.5) / w,
      y1: Math.min(h, box.y1 + 1.5) / h,
    };
  } catch {
    return null;
  }
};

/**
 * Transform that zooms an object-contain picture until its ink fills the
 * tile, keeping the ink centred. Pixel-based because the picture's letterbox
 * depends on which side of the tile binds; it is recomputed when the tile
 * resizes.
 */
const fitInk = (m: Measured, box: InkBox, tileW: number, tileH: number): React.CSSProperties | undefined => {
  const s0 = Math.min(tileW / m.width, tileH / m.height);
  const rw = m.width * s0;
  const rh = m.height * s0;
  const bw = (box.x1 - box.x0) * rw;
  const bh = (box.y1 - box.y0) * rh;
  if (bw <= 0 || bh <= 0) return undefined;
  const cx = (tileW - rw) / 2 + ((box.x0 + box.x1) / 2) * rw;
  const cy = (tileH - rh) / 2 + ((box.y0 + box.y1) / 2) * rh;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(tileW / bw, tileH / bh) * (1 - AIR)));
  return {
    transform: `translate(${(tileW / 2 - cx).toFixed(2)}px, ${(tileH / 2 - cy).toFixed(2)}px) scale(${zoom.toFixed(3)})`,
    transformOrigin: `${cx.toFixed(2)}px ${cy.toFixed(2)}px`,
  };
};

/**
 * Picture for a set tile, in a fixed order of preference: the set logo, then
 * the booster pack or box photo from the sealed catalog, then the set symbol,
 * and when the catalog has none of those (or every one of them fails to
 * load) the era wordmark with the set code. The previous tiles hid a logo
 * that failed to load and left an empty box, and drew the first letter of the
 * set name when there was no logo, which told a Thai collector nothing.
 *
 * The logo or photo is fitted by its ink, not its canvas. The catalog's set
 * art is uneven: English logos are tight landscape wordmarks, Thai and S-era
 * Japanese logos are portrait pack photos, and the Thai official site's
 * product shots put the pack or deck box in the middle of a square white
 * canvas at about half its size with the series wordmark in a corner. Shown
 * whole, that last kind made the set picker a column of white squares with a
 * thumbnail inside each. Measuring the ink once the picture loads lets every
 * shape fill its tile the same way.
 *
 * Fills its parent: give the parent `relative overflow-hidden` and a size.
 * Pack photos are portrait, so the parent should be square or taller than
 * wide for them to show at any size.
 */
const SetArtwork: React.FC<SetArtworkProps> = ({ set, sizes = '96px' }) => {
  const sources = useMemo(() => {
    const list: { url: string; kind: 'logo' | 'product' | 'symbol' }[] = [];
    // 480 because a product shot is shown at up to 2.5x on a 3x phone screen
    // and the sources are 480px themselves.
    if (set.images.logo) list.push({ url: getSetLogoUrl(set.images.logo, 480), kind: 'logo' });
    if (set.images.product) list.push({ url: set.images.product, kind: 'product' });
    if (set.images.symbol) list.push({ url: getSetLogoUrl(set.images.symbol, 160), kind: 'symbol' });
    return list;
  }, [set.images.logo, set.images.product, set.images.symbol]);

  const [failed, setFailed] = useState(0);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [tile, setTile] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // A different set in the same tile starts from its own first choice.
  useEffect(() => {
    setFailed(0);
  }, [set.id]);

  const current = sources[failed];
  const currentUrl = current?.url;
  const fits = Boolean(current) && current.kind !== 'symbol';

  const measure = useCallback((img: HTMLImageElement, url: string) => {
    setMeasured({ url, box: measureInk(img), width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  // The tile's size, kept current across rotation and grid reflow. The
  // picture may also already be complete before React attaches onLoad (a
  // cached image on a hydrated page), in which case it is measured here.
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !fits || !currentUrl) return;
    if (el.complete && el.naturalWidth) measure(el, currentUrl);
    if (typeof ResizeObserver === 'undefined') {
      setTile({ w: el.clientWidth, h: el.clientHeight });
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setTile((t) => (t && t.w === rect.width && t.h === rect.height ? t : { w: rect.width, h: rect.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fits, currentUrl, measure]);

  if (!current) {
    const badge = seriesBadge(set);
    const code = setCode(set.id);
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-center" aria-label={set.name}>
        <span
          className={`bg-gradient-to-r ${badge.gradient} bg-clip-text text-transparent font-black italic leading-none ${badge.short.length > 4 ? 'text-sm' : 'text-xl'}`}
        >
          {badge.short}
        </span>
        {badge.short !== code && (
          <span className="text-[7px] font-black uppercase tracking-[0.18em] leading-none text-slate-400">{code}</span>
        )}
      </div>
    );
  }

  const unoptimized = shouldSkipNextOptimization(current.url);
  const known = measured?.url === current.url ? measured : null;
  const style = fits && known?.box && tile ? fitInk(known, known.box, tile.w, tile.h) : undefined;
  // Hidden until measured so the picture appears already fitted rather than
  // jumping into place a frame after it paints.
  const visibility = !fits || known ? 'opacity-100' : 'opacity-0';

  return (
    <Image
      ref={imgRef}
      src={current.url}
      alt={set.name}
      fill
      sizes={sizes}
      className={`${current.kind === 'symbol' ? 'object-contain p-3' : 'object-contain'} ${visibility} transition-opacity duration-150`}
      style={style}
      // The hosts served without the Next optimizer (Supabase storage,
      // TCGdex) all answer with Access-Control-Allow-Origin: *, which the
      // canvas read needs; optimized pictures are same-origin.
      crossOrigin={unoptimized ? 'anonymous' : undefined}
      unoptimized={unoptimized}
      onLoad={(e) => measure(e.currentTarget, current.url)}
      onError={() => setFailed((n) => n + 1)}
    />
  );
};

export default SetArtwork;
