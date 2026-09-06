'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePremium } from '@/lib/hooks/usePremium';
import { useTranslation } from '@/lib/hooks/useTranslation';
import {
  loadNativeProOffer,
  purchaseNativePro,
  restoreNativePro,
  storeSubscriptionsUrl,
  type NativeProOffer,
} from '@/lib/revenuecat';

/**
 * CardStreet Pro hub — what Pro includes, upgrade (web/Stripe), and manage.
 * Rendered standalone by the mobile route (app/premium) and inside the desktop
 * shell (app/desktop/premium); `variant` controls the outer chrome only.
 *
 * Store-policy note: inside the native Capacitor shells the Stripe
 * purchase/manage buttons are HIDDEN and no wording points at an external
 * purchase path — Apple 3.1.1 / Play Billing require digital subscriptions
 * in-app to go through store IAP (the RevenueCat phase). Native detection is
 * belt-and-suspenders: the CardStreetApp UA marker (Android ships it; iOS
 * gets it in 1.0.4) OR the Capacitor bridge object, which is injected into
 * remote-loaded pages on both shells regardless of user agent — this catches
 * the live iOS build that predates the marker.
 */

function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  if (navigator.userAgent.includes('CardStreetApp')) return true;
  const cap = (window as any).Capacitor;
  return !!cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : true);
}

