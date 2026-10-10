/**
 * First-touch acquisition capture (browser + Capacitor WebView).
 *
 * Which link brought a person here is only knowable at the moment they land:
 * the utm_* set on the URL (the tracked short links set it), or on Android
 * the Play install referrer. Both are stashed here for ACQ_TTL_DAYS and
 * written onto the profile once, at the first sign-in after signup
 * (/api/profile/acquisition). First touch wins — a later visit with a
 * different tag does not overwrite an earlier one, which is the convention
 * GA4's first-user attribution uses too, so the two can be compared.
 *
 * Partner referrals (?ref=, cs_ref) are a separate system with money
 * attached (lib/referralClient.ts); this is analytics only and never
 * touches referred_by.
 */

export const ACQ_STORAGE_KEY = 'cs_acq';
const ACQ_TTL_DAYS = 30;
const attemptKey = (userId: string) => `cs_acq_recorded_${userId}`;

export interface Acquisition {
    source: string;
    medium: string;
    campaign: string;
    landedAt: string;
}

function clean(v: string | null | undefined): string {
    return (v || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
}

function read(): Acquisition | null {
    try {
        const raw = localStorage.getItem(ACQ_STORAGE_KEY);
        if (!raw) return null;
        const a = JSON.parse(raw) as Acquisition;
        if (!a?.source || !a.landedAt) return null;
        if (Date.now() - new Date(a.landedAt).getTime() > ACQ_TTL_DAYS * 86_400_000) {
            localStorage.removeItem(ACQ_STORAGE_KEY);
            return null;
        }
        return a;
    } catch {
        return null;
    }
}

function store(params: URLSearchParams): void {
    const source = clean(params.get('utm_source'));
    if (!source) return;
    try {
        if (read()) return; // first touch wins
        const a: Acquisition = {
            source,
            medium: clean(params.get('utm_medium')),
            campaign: clean(params.get('utm_campaign')),
            landedAt: new Date().toISOString(),
        };
        localStorage.setItem(ACQ_STORAGE_KEY, JSON.stringify(a));
    } catch {
        // Storage unavailable (private mode) — nothing to record.
    }
}

/** Call on app mount: stash the landing page's utm_* for later attribution. */
export function captureAcquisitionParams(): void {
    try {
        store(new URLSearchParams(window.location.search));
    } catch {
        // No window / malformed URL — nothing to record.
    }
}

/** Android: the Play install referrer string carries the same utm_* set. */
export function captureAcquisitionFromReferrer(referrer: string): void {
    try {
        store(new URLSearchParams(referrer));
    } catch {
        // Unparseable referrer — nothing to record.
    }
}

/**
 * Call on sign-in. Fire-and-forget; the server only writes to a profile that
 * has no acquisition yet and is younger than the attribution window.
 */
export async function maybeRecordAcquisition(userId: string): Promise<void> {
    try {
        if (localStorage.getItem(attemptKey(userId))) return;
        const a = read();
        if (!a) return;
        const res = await fetch('/api/profile/acquisition', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(a),
        });
        if (!res.ok) return; // transient — retry next sign-in
        localStorage.setItem(attemptKey(userId), '1');
    } catch {
        // Non-fatal: attribution just doesn't happen this session.
    }
}
