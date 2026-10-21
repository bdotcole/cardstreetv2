'use client';

/**
 * Slab Packs — haptics. Uses the Vibration API, which Android (browser and
 * the Capacitor WebView) supports and iOS does not; on iOS every call is a
 * silent no-op. Giving iPhones the same feel needs @capacitor/haptics, which
 * the app does not ship yet.
 */

let enabled = true;

function buzz(pattern: number | number[]) {
    if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Chrome refuses (and logs) a vibrate before the first real tap.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try {
        navigator.vibrate(pattern);
    } catch {
        // Some WebViews throw without a prior user gesture.
    }
}

// One pattern per hit class rank (D..SS): longer and busier as the pull gets
// bigger, so the phone tells you before your eyes do.
const REVEAL_PATTERNS: number[][] = [
    [14],
    [20],
    [22, 40, 30],
    [30, 40, 30, 40, 60],
    [40, 40, 40, 40, 40, 40, 140],
    [50, 40, 50, 40, 50, 40, 50, 40, 60, 60, 260],
];

export const haptics = {
    setEnabled(on: boolean) {
        enabled = on;
    },
    tap: () => buzz(8),
    /** A grain of the tear; called repeatedly while the finger moves. */
    grain: () => buzz(5),
    burst: () => buzz([30, 30, 50]),
    step: () => buzz(12),
    reveal: (rank: number) => buzz(REVEAL_PATTERNS[Math.min(Math.max(0, rank), REVEAL_PATTERNS.length - 1)]),
    coins: () => buzz([12, 30, 12]),
    deny: () => buzz([30, 60, 30]),
};