export default function PremiumHub({ variant = 'mobile' }: { variant?: 'mobile' | 'desktop' }) {
  const { loading, premium, status, refresh } = usePremium();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const upgraded = searchParams?.get('upgraded') === '1';
  const sessionId = searchParams?.get('session_id') ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effect (not render-time) so the server render and first client paint
  // agree — the purchase block only appears once usePremium resolves, by
  // which point this has long settled. In the real shells the bridge exists
  // before hydration, so there's no user-visible flip.
  const [isNativeApp, setIsNativeApp] = useState(false);
  useEffect(() => { setIsNativeApp(isNativeShell()); }, []);

  // Native IAP (RevenueCat). Null offer = plugin/store not available (old
  // binary, product not yet approved, logged out) -> coming-soon card.
  const [iapOffer, setIapOffer] = useState<NativeProOffer | null>(null);
  useEffect(() => {
    if (!isNativeApp || premium || loading) return;
    let active = true;
    loadNativeProOffer().then((o) => { if (active) setIapOffer(o); });
    return () => { active = false; };
  }, [isNativeApp, premium, loading]);

  // Perks without an href are passive benefits (applied automatically), not
  // destinations — they render with a check instead of a chevron.
  const FEATURES: { href?: string; icon: string; title: string; desc: string }[] = [
    { href: '/grade', icon: 'fa-wand-magic-sparkles', title: t('pro.graderTitle'), desc: t('pro.graderDesc') },
    { href: '/insights', icon: 'fa-chart-line', title: t('pro.insightsTitle'), desc: t('pro.insightsDesc') },
    { icon: 'fa-tags', title: t('pro.sellerRateTitle'), desc: t('pro.sellerRateDesc') },
  ];

  // Freed on 2026-09-05 (lib/entitlements.ts FEATURE_TIERS). They stay on this
  // page — it is the only place either is linked from — but they must not sit
  // in the list above, which is the pitch for a paid plan: advertising two
  // features every account already has is the sort of thing a subscriber
  // notices and asks for a refund over.
  const FREE_FEATURES: { href?: string; icon: string; title: string; desc: string }[] = [
    { href: '/trade', icon: 'fa-right-left', title: t('pro.tradeTitle'), desc: t('pro.tradeDesc') },
    { icon: 'fa-bell', title: t('pro.alertsTitle'), desc: t('pro.alertsDesc') },
  ];

  // Back from Stripe Checkout. Claim the entitlement from the session before
  // reading status: the webhook may land a beat after the redirect, or -- if
  // its destination is misconfigured -- never at all, which would strand a
  // paying subscriber on the activating spinner. /api/premium/finalize is
  // idempotent, so racing the webhook is harmless. The delayed second refresh
  // stays for the case where the webhook wins.
  useEffect(() => {
    if (!upgraded) return;
    let active = true;
    (async () => {
      if (sessionId) {
        try {
          await fetch('/api/premium/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
        } catch {
          // Fall through -- the refreshes below still pick up a webhook write.
        }
      }
      if (active) refresh();
    })();
    const timer = setTimeout(() => { if (active) refresh(); }, 4000);
    return () => { active = false; clearTimeout(timer); };
  }, [upgraded, sessionId, refresh]);

  const startCheckout = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/premium/checkout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/premium/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not open billing portal');
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const buyNative = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await purchaseNativePro();
      if (result === 'purchased') {
        // The store confirms instantly; the entitlement lands via the
        // RevenueCat webhook a beat later. Poll briefly so the page flips
        // without a manual refresh.
        for (let i = 0; i < 6; i++) {
          const s = await refresh();
          if (s.premium) break;
          await new Promise((res) => setTimeout(res, 2000));
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const restoreNative = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await restoreNativePro()) await refresh();
      else setError(t('pro.nothingToRestore'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const renewDate = status.premiumUntil
    ? new Date(status.premiumUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const Wrapper = variant === 'desktop' ? 'div' : 'main';

  return (
    <Wrapper className={variant === 'desktop' ? 'text-white py-6' : 'min-h-screen bg-brand-darker text-white px-5 pb-10 pt-[calc(var(--sat)+2.5rem)]'}>
      <div className="w-full max-w-[480px] mx-auto">
        {/* Mobile only: Pro lives outside the tab shell, so back returns to
            the Profile tab it is reached from. The desktop shell has its own
            persistent nav. */}
        {variant === 'mobile' && (
          <Link
            href="/?tab=profile"
            aria-label="Back"
            className="inline-flex w-10 h-10 rounded-xl glass border-white/10 items-center justify-center active:scale-90 transition-all mb-6"
          >
            <i className="fa-solid fa-chevron-left text-slate-400 text-sm"></i>
          </Link>
        )}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-3xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-4">
            <i className="fa-solid fa-crown text-brand-cyan text-2xl"></i>
          </div>
          <h1 className="text-3xl font-black tracking-tight uppercase italic skew-x-[-10deg]">{t('pro.title')}</h1>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-2">{t('pro.tagline')}</p>
        </div>

        {upgraded && premium && (
          <div className="flex items-start gap-2 rounded-2xl bg-emerald-400/10 border border-emerald-400/20 p-4 mb-6">
            <i className="fa-solid fa-circle-check text-emerald-400 mt-0.5"></i>
            <p className="text-sm text-emerald-100 leading-snug font-bold">{t('pro.welcome')}</p>
          </div>
        )}
        {upgraded && !premium && !loading && (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-400/10 border border-amber-400/20 p-4 mb-6">
            <i className="fa-solid fa-circle-notch animate-spin text-amber-400 mt-0.5"></i>
            <p className="text-[12px] text-amber-100 leading-snug">{t('pro.activating')}</p>
          </div>
        )}

        <div className="space-y-3 mb-8">
          {FEATURES.map((f) => (
            <a
              key={f.title}
              href={premium && f.href ? f.href : undefined}
              className={`block glass rounded-3xl border-white/10 p-5 transition-all ${premium && f.href ? 'active:scale-[0.98]' : 'opacity-90'}`}
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-brand-cyan/10 flex items-center justify-center flex-shrink-0">
                  <i className={`fa-solid ${f.icon} text-brand-cyan`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-black">{f.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{f.desc}</p>
                </div>
                <i className={`fa-solid ${!premium ? 'fa-lock text-slate-600' : f.href ? 'fa-chevron-right text-brand-cyan' : 'fa-circle-check text-emerald-400'}`}></i>
              </div>
            </a>
          ))}

          {/* Included free. Never locked and always tappable, regardless of
              plan — this is the only route into the Trade Finder in the app. */}
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/80 pt-3 px-1">
            {t('pro.freeForEveryone')}
          </p>
          {FREE_FEATURES.map((f) => (
            <a
              key={f.title}
              href={f.href}
              className={`block glass rounded-3xl border-white/10 p-5 transition-all ${f.href ? 'active:scale-[0.98]' : ''}`}
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-400/10 flex items-center justify-center flex-shrink-0">
                  <i className={`fa-solid ${f.icon} text-emerald-400`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-black">{f.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{f.desc}</p>
                </div>
                <i className={`fa-solid ${f.href ? 'fa-chevron-right text-emerald-400' : 'fa-circle-check text-emerald-400'}`}></i>
              </div>
            </a>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl bg-rose-500/10 border border-rose-500/20 p-3 mb-4">
            <i className="fa-solid fa-triangle-exclamation text-rose-400 text-xs mt-0.5"></i>
            <p className="text-[11px] text-rose-200/90 leading-snug">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="text-center py-4"><i className="fa-solid fa-circle-notch animate-spin text-brand-cyan"></i></div>
        ) : premium ? (
          <div className="glass rounded-3xl border-white/10 p-6 text-center">
            <p className="text-[11px] text-emerald-400 font-black uppercase tracking-widest">
              <i className="fa-solid fa-circle-check mr-1.5"></i>{t('pro.youArePro')}
            </p>
            {renewDate && <p className="text-xs text-slate-400 mt-2">{t('pro.activeThrough')} {renewDate}</p>}
            {/* Role-granted Pro (admins) has no subscription to manage. In the
                native shells, manage points at the store's own subscription
                page (store policy: never a web billing portal in-app). */}
            {isNativeApp && status.premiumUntil && (
              <a
                href={storeSubscriptionsUrl()}
                target="_blank"
                rel="noreferrer"
                className="mt-5 w-full h-12 rounded-2xl glass border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center"
              >
                {t('pro.manage')}
              </a>
            )}
            {!isNativeApp && status.premiumUntil && (
              <button
                onClick={openPortal}
                disabled={busy}
                className="mt-5 w-full h-12 rounded-2xl glass border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
              >
                {busy ? <i className="fa-solid fa-circle-notch animate-spin"></i> : t('pro.manage')}
              </button>
            )}
          </div>
        ) : isNativeApp ? (
          iapOffer ? (
            <div className="glass rounded-3xl border-brand-cyan/20 p-6 text-center">
              <p className="text-3xl font-black text-white">{iapOffer.priceString}<span className="text-sm text-slate-500 font-bold"> {t('pro.perMonth')}</span></p>
              <p className="text-[11px] text-slate-500 mt-1">{t('pro.cancelAnytime')}</p>
              <button
                onClick={buyNative}
                disabled={busy}
                className="mt-5 w-full h-14 rounded-2xl bg-brand-cyan text-brand-darker font-black text-[11px] uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {busy ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <><i className="fa-solid fa-crown"></i> {t('pro.upgrade')}</>}
              </button>
              <button
                onClick={restoreNative}
                disabled={busy}
                className="mt-4 text-[10px] text-slate-500 font-black uppercase tracking-widest disabled:opacity-40"
              >
                {t('pro.restore')}
              </button>
            </div>
          ) : (
            <div className="glass rounded-3xl border-white/10 p-6 text-center">
              <p className="text-sm text-slate-300 font-bold">{t('pro.comingSoonApp')}</p>
            </div>
          )
        ) : (
          <div className="glass rounded-3xl border-brand-cyan/20 p-6 text-center">
            <p className="text-3xl font-black text-white">฿149<span className="text-sm text-slate-500 font-bold"> {t('pro.perMonth')}</span></p>
            <p className="text-[11px] text-slate-500 mt-1">{t('pro.cancelAnytime')}</p>
            <button
              onClick={startCheckout}
              disabled={busy}
              className="mt-5 w-full h-14 rounded-2xl bg-brand-cyan text-brand-darker font-black text-[11px] uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {busy ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <><i className="fa-solid fa-crown"></i> {t('pro.upgrade')}</>}
            </button>
          </div>
        )}
      </div>
    </Wrapper>
  );
}
