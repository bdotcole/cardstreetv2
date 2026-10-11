'use client';

import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { sendGAEvent } from '@next/third-parties/google';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { IOS_APP_STORE_URL, PLAY_STORE_URL, sanitizeCampaign } from '@/lib/appLinks';

/**
 * "Get the app" popup for phone visitors who arrived from a social link.
 *
 * The bio links (cardstreet.app/ig, /fb, /yt, /tt) land on the web homepage
 * so every tap is tracked and works everywhere; this sheet then offers the
 * native app with the store picked by device. The device is read from the
 * user agent here, in the browser, rather than at the redirect: the short
 * link keeps the web funnel and GA4 attribution, and the prompt layers the
 * install push on top.
 *
 * Shown when ALL of these hold:
 *   - not inside the Capacitor shell (the app has no need of itself);
 *   - the device is an iPhone/iPad or an Android phone — a tablet-sized
 *     Android browser still counts, a desktop never does;
 *   - the visit carries a social utm_source (what the short links set), so
 *     ordinary web users are not nagged;
 *   - not snoozed: "Continue on the web" and a store tap both hide it for
 *     SNOOZE_DAYS on this device.
 *
 * Android's in-app browsers (Instagram, Facebook, TikTok) are WebViews whose
 * user agent carries "; wv" — exactly the traffic this is for — so the
 * "already in our app" test is Capacitor.isNativePlatform(), never the
 * WebView marker lib/appLinks.ts uses for the QR redirects.
 *
 * Store links carry the platform as an install-attribution tag (Play
 * install referrer, App Store ?ct=) so installs show up by source in Play
 * Console / App Store Connect.
 */

const SNOOZE_KEY = 'cs_get_app_snoozed_until';
const SNOOZE_DAYS = 7;
const SHOW_DELAY_MS = 1500;
const SOCIAL_SOURCES = new Set(['instagram', 'ig', 'facebook', 'fb', 'youtube', 'tiktok', 'social']);

type Store = { kind: 'ios' | 'android'; url: string; source: string };

function pickStore(): Store | null {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    if (!isIOS && !isAndroid) return null;

    const params = new URLSearchParams(window.location.search);
    const source = (params.get('utm_source') || '').toLowerCase();
    if (!SOCIAL_SOURCES.has(source)) return null;
    const medium = sanitizeCampaign(params.get('utm_medium')) || 'link';
    const campaign = sanitizeCampaign(`${source}_${medium}`);

    if (isIOS) return { kind: 'ios', url: `${IOS_APP_STORE_URL}?ct=${encodeURIComponent(campaign)}`, source };
    const referrer = `utm_source=${source}&utm_medium=${medium}&utm_campaign=get_app_prompt`;
    return { kind: 'android', url: `${PLAY_STORE_URL}&referrer=${encodeURIComponent(referrer)}`, source };
}

function snoozed(): boolean {
    try {
        const until = Number(window.localStorage.getItem(SNOOZE_KEY) || 0);
        return until > Date.now();
    } catch {
        return false;
    }
}

function snooze() {
    try {
        window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
        // Private mode: the prompt may show again next visit, which is acceptable.
    }
}

function track(action: 'shown' | 'store' | 'dismiss', store: Store) {
    try {
        sendGAEvent('event', 'get_app_prompt', { action, store: store.kind, source: store.source });
    } catch {
        // Analytics never blocks the prompt.
    }
}

export default function GetAppPrompt() {
    const { t } = useTranslation();
    const [store, setStore] = useState<Store | null>(null);

    useEffect(() => {
        if (Capacitor.isNativePlatform() || snoozed()) return;
        const candidate = pickStore();
        if (!candidate) return;
        // Let the page paint first; a modal before content reads as a wall.
        const timer = window.setTimeout(() => {
            setStore(candidate);
            track('shown', candidate);
        }, SHOW_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, []);

    if (!store) return null;

    const dismiss = () => {
        track('dismiss', store);
        snooze();
        setStore(null);
    };
    const openStore = () => {
        track('store', store);
        snooze();
        setStore(null);
    };

    return (
        // Above the tab bar and the auth modal, below nothing that matters at landing.
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn" role="dialog" aria-modal="true" aria-labelledby="get-app-title">
            <div className="bg-slate-900 w-full max-w-sm rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl">
                <div className="p-7 text-center">
                    <img src="/logo.png" alt="" className="mx-auto mb-5 w-16 h-16 rounded-2xl shadow-lg" />
                    <h3 id="get-app-title" className="text-white text-lg font-black mb-2">
                        {t('getApp.title')}
                    </h3>
                    <p className="text-sm text-slate-400 leading-relaxed mb-6">
                        {t('getApp.body')}
                    </p>
                    <a
                        href={store.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={openStore}
                        className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-brand-cyan text-brand-darker font-black uppercase tracking-[0.15em] text-xs hover:bg-white transition-all active:scale-95"
                    >
                        <i className={`fa-brands ${store.kind === 'ios' ? 'fa-apple' : 'fa-google-play'} text-base`} aria-hidden="true"></i>
                        {t(store.kind === 'ios' ? 'getApp.appStore' : 'getApp.playStore')}
                    </a>
                    <button
                        type="button"
                        onClick={dismiss}
                        className="mt-3 w-full h-11 rounded-xl text-slate-400 font-bold text-xs uppercase tracking-[0.15em] hover:text-white transition-colors"
                    >
                        {t('getApp.continueWeb')}
                    </button>
                </div>
            </div>
        </div>
    );
}
