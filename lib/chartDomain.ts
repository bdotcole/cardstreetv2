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
