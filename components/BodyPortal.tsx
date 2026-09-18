'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children into document.body.
 *
 * The mobile shell's <main> (components/MobileHome.tsx) is its own stacking
 * context (z-10) and the bottom tab bar is a z-40 sibling, so a fixed overlay
 * rendered anywhere inside <main> paints beneath the tab bar no matter its own
 * z-index: on a 640px phone the bar covers the overlay's bottom controls and
 * scrolling can never reveal them. Portaling to body takes the overlay out of
 * that stacking context. AuthModal, SellerInfoModal, ListingForm and
 * CardDetails carry the same portal inline; new overlays should wrap in this.
 *
 * Renders nothing until after mount: document.body does not exist during SSR,
 * and rendering a portal during hydration makes React reconcile its children
 * against body's existing DOM and fail hydration.
 */
const BodyPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    return createPortal(children, document.body);
};

export default BodyPortal;
