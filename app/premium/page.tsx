'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePremium } from '@/lib/hooks/usePremium';

/**
 * CardStreet Pro hub — what Pro includes, upgrade (web/Stripe), and manage.
 *
 * Store-policy note: inside the native Capacitor shells (CardStreetApp UA
 * marker) the Stripe purchase/manage buttons are HIDDEN and no wording points
 * at an external purchase path — Apple 3.1.1 / Play Billing require digital
 * subscriptions in-app to go through store IAP (the RevenueCat phase). The
 * web/desktop experience gets the full Stripe flow.
 */

const FEATURES = [
  {
    href: '/grade',
    icon: 'fa-wand-magic-sparkles',
    title: 'AI Card Grader',
    desc: 'Snap a few angles, get an estimated grade — centering, corners, edges, surface.',
  },
  {
    href: '/trade',
    icon: 'fa-right-left',
    title: 'Trade Finder',
    desc: 'Share your trade code and get value-balanced swap proposals matched across collections.',
  },
  {
    href: '/insights',
    icon: 'fa-chart-line',
    title: 'Pro Insights',
    desc: 'Portfolio history, cost basis and P/L, top holdings, allocation, weekly movers.',
  },
];

function PremiumPageInner() {
  const { loading, premium, status, refresh } = usePremium();
  const upgraded = useSearchParams()?.get('upgraded') === '1';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNativeApp = useMemo(
    () => typeof navigator !== 'undefined' && navigator.userAgent.includes('CardStreetApp'),
    [],
  );

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
    ? new Date(status.premiumUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <main className="min-h-screen bg-brand-darker text-white px-5 py-10">
      <div className="w-full max-w-[480px] mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-3xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-4">
            <i className="fa-solid fa-crown text-brand-cyan text-2xl"></i>
          </div>
          <h1 className="text-3xl font-black tracking-tight uppercase italic skew-x-[-10deg]">CardStreet Pro</h1>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-2">Serious tools for serious collectors</p>
        </div>

        {upgraded && premium && (
          <div className="flex items-start gap-2 rounded-2xl bg-emerald-400/10 border border-emerald-400/20 p-4 mb-6">
            <i className="fa-solid fa-circle-check text-emerald-400 mt-0.5"></i>
            <p className="text-sm text-emerald-100 leading-snug font-bold">Welcome to Pro! Everything below is unlocked.</p>
          </div>
        )}
        {upgraded && !premium && !loading && (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-400/10 border border-amber-400/20 p-4 mb-6">
            <i className="fa-solid fa-circle-notch animate-spin text-amber-400 mt-0.5"></i>
            <p className="text-[12px] text-amber-100 leading-snug">Payment received — activating your subscription. This takes a few seconds; pull to refresh if it doesn't flip.</p>
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
              <i className="fa-solid fa-circle-check mr-1.5"></i>You're Pro
            </p>
            {renewDate && <p className="text-xs text-slate-400 mt-2">Active through {renewDate}</p>}
            {!isNativeApp && (
              <button
                onClick={openPortal}
                disabled={busy}
                className="mt-5 w-full h-12 rounded-2xl glass border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
              >
                {busy ? <i className="fa-solid fa-circle-notch animate-spin"></i> : 'Manage Subscription'}
              </button>
            )}
          </div>
        ) : isNativeApp ? (
          <div className="glass rounded-3xl border-white/10 p-6 text-center">
            <p className="text-sm text-slate-300 font-bold">CardStreet Pro is coming to the app soon.</p>
          </div>
        ) : (
          <div className="glass rounded-3xl border-brand-cyan/20 p-6 text-center">
            <p className="text-3xl font-black text-white">฿199<span className="text-sm text-slate-500 font-bold"> / month</span></p>
            <p className="text-[11px] text-slate-500 mt-1">Cancel anytime</p>
            <button
              onClick={startCheckout}
              disabled={busy}
              className="mt-5 w-full h-14 rounded-2xl bg-brand-cyan text-brand-darker font-black text-[11px] uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {busy ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <><i className="fa-solid fa-crown"></i> Upgrade to Pro</>}
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
