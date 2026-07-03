// Listings are priced in THB natively; the desktop surface shows THB only for
// now. Sub-฿1 values keep two decimals so cheap bulk cards don't render as ฿0.
export function formatTHB(amount: number): string {
    return `฿${amount < 1 ? amount.toFixed(2) : Math.round(amount).toLocaleString()}`;
}
