import React from 'react';

export type GemType = 'sapphire' | 'ruby' | 'emerald' | 'diamond' | 'opal';

interface GemIconProps {
    type: GemType;
    className?: string;
}

// Shared faceted cut-gem silhouette (table top, crown, pavilion tip).
// Sapphire / ruby / emerald reuse this shape so the gem tiers feel like a set;
// only the colour ramp changes.
const FACETED_OUTLINE = 'M7 3 L17 3 L21 9 L12 21 L3 9 Z';
const FACETED_FACETS = [
    'M3 9 L21 9',        // girdle
    'M7 3 L9.5 9',       // left crown
    'M17 3 L14.5 9',     // right crown
    'M9.5 9 L12 21',     // left pavilion
    'M14.5 9 L12 21',    // right pavilion
];

// [light, mid, dark] stops for the top-to-tip gradient of each faceted gem.
const GEM_RAMPS: Record<'sapphire' | 'ruby' | 'emerald', [string, string, string]> = {
    sapphire: ['#bfdbfe', '#3b82f6', '#1e3a8a'],
    ruby: ['#fecaca', '#ef4444', '#7f1d1d'],
    emerald: ['#bbf7d0', '#10b981', '#064e3b'],
};

function FacetedGem({ type, className }: { type: 'sapphire' | 'ruby' | 'emerald'; className?: string }) {
    const [light, mid, dark] = GEM_RAMPS[type];
    const gradId = `gem-${type}`;
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <linearGradient id={gradId} x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor={light} />
                    <stop offset="0.45" stopColor={mid} />
                    <stop offset="1" stopColor={dark} />
                </linearGradient>
            </defs>
            <path d={FACETED_OUTLINE} fill={`url(#${gradId})`} stroke={light} strokeWidth="0.6" strokeLinejoin="round" />
            {FACETED_FACETS.map((d, i) => (
                <path key={i} d={d} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.5" strokeLinecap="round" />
            ))}
            {/* Specular highlight on the table */}
            <path d="M8 4 L13 4 L11 8 L9 8 Z" fill="#ffffff" fillOpacity="0.35" />
        </svg>
    );
}

// Brilliant-cut diamond: wider table, more facets, near-clear icy ramp plus a
// sparkle accent so it reads as a step above the coloured gemstones.
function DiamondGem({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <linearGradient id="gem-diamond" x1="12" y1="3" x2="12" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="0.4" stopColor="#cffafe" />
                    <stop offset="0.75" stopColor="#67e8f9" />
                    <stop offset="1" stopColor="#0e7490" />
                </linearGradient>
            </defs>
            <path
                d="M5 3 L19 3 L23 9 L12 22 L1 9 Z"
                fill="url(#gem-diamond)"
                stroke="#ffffff"
                strokeWidth="0.6"
                strokeLinejoin="round"
            />
            {['M1 9 L23 9', 'M5 3 L8 9', 'M19 3 L16 9', 'M8 9 L12 3', 'M16 9 L12 3', 'M8 9 L12 22', 'M16 9 L12 22'].map((d, i) => (
                <path key={i} d={d} stroke="#ffffff" strokeOpacity="0.45" strokeWidth="0.5" strokeLinecap="round" />
            ))}
            {/* Sparkle accent */}
            <path
                d="M20 2.5 L20.7 4.3 L22.5 5 L20.7 5.7 L20 7.5 L19.3 5.7 L17.5 5 L19.3 4.3 Z"
                fill="#ffffff"
            />
        </svg>
    );
}

// Black opal cabochon: smooth dark oval with an iridescent galaxy/nebula
// play-of-colour and scattered star flecks.
function OpalGem({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <radialGradient id="opal-base" cx="0.4" cy="0.35" r="0.85">
                    <stop offset="0" stopColor="#312e81" />
                    <stop offset="0.55" stopColor="#1e1b4b" />
                    <stop offset="1" stopColor="#020617" />
                </radialGradient>
                <clipPath id="opal-clip">
                    <ellipse cx="12" cy="12.3" rx="8.4" ry="9.4" />
                </clipPath>
            </defs>
            <ellipse cx="12" cy="12.3" rx="8.4" ry="9.4" fill="url(#opal-base)" stroke="#475569" strokeWidth="0.6" />
            <g clipPath="url(#opal-clip)" opacity="0.9">
                {/* Nebula play-of-colour blobs */}
                <ellipse cx="9" cy="8" rx="4.5" ry="3" fill="#22d3ee" opacity="0.55" transform="rotate(-25 9 8)" />
                <ellipse cx="15" cy="11" rx="4" ry="2.6" fill="#a855f7" opacity="0.55" transform="rotate(20 15 11)" />
                <ellipse cx="10.5" cy="15.5" rx="4.2" ry="2.4" fill="#ec4899" opacity="0.5" transform="rotate(-15 10.5 15.5)" />
                <ellipse cx="14" cy="16.5" rx="3" ry="2" fill="#34d399" opacity="0.5" transform="rotate(30 14 16.5)" />
                <ellipse cx="8" cy="13" rx="2.4" ry="1.8" fill="#fbbf24" opacity="0.45" transform="rotate(10 8 13)" />
                {/* Star flecks */}
                <circle cx="9" cy="7" r="0.5" fill="#ffffff" />
                <circle cx="14.5" cy="9" r="0.4" fill="#ffffff" />
                <circle cx="11" cy="13" r="0.45" fill="#ffffff" />
                <circle cx="16" cy="14.5" r="0.35" fill="#ffffff" />
                <circle cx="8.5" cy="16" r="0.4" fill="#ffffff" />
            </g>
            {/* Glossy top highlight */}
            <ellipse cx="9.5" cy="7.5" rx="3" ry="1.6" fill="#ffffff" opacity="0.25" transform="rotate(-25 9.5 7.5)" />
        </svg>
    );
}

export const GemIcon: React.FC<GemIconProps> = ({ type, className = 'w-6 h-6' }) => {
    if (type === 'diamond') return <DiamondGem className={className} />;
    if (type === 'opal') return <OpalGem className={className} />;
    return <FacetedGem type={type} className={className} />;
};

export default GemIcon;
