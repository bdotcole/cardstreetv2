'use client';

import React, { useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import { trackBreakerEvent } from '@/lib/breakerEvents';
import { getBreakerCopy } from './content';
import LiveMockup from './LiveMockup';
import BreakerApplicationForm, { type BreakerFormPrefill } from './BreakerApplicationForm';

/**
 * Public landing page for the Cardstreet Live breaker program.
 *
 * Body language follows the cs_lang cookie via useTranslation — the same rule
 * the game landing pages use — while the page's canonical/hreflang follow the
 * URL variant (see page.tsx). `prefix` is the URL-derived locale prefix
 * (lib/i18nRouting localePrefix): it keeps every internal link inside the tree
 * the visitor and the crawler are already in, and must not drive the copy.
 */

function scrollToId(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

export default function BecomeABreakerContent({
    prefix,
    prefill,
}: {
    prefix: '' | '/en';
    prefill: BreakerFormPrefill;
}) {
    const { isThai } = useTranslation();
    const { updateLanguage } = useUserSettings();
    const copy = getBreakerCopy(isThai);

    const handleApplyClick = useCallback(
        (source: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            trackBreakerEvent('breaker_apply_click', { source });
            scrollToId('apply');
        },
        [],
    );

    const handleHowItWorks = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        scrollToId('how-it-works');
    }, []);

    // Uses the site's existing locale-in-URL scheme (Thai = bare path, English
    // = /en) plus the global language setting, so the choice sticks sitewide
    // rather than being a toggle that only exists on this page.
    const switchLanguage = useCallback(async () => {
        const next = isThai ? 'EN' : 'TH';
        await updateLanguage(next);
        window.location.assign(next === 'EN' ? '/en/become-a-breaker' : '/become-a-breaker');
    }, [isThai, updateLanguage]);

    return (
        <main className="min-h-screen bg-brand-darker pb-24 text-white">
            {/* ── Top bar ── */}
            <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 pb-2 pt-[calc(var(--sat)+1.25rem)]">
                <Link
                    href={prefix || '/'}
                    className="glass inline-flex h-10 items-center gap-2 rounded-xl border-white/10 px-3 text-xs font-bold text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
                >
                    <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true" />
                    <span className="hidden sm:inline">{copy.backToHome}</span>
                    <span className="sr-only sm:hidden">{copy.backToHome}</span>
                </Link>
                <button
                    type="button"
                    onClick={() => void switchLanguage()}
                    className="glass ml-auto inline-flex h-10 items-center rounded-xl border-white/10 px-3.5 text-xs font-black text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
                    lang={isThai ? 'en' : 'th'}
                >
                    {copy.langToggleLabel}
                </button>
            </div>

            {/* ── Hero ── */}
            <header className="relative overflow-hidden">
                {/* Restrained brand wash — one soft radial, no stacked gradients. */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 -top-24 h-80 opacity-40 blur-3xl"
                    style={{
                        background:
                            'radial-gradient(45rem 20rem at 50% 0%, rgba(6,182,212,0.35), transparent 70%)',
                    }}
                />
                <div className="relative mx-auto grid w-full max-w-5xl gap-10 px-5 pb-14 pt-8 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-12 lg:pb-20 lg:pt-14">
                    <div>
                        {/* The light theme darkens brand-cyan only one step
                            (#0891b2), which lands at ~3:1 on its own 10% tint —
                            below AA for text this size. One step darker in that
                            theme only; dark mode already clears 6.5:1. */}
                        <p className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-brand-cyan [.theme-light_&]:text-cyan-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan" aria-hidden="true" />
                            {copy.eyebrow}
                        </p>
                        <h1 className="mt-5 text-[2rem] font-black leading-[1.08] tracking-tight text-white sm:text-5xl">
                            {copy.headline}
                        </h1>
                        <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
                            {copy.subhead}
                        </p>

                        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                            <a
                                href="#apply"
                                onClick={handleApplyClick('hero')}
                                className="flex min-h-14 items-center justify-center rounded-2xl bg-gradient-to-r from-brand-cyan to-brand-green px-8 text-sm font-black uppercase tracking-widest text-brand-darker transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-brand-darker active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
                            >
                                {copy.ctaApply}
                            </a>
                            <a
                                href="#how-it-works"
                                onClick={handleHowItWorks}
                                className="flex min-h-14 items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-8 text-sm font-black uppercase tracking-widest text-white transition-colors hover:border-white/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
                            >
                                {copy.ctaHowItWorks}
                            </a>
                        </div>

                        <ul className="mt-8 grid gap-2.5 sm:grid-cols-3">
                            {copy.trustPoints.map((point) => (
                                <li key={point} className="flex items-start gap-2.5 text-xs font-bold text-slate-300">
                                    <i
                                        className="fa-solid fa-circle-check mt-0.5 shrink-0 text-brand-green"
                                        aria-hidden="true"
                                    />
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <LiveMockup copy={copy} />
                </div>
            </header>

            {/* ── Why break on Cardstreet? ── */}
            <section className="mx-auto w-full max-w-5xl px-5 py-12 lg:py-16">
                <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{copy.whyTitle}</h2>
                <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-slate-400">{copy.whyIntro}</p>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    {copy.benefits.map((benefit) => (
                        <article
                            key={benefit.title}
                            className="glass rounded-2xl border border-white/10 p-5 transition-colors hover:border-brand-cyan/30"
                        >
                            <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-cyan/10 text-brand-cyan">
                                <i className={`fa-solid ${benefit.icon} text-lg`} aria-hidden="true" />
                            </span>
                            <h3 className="text-base font-black text-white">{benefit.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-slate-400">{benefit.body}</p>
                        </article>
                    ))}
                </div>
            </section>

            {/* ── Who we're looking for ── */}
            <section className="mx-auto w-full max-w-5xl px-5 py-12 lg:py-16">
                <div className="glass rounded-3xl border border-white/10 p-6 sm:p-8">
                    <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{copy.whoTitle}</h2>
                    <p className="mt-2.5 text-sm leading-relaxed text-slate-400">{copy.whoIntro}</p>
                    <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                        {copy.checklist.map((item) => (
                            <li key={item} className="flex items-start gap-3">
                                <span
                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-green/15 text-brand-green"
                                    aria-hidden="true"
                                >
                                    <i className="fa-solid fa-check text-[10px]" />
                                </span>
                                <span className="text-sm leading-relaxed text-slate-200">{item}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-6 rounded-2xl border border-brand-cyan/20 bg-brand-cyan/5 px-4 py-3.5 text-sm leading-relaxed text-slate-300">
                        {copy.whoNote}
                    </p>
                </div>
            </section>

            {/* ── How it works ── */}
            <section id="how-it-works" className="mx-auto w-full max-w-5xl scroll-mt-6 px-5 py-12 lg:py-16">
                <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{copy.howTitle}</h2>
                <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-slate-400">{copy.howIntro}</p>
                <ol className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {copy.steps.map((step, index) => (
                        <li
                            key={step.title}
                            className="glass relative rounded-2xl border border-white/10 p-5 pt-6"
                        >
                            <span className="absolute -top-3 left-5 flex h-7 w-7 items-center justify-center rounded-lg bg-brand-cyan text-xs font-black text-brand-darker">
                                {index + 1}
                            </span>
                            <h3 className="text-sm font-black text-white">{step.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
                        </li>
                    ))}
                </ol>
                <div className="mt-7">
                    <a
                        href="#apply"
                        onClick={handleApplyClick('how_it_works')}
                        className="inline-flex min-h-12 items-center justify-center rounded-xl border border-brand-cyan/40 bg-brand-cyan/10 px-6 text-xs font-black uppercase tracking-widest text-brand-cyan [.theme-light_&]:text-cyan-800 transition-colors hover:bg-brand-cyan/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
                    >
                        {copy.ctaApply}
                    </a>
                </div>
            </section>

            {/* ── Application ── */}
            <section className="mx-auto w-full max-w-3xl px-5 py-12 lg:py-16">
                <BreakerApplicationForm copy={copy} isThai={isThai} prefill={prefill} prefix={prefix} />
            </section>
        </main>
    );
}
