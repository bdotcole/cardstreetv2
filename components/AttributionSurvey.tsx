'use client';

/**
 * One-tap "How did you hear about us?" card.
 *
 * The cookie-based capture (components/AttributionCapture.tsx) answers this for
 * most signups, but not all: measured 2026-09-05, ~2% of new accounts still
 * reach /api/auth/callback with no cs_attribution cookie, and no cookie
 * hardening recovers a cookie the browser refused to store. It is also
 * structurally blind to the two channels that matter most in this market — a
 * friend telling someone, and the physical card shops — because neither leaves
 * a referrer. Asking is the only instrument that reaches those.
 *
 * One tap, no submit button, no modal, and it disappears for good on either an
 * answer or a dismiss. This is an analytics nicety; it does not get to be an
 * obstacle. The server decides who sees it (account under 90 days old with an
 * unresolved source), so nothing here needs to know the rules.
 *
 * Renders nothing until the server says the question is needed.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import type { SurveySource } from '@/lib/attribution';

const DISMISS_KEY = 'cs_attribution_survey_dismissed';

// Typed against SurveySource so a label added here without a matching value in
// lib/attribution.ts fails the build rather than silently 400-ing on tap.
// Order is deliberate: the two channels the cookie can never see first, then
// the ones being spent on, then the escape hatch.
const OPTIONS: { value: SurveySource; en: string; th: string; icon: string }[] = [
    { value: 'friend', en: 'A friend', th: 'เพื่อนแนะนำ', icon: 'fa-solid fa-user-group' },
    { value: 'facebook', en: 'Facebook', th: 'เฟซบุ๊ก', icon: 'fa-brands fa-facebook' },
    { value: 'tiktok', en: 'TikTok', th: 'ติ๊กต็อก', icon: 'fa-brands fa-tiktok' },
    { value: 'google', en: 'Google', th: 'กูเกิล', icon: 'fa-brands fa-google' },
    { value: 'youtube', en: 'YouTube', th: 'ยูทูบ', icon: 'fa-brands fa-youtube' },
    { value: 'instagram', en: 'Instagram', th: 'อินสตาแกรม', icon: 'fa-brands fa-instagram' },
    { value: 'shop', en: 'A card shop', th: 'ร้านการ์ด', icon: 'fa-solid fa-store' },
    { value: 'chatgpt', en: 'ChatGPT / AI', th: 'ChatGPT / AI', icon: 'fa-solid fa-robot' },
    { value: 'other', en: 'Somewhere else', th: 'ที่อื่น', icon: 'fa-solid fa-ellipsis' },
];

export default function AttributionSurvey() {
    const { isThai } = useTranslation();
    const [visible, setVisible] = useState(false);
    const [answered, setAnswered] = useState(false);

    useEffect(() => {
        let active = true;
        try {
            if (localStorage.getItem(DISMISS_KEY) === '1') return;
        } catch { /* storage blocked — the server check still gates it */ }
        fetch('/api/attribution/survey')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (active && d?.needed) setVisible(true); })
            .catch(() => { /* stay hidden */ });
        return () => { active = false; };
    }, []);

    if (!visible) return null;

    const close = () => {
        setVisible(false);
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* server gate still holds */ }
    };

    const answer = (source: SurveySource) => {
        // Optimistic: the thank-you shows immediately and the card closes on a
        // timer whether or not the write lands. A failed analytics write is not
        // worth an error state in front of the user.
        setAnswered(true);
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* server gate still holds */ }
        fetch('/api/attribution/survey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source }),
            keepalive: true,
        }).catch(() => {});
        setTimeout(() => setVisible(false), 1400);
    };

    return (
        <div className="glass rounded-2xl border border-white/10 p-4">
            {answered ? (
                <p className="text-sm text-brand-cyan font-bold text-center py-2">
                    {isThai ? 'ขอบคุณมากครับ' : 'Thanks — that really helps.'}
                </p>
            ) : (
                <>
                    <div className="flex items-start gap-3">
                        <p className="flex-1 text-xs font-bold text-white leading-relaxed">
                            {isThai ? 'คุณรู้จัก CardStreet จากที่ไหน' : 'How did you hear about CardStreet?'}
                        </p>
                        <button
                            onClick={close}
                            aria-label={isThai ? 'ปิด' : 'Dismiss'}
                            className="shrink-0 w-6 h-6 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            <i className="fa-solid fa-xmark text-xs"></i>
                        </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {OPTIONS.map((o) => (
                            <button
                                key={o.value}
                                onClick={() => answer(o.value)}
                                className="px-3 py-1.5 rounded-full text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 active:scale-95 transition-all"
                            >
                                <i className={`${o.icon} mr-1.5 text-[10px] text-slate-500`}></i>
                                {isThai ? o.th : o.en}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
