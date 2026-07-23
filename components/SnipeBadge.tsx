import Image from 'next/image';

// Admin-seeded promo listings: staff can list below the ฿20 floor (down to ฿1)
// to drop "snipe" deals users race to grab. Exactly ฿1 is the marker — regular
// sellers can't list under ฿20, so nothing else collides with it.
export const isSnipeListing = (priceThb: number | null | undefined): boolean =>
    Number(priceThb) === 1;

// Target-and-arrow marker rendered at the bottom-right of a listing tile,
// straddling the boundary between the card image and the tile's info panel.
// Position comes from the caller's className; pointer events stay off so
// taps fall through to the tile.
export default function SnipeBadge({ className = '' }: { className?: string }) {
    return (
        <Image
            src="/promo/snipe-badge.webp"
            alt="สายปาด — CardStreet snipe deal"
            width={254}
            height={256}
            unoptimized
            className={`pointer-events-none select-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)] ${className}`}
        />
    );
}
