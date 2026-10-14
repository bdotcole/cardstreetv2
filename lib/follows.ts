// Client helpers for following shops (20261014_seller_follows.sql), shared by
// the mobile seller page, the desktop seller page and Profile's Following /
// Followers lists. Every call goes through /api/follows so validation (no
// self-follow, the shop must exist) lives in one place. All of them fail soft:
// a network error or a pre-migration database reads as "nothing to show".

export interface FollowSummary {
    /** False until the migration has run; callers hide the counts. */
    available: boolean;
    followers: number;
    following: number;
    /** Whether the signed-in viewer follows this profile. False when signed out. */
    isFollowing: boolean;
}

export interface FollowListEntry {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    /** Active listings, for the Following list ("12 listings"). Null when not counted. */
    listing_count: number | null;
    followed_at: string;
}

export type FollowListKind = 'following' | 'followers';

export async function fetchFollowSummary(userId: string, signal?: AbortSignal): Promise<FollowSummary | null> {
    try {
        const res = await fetch(`/api/follows?user_id=${encodeURIComponent(userId)}`, {
            credentials: 'include',
            cache: 'no-store',
            signal,
        });
        if (!res.ok) return null;
        return (await res.json()) as FollowSummary;
    } catch {
        return null;
    }
}

export type SetFollowResult =
    | { ok: true; isFollowing: boolean; followers: number | null }
    | { ok: false; code: 'UNAUTHORIZED' | 'NOT_AVAILABLE' | 'FAILED' };

export async function setFollowing(sellerId: string, follow: boolean): Promise<SetFollowResult> {
    try {
        const res = await fetch(
            follow ? '/api/follows' : `/api/follows?seller_id=${encodeURIComponent(sellerId)}`,
            {
                method: follow ? 'POST' : 'DELETE',
                credentials: 'include',
                headers: follow ? { 'Content-Type': 'application/json' } : undefined,
                body: follow ? JSON.stringify({ seller_id: sellerId }) : undefined,
            },
        );
        if (res.status === 401) return { ok: false, code: 'UNAUTHORIZED' };
        if (res.status === 503) return { ok: false, code: 'NOT_AVAILABLE' };
        if (!res.ok) return { ok: false, code: 'FAILED' };
        const data = await res.json();
        return { ok: true, isFollowing: !!data.isFollowing, followers: typeof data.followers === 'number' ? data.followers : null };
    } catch {
        return { ok: false, code: 'FAILED' };
    }
}

export async function fetchFollowList(kind: FollowListKind): Promise<{ available: boolean; users: FollowListEntry[] } | null> {
    try {
        const res = await fetch(`/api/follows/list?kind=${kind}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return null;
        return (await res.json()) as { available: boolean; users: FollowListEntry[] };
    } catch {
        return null;
    }
}
