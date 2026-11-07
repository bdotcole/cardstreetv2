'use client';

import React, { useEffect, useState } from 'react';

// The default avatar the signup trigger seeds (and every other avatar fallback
// in the app uses): DiceBear, seeded with the profile id so the same account
// draws the same face everywhere.
export const defaultAvatarUrl = (seed: string) =>
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;

interface SellerAvatarProps {
    src?: string | null;
    /** Profile id: the DiceBear seed the signup trigger used. */
    seed: string;
    name?: string | null;
    className?: string;
}

/**
 * A profile picture that always resolves to a face.
 *
 * Plain <img>, never next/image: most accounts carry the DiceBear default,
 * which is an SVG, and the image optimizer refuses SVGs unless
 * dangerouslyAllowSVG is on, so <Image src={dicebear}> rendered as a broken
 * picture with its alt text ("Seller Avatar") on the listing page. A Google
 * photo URL can also stop serving. Each failure steps down one rung:
 * uploaded photo -> DiceBear for this seed -> initials.
 */
const SellerAvatar: React.FC<SellerAvatarProps> = ({ src, seed, name, className = '' }) => {
    const [stage, setStage] = useState<'src' | 'default' | 'initials'>(src ? 'src' : 'default');

    // A new seller (the next listing opened) starts the ladder over.
    useEffect(() => {
        setStage(src ? 'src' : 'default');
    }, [src, seed]);

    if (stage === 'initials') {
        const initial = (name || '').trim().charAt(0).toUpperCase() || '?';
        return (
            <div className={`flex items-center justify-center bg-slate-700 text-slate-200 font-black text-sm ${className}`} aria-hidden="true">
                {initial}
            </div>
        );
    }

    const url = stage === 'src' && src ? src : defaultAvatarUrl(seed);
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className={className}
            onError={() => setStage((s) => (s === 'src' ? 'default' : 'initials'))}
        />
    );
};

export default SellerAvatar;
