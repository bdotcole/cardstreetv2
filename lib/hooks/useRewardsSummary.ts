'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Client state for the Collector Pass rewards system. One shared fetch of
 * /api/rewards/summary per session (deduped, usePremium/useBetaFeatures
 * pattern), refreshed explicitly after claims. Fails closed: any error leaves
 * summary null and the rewards UI hidden — the server gate is the lock.
 */

export interface RewardsQuest {
    slot: number;
    rule: string;
    target: number;
    progress: number;
    claimed: boolean;
}

export interface RewardsJourneyStep {
    key: string;
    xp: number;
    coins: number;
    done: boolean;
}

export interface RewardsOwnedItem {
    id: string;
    key: string;
    meta: Record<string, unknown>;
    expiresAt: string | null;
}

export interface RewardsSummary {
    signedIn: boolean;
    enabled: boolean;
    coins: number;
    xp: number;
    level: number;
    streak: number;
    streakBest: number;
    freezes: number;
    freeRepairUsed: boolean;
    checkinClaimedToday: boolean;
    cycleDay: number;
    quests: RewardsQuest[];
    questBonusClaimed: boolean;
    journey: RewardsJourneyStep[];
    recent: { rule: string; xp: number; coins: number; at: string }[];
    /** Store state (empty until the 20260829 migration is applied). */
    owned: RewardsOwnedItem[];
    badges: string[];
    displayedBadges: string[];
    equippedFrame: string | null;
    equippedChatColor: string | null;
    vouchersEnabled: boolean;
}

let cached: RewardsSummary | null = null;
let inflight: Promise<RewardsSummary | null> | null = null;

async function fetchSummary(): Promise<RewardsSummary | null> {
    try {
        const res = await fetch('/api/rewards/summary', { credentials: 'include' });
        if (!res.ok) return null; // 401/404/503: signed out, no grant, or kill switch
        const data = await res.json();
        if (!data || data.enabled !== true) return null;
        return data as RewardsSummary;
    } catch {
        return null;
    }
}

export function ensureRewardsSummary(): Promise<RewardsSummary | null> {
    if (cached) return Promise.resolve(cached);
    if (!inflight) {
        inflight = fetchSummary().then((s) => {
            cached = s;
            inflight = null;
            return s;
        });
    }
    return inflight;
}

export function invalidateRewardsSummary() {
    cached = null;
    inflight = null;
}

export function useRewardsSummary(active: boolean) {
    const [summary, setSummary] = useState<RewardsSummary | null>(cached);
    const activeRef = useRef(active);
    activeRef.current = active;

    useEffect(() => {
        if (!active) return;
        let alive = true;
        ensureRewardsSummary().then((s) => { if (alive) setSummary(s); });
        return () => { alive = false; };
    }, [active]);

    const refresh = useCallback(async () => {
        invalidateRewardsSummary();
        const s = await ensureRewardsSummary();
        if (activeRef.current) setSummary(s);
        return s;
    }, []);

    return { summary, refresh };
}
