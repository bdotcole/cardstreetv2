'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { EARN, FIRST_AWARD_BY_KEY } from '@/lib/rewardTiers';

/**
 * Invite-a-friend card for the rewards hub.
 *
 * The referral link, the attribution endpoint and BOTH payouts already existed
 * and were already being paid — they were simply unreachable, because
 * /api/referrals/me returned 403 to anyone without partner_joined_at. Nothing
 * here invents a reward: the numbers shown are read from lib/rewardTiers.ts so
 * the card can never advertise an amount the ledger does not actually grant.
 *
 * Fails quiet. A user whose slug can't be minted (offline, migration not run)
 * sees nothing rather than a broken share sheet — this sits inside the hub's
 * overview tab, and a dead card there is worse than an absent one.
 */

interface ReferralMe {
    slug: string;
    link: string;
    signups: number;
    totalDownloads: number;
}

/**
 * Session cache. This card lives inside the hub's Overview tab, so it unmounts
 * and remounts every time the user switches tabs — and /api/referrals/me runs
 * four COUNT queries per call. Cached and deduped like lib/hooks/usePremium.ts.
 */
let cached: ReferralMe | null = null;
let inflight: Promise<ReferralMe | null> | null = null;

function loadReferral(): Promise<ReferralMe | null> {
    if (cached) return Promise.resolve(cached);
    if (!inflight) {
        inflight = fetch('/api/referrals/me')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                inflight = null;
                if (d?.link) cached = d as ReferralMe;
                return cached;
            })
            .catch(() => {
                inflight = null;
                return null;
            });
    }
    return inflight;
}

export default function InviteCard() {
    const { t, isThai } = useTranslation();
    const [data, setData] = useState<ReferralMe | null>(cached);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let active = true;
        loadReferral().then((d) => { if (active && d) setData(d); });
        return () => { active = false; };
    }, []);

    if (!data) return null;

    const share = async () => {
        // Native share sheet where it exists (this is a phone-first surface and
        // the whole point is getting the link into LINE); clipboard otherwise.
        try {
            if (typeof navigator !== 'undefined' && navigator.share) {
                await navigator.share({ url: data.link, title: 'CardStreet' });
                return;
            }
        } catch {
            // User dismissed the sheet, or share is blocked — fall through to copy.
        }
        try {
            await navigator.clipboard.writeText(data.link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard denied — the link is on screen and selectable.
        }
    };

    const signupXp = EARN.REFERRAL_SIGNUP.xp;
    const convertedCoins = EARN.REFERRAL_CONVERTED.coins;
    const firstBonus = FIRST_AWARD_BY_KEY['first_referral'];

    return (
        <div>
            <h4 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 px-1">
                {t('rewards.inviteTitle')}
            </h4>
            <div className="glass rounded-2xl border border-white/5 p-4 space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                    {isThai
                        ? `ชวนเพื่อนมาใช้ CardStreet รับ ${signupXp} XP เมื่อเพื่อนสมัคร และอีก ${convertedCoins} เหรียญเมื่อเพื่อนซื้อขายสำเร็จครั้งแรก`
                        : `Invite a friend: ${signupXp} XP when they sign up, plus ${convertedCoins} coins once their first order settles.`}
                </p>
                {firstBonus && (
                    <p className="text-[11px] text-amber-300/90 font-bold">
                        {isThai
                            ? `ครั้งแรกรับโบนัสเพิ่ม +${firstBonus.xp} XP และ +${firstBonus.coins} เหรียญ`
                            : `First referral ever pays a one-off +${firstBonus.xp} XP and +${firstBonus.coins} coins.`}
                    </p>
                )}

                <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded-xl bg-black/30 border border-white/5 px-3 py-2 text-[11px] text-slate-300">
                        {data.link}
                    </code>
                    <button
                        onClick={share}
                        className="shrink-0 px-3 py-2 rounded-xl bg-brand-cyan text-brand-darker text-[11px] font-black active:scale-95 transition-transform"
                    >
                        {copied ? t('rewards.inviteCopied') : t('rewards.inviteShare')}
                    </button>
                </div>

                {data.signups > 0 && (
                    <p className="text-[11px] text-slate-500 font-bold tabular-nums">
                        {isThai ? `เพื่อนที่สมัครแล้ว ${data.signups} คน` : `${data.signups} friend${data.signups === 1 ? '' : 's'} joined so far`}
                    </p>
                )}
            </div>
        </div>
    );
}
