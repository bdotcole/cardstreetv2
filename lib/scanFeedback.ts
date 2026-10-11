/**
 * Fire-and-forget client helper for /api/scan/feedback. Confirmed scans feed
 * the learned photo-hash index (the scanner literally gets better with each
 * confirmed scan); rejections mark failures for the diagnostic backlog.
 * Telemetry only — must never throw into UI code.
 */

import { trackEngagement } from '@/lib/engagementEvents';

export function sendScanFeedback(
    scanId: string | undefined | null,
    outcome: 'confirmed' | 'rejected',
    cardId?: string,
): void {
    if (!scanId) return;
    // GA4 alongside the telemetry POST, from the one place every scan verdict
    // passes through, so a new scan surface is instrumented by construction.
    // Reject is worth counting too: scan_confirm on its own cannot tell a
    // scanner that nobody uses from one that everybody fails.
    trackEngagement(outcome === 'confirmed' ? 'scan_confirm' : 'scan_reject', {
        ...(cardId ? { card_id: cardId } : {}),
    });
    try {
        fetch('/api/scan/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scanId, outcome, cardId }),
            // Survives the page navigating away right after (add-to-vault jumps tabs).
            keepalive: true,
        }).catch(() => {});
    } catch {
        // Telemetry must never break the scan flow.
    }
}
