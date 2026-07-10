/**
 * Fire-and-forget client helper for /api/scan/feedback. Confirmed scans feed
 * the learned photo-hash index (the scanner literally gets better with each
 * confirmed scan); rejections mark failures for the diagnostic backlog.
 * Telemetry only — must never throw into UI code.
 */
export function sendScanFeedback(
    scanId: string | undefined | null,
    outcome: 'confirmed' | 'rejected',
    cardId?: string,
): void {
    if (!scanId) return;
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
