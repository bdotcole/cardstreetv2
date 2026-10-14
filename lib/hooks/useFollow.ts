'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFollowSummary, setFollowing, type FollowSummary } from '@/lib/follows';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface UseFollowOptions {
    sellerName: string;
    /** Signed-in viewer, or null. A change re-reads isFollowing (sign-in on this page). */
    viewerId: string | null;
    /** Called instead of following when there is no session; opens the sign-in wall. */
    onRequireAuth: () => void;
}

/**
 * Follow state for one shop: the counts shown on its page and an optimistic
 * toggle. Both states stay tappable and every tap ends in a toast, so
 * "Following" never reads as a dead label.
 */
export function useFollow(sellerId: string | null | undefined, { sellerName, viewerId, onRequireAuth }: UseFollowOptions) {
    const [summary, setSummary] = useState<FollowSummary | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    // Bumped to re-read the counts, e.g. after unfollowing from a list.
    const [reloadKey, setReloadKey] = useState(0);
    const { showToast } = useToast();
    const { t } = useTranslation();

    useEffect(() => {
        if (!sellerId) return;
        const controller = new AbortController();
        void fetchFollowSummary(sellerId, controller.signal).then((found) => {
            if (!controller.signal.aborted) setSummary(found);
        });
        return () => controller.abort();
    }, [sellerId, viewerId, reloadKey]);

    const toggle = useCallback(async () => {
        if (!sellerId || busyRef.current) return;
        if (!viewerId) {
            onRequireAuth();
            return;
        }
        if (summary && !summary.available) {
            showToast(t('seller.followUnavailable'), 'info');
            return;
        }

        const before = summary;
        const next = !before?.isFollowing;
        setSummary({
            available: true,
            following: before?.following ?? 0,
            followers: Math.max(0, (before?.followers ?? 0) + (next ? 1 : -1)),
            isFollowing: next,
        });
        busyRef.current = true;
        setBusy(true);
        const result = await setFollowing(sellerId, next);
        busyRef.current = false;
        setBusy(false);

        if (!result.ok) {
            setSummary(before);
            if (result.code === 'UNAUTHORIZED') onRequireAuth();
            else showToast(t(result.code === 'NOT_AVAILABLE' ? 'seller.followUnavailable' : 'seller.followFailed'), 'error');
            return;
        }
        setSummary((prev) => ({
            available: true,
            following: prev?.following ?? 0,
            followers: result.followers ?? prev?.followers ?? 0,
            isFollowing: result.isFollowing,
        }));
        showToast(t(next ? 'seller.followedToast' : 'seller.unfollowedToast').replace('{name}', sellerName), 'success');
    }, [sellerId, viewerId, summary, sellerName, onRequireAuth, showToast, t]);

    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    return {
        isFollowing: !!summary?.isFollowing,
        /** Null until known, or before the migration: callers hide the count. */
        followers: summary?.available ? summary.followers : null,
        /** How many shops this profile follows; shown on your own shop page. */
        following: summary?.available ? summary.following : null,
        busy,
        toggle,
        reload,
    };
}
