// Fit a numeric chart Y-axis to the data's own value range instead of anchoring at
// 0. Recharts' default [0, 'auto'] draws a ฿15 card — or a stable ฿10k portfolio —
// against a 0-to-max scale, collapsing every real move into a flat sliver at the top.
// Fit to the data's own min/max with 15% headroom so the line never kisses an edge,
// and a small floor for a genuinely flat series so it reads as a centered line rather
// than pinned to a border. Clamped at 0 (these values are non-negative) and kept to
// whole units to match integer tick labels.
//
// Shared by the card price-history chart (PriceChart) and the collection value chart
// (ProInsights) so both scale identically.
export function fitValueDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = span > 0 ? span * 0.15 : Math.max(1, Math.round(max * 0.05));
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

/**
 * Axis range plus the tick values to draw, for a value-over-time chart.
 *
 * fitValueDomain keeps the line off the edges, but it leaves the tick values
 * to recharts (฿41k, ฿47k, ฿53k, ฿59k, ฿65k on one portfolio) and sits the
 * series minimum a hair above the bottom rule, so a 25% fall read as "my
 * portfolio went to zero". This pads the bottom more than the top, so the low
 * point floats clear of the floor, then snaps both ends to a round step
 * (1 / 2 / 5 x 10^k) so the labels are numbers people read at a glance. A
 * nearly flat series gets a minimum span of 8% of its level, so a stable
 * portfolio draws as a calm line rather than a magnified wobble. Used by
 * PriceChart (portfolio and card price history).
 */
export function niceValueDomain(values: number[], tickCount = 4): { domain: [number, number]; ticks: number[] } {
  if (values.length === 0) return { domain: [0, 1], ticks: [0, 1] };
  const dataMin = Math.min(...values);
  let min = dataMin;
  let max = Math.max(...values);
  const level = Math.max(Math.abs(min), Math.abs(max), 1);
  const minSpan = level * 0.08;
  if (max - min < minSpan) {
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const span = max - min;
  let lo = min - span * 0.3;
  let hi = max + span * 0.15;
  if (dataMin >= 0) lo = Math.max(0, lo);
  const step = niceStep((hi - lo) / tickCount);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { domain: [lo, hi], ticks };
}

// Heckbert's "nice numbers": the tick step closest to the raw interval among
// 1, 2, 5 and 10 times a power of ten.
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const nice = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return nice * magnitude;
}
