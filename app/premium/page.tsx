'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePremium } from '@/lib/hooks/usePremium';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * CardStreet Pro hub — what Pro includes, upgrade (web/Stripe), and manage.
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

function PremiumPageInner() {
  const { loading, premium, status, refresh } = usePremium();
  const { t } = useTranslation();
  const upgraded = useSearchParams()?.get('upgraded') === '1';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effect (not render-time) so the server render and first client paint
  // agree — the purchase block only appears once usePremium resolves, by
  // which point this has long settled. In the real shells the bridge exists
  // before hydration, so there's no user-visible flip.
  const [isNativeApp, setIsNativeApp] = useState(false);
  useEffect(() => { setIsNativeApp(isNativeShell()); }, []);

  const FEATURES = [
    { href: '/grade', icon: 'fa-wand-magic-sparkles', title: t('pro.graderTitle'), desc: t('pro.graderDesc') },
    { href: '/trade', icon: 'fa-right-left', title: t('pro.tradeTitle'), desc: t('pro.tradeDesc') },
    { href: '/insights', icon: 'fa-chart-line', title: t('pro.insightsTitle'), desc: t('pro.insightsDesc') },
  ];

  // Back from Stripe Checkout: the webhook may land a beat after the redirect,
  // so refresh the cached entitlement now and once more shortly after.
  useEffect(() => {
    if (!upgraded) return;
    refresh();
    const timer = setTimeout(() => refresh(), 4000);
    return () => clearTimeout(timer);
  }, [upgraded, refresh]);

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

  const renewDate = status.premiumUntil
    ? new Date(status.premiumUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <main className="min-h-screen bg-brand-darker text-white px-5 py-10">
      <div className="w-full max-w-[480px] mx-auto">
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
              key={f.href}
              href={premium ? f.href : undefined}
              className={`block glass rounded-3xl border-white/10 p-5 transition-all ${premium ? 'active:scale-[0.98]' : 'opacity-90'}`}
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-brand-cyan/10 flex items-center justify-center flex-shrink-0">
                  <i className={`fa-solid ${f.icon} text-brand-cyan`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-black">{f.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{f.desc}</p>
                </div>
                <i className={`fa-solid ${premium ? 'fa-chevron-right text-brand-cyan' : 'fa-lock text-slate-600'}`}></i>
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
            {!isNativeApp && (
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
          <div className="glass rounded-3xl border-white/10 p-6 text-center">
            <p className="text-sm text-slate-300 font-bold">{t('pro.comingSoonApp')}</p>
          </div>
        ) : (
          <div className="glass rounded-3xl border-brand-cyan/20 p-6 text-center">
            <p className="text-3xl font-black text-white">฿199<span className="text-sm text-slate-500 font-bold"> {t('pro.perMonth')}</span></p>
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
    </main>
  );
}

export default function PremiumPage() {
  return (
    <Suspense fallback={null}>
      <PremiumPageInner />
    </Suspense>
  );
}
