'use client';

import { useEffect } from 'react';
import { defineCustomElements } from '@ionic/pwa-elements/loader';

export default function PwaElementsInitializer() {
    useEffect(() => {
        // Only initialize on the browser
        if (typeof window !== 'undefined') {
            defineCustomElements(window);
        }
    }, []);

    return null;
}
