'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { ZodIssue } from 'zod';
import {
    APPLICANT_TYPES,
    BREAKER_GAMES,
    BreakerApplicationSchema,
    EXPERIENCE_LEVELS,
    LIMITS,
    PREFERRED_LANGUAGES,
    SECTION_FIELDS,
    SECTION_ORDER,
    UTM_KEYS,
    type CountedField,
    type SectionId,
} from '@/lib/breakerApplication';
import { readAttributionParams, trackBreakerEvent } from '@/lib/breakerEvents';
import type { BreakerCopy } from './content';

/**
 * The breaker application form.
 *
 * Validation is the SHARED zod schema (lib/breakerApplication.ts) — the same
 * one the endpoint parses with — so the inline errors a user sees are exactly
 * the rules the server enforces. Issue codes are mapped to localized sentences
 * here rather than surfacing zod's English defaults.
 *
 * Progressive disclosure: five collapsible sections inside ONE <form>. Not a
 * wizard — every answer stays mounted, so browser autofill, "back" and a failed
 * submit all keep the user's work. A failed submit re-opens exactly the
 * sections that have errors and moves focus to the first bad field.
 */

export interface BreakerFormPrefill {
    fullName?: string;
    email?: string;
    phone?: string;
    city?: string;
    province?: string;
    cardstreetUsername?: string;
}

interface FormState {
    fullName: string;
    email: string;
    phone: string;
    lineId: string;
    city: string;
    province: string;
    preferredLanguage: string;
    isAdult: boolean;
    applicantTypes: string[];
    applicantTypeOther: string;
    businessName: string;
    socialLinks: string[];
    cardstreetUsername: string;
    games: string[];
    gamesOther: string;
    breakingExperience: string;
    experienceSummary: string;
    sampleVideoUrl: string;
    availability: string;
    breakTypes: string;
    inventoryNotes: string;
    consentAccurate: boolean;
    consentNoGuarantee: boolean;
    consentTerms: boolean;
    website: string;
}

type FieldName = keyof FormState;
type Errors = Partial<Record<FieldName, string>>;

// py-3 (not py-2.5) so the row clears the 44px touch-target floor the app sets
// for coarse pointers in globals.css — the label IS the hit area here, and the
// 16px checkbox inside it is not.
const CHOICE_BASE =
    'flex items-center gap-2.5 rounded-xl border px-3 py-3 text-sm font-bold transition-colors cursor-pointer select-none focus-within:ring-2 focus-within:ring-brand-cyan/70';
const CHOICE_ON = 'border-brand-cyan/60 bg-brand-cyan/10 text-white';
const CHOICE_OFF = 'border-white/10 bg-white/5 text-slate-300 hover:border-white/25';
const INPUT_BASE =
    'w-full rounded-xl border bg-white/5 px-3.5 py-3 text-sm text-white placeholder:text-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-cyan/70 focus:border-brand-cyan';
const INPUT_OK = 'border-white/10';
const INPUT_BAD = 'border-brand-red/70';

function initialState(prefill: BreakerFormPrefill, isThai: boolean): FormState {
    return {
        fullName: prefill.fullName ?? '',
        email: prefill.email ?? '',
        phone: prefill.phone ?? '',
        lineId: '',
        city: prefill.city ?? '',
        province: prefill.province ?? '',
        // Pre-answered from the locale they're reading in — still changeable,
        // and it keeps a required field from reading as an obstacle.
        preferredLanguage: isThai ? 'th' : 'en',
        isAdult: false,
        applicantTypes: [],
        applicantTypeOther: '',
        businessName: '',
        socialLinks: [''],
        cardstreetUsername: prefill.cardstreetUsername ?? '',
        games: [],
        gamesOther: '',
        breakingExperience: '',
        experienceSummary: '',
        sampleVideoUrl: '',
        availability: '',
        breakTypes: '',
        inventoryNotes: '',
        consentAccurate: false,
        consentNoGuarantee: false,
        consentTerms: false,
        website: '',
    };
}

/**
 * zod issue -> one localized sentence.
 *
 * `isEmpty` distinguishes "you haven't answered this" from "your answer is too
 * short" — zod reports both as too_small, but telling someone who typed nothing
 * to "add a little more detail" is the wrong instruction.
 */
function messageFor(issue: ZodIssue, copy: BreakerCopy, isEmpty: boolean): string {
    const e = copy.errors;
    if (issue.code === 'custom') {
        if (issue.message === 'invalid_email') return e.email;
        if (issue.message === 'invalid_phone') return e.phone;
        if (issue.message === 'invalid_url') return e.url;
    }
    if (issue.code === 'too_small') {
        if (issue.type === 'array') return e.pickOne;
        if (isEmpty) return e.required;
        return typeof issue.minimum === 'number' && issue.minimum > 1 ? e.tooShort : e.required;
    }
    if (issue.code === 'too_big') return e.tooLong;
    if (issue.code === 'invalid_literal') {
        return issue.path[0] === 'isAdult' ? e.adult : e.consent;
    }
    return e.required;
}

export default function BreakerApplicationForm({
    copy,
    isThai,
    prefill,
    prefix,
}: {
    copy: BreakerCopy;
    isThai: boolean;
    prefill: BreakerFormPrefill;
    /** URL-derived locale prefix, so policy links stay inside the /en tree. */
    prefix: '' | '/en';
}) {
    const uid = useId();
    const formRef = useRef<HTMLFormElement>(null);
    const startedRef = useRef(false);
    const succeededRef = useRef(false);

    const [values, setValues] = useState<FormState>(() => initialState(prefill, isThai));
    const [errors, setErrors] = useState<Errors>({});
    const [linkErrors, setLinkErrors] = useState<Record<number, string>>({});
    const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
    const [open, setOpen] = useState<SectionId[]>(['contact']);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [showSummary, setShowSummary] = useState(false);
    // Bumped by a rejected submit; the effect below moves focus once the
    // resulting error state has actually rendered.
    const [focusSignal, setFocusSignal] = useState(0);

    useEffect(() => {
        if (!focusSignal) return;
        const first = formRef.current?.querySelector<HTMLElement>(
            '[aria-invalid="true"], [data-invalid="true"]',
        );
        if (!first) return;
        first.focus({ preventScroll: true });
        const reduced =
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        first.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }, [focusSignal]);

    const fid = useCallback((name: string) => `${uid}-${name}`, [uid]);

    /** One funnel event the first time the user actually engages. */
    const markStarted = useCallback(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        trackBreakerEvent('breaker_application_start');
    }, []);

    const set = useCallback(
        <K extends FieldName>(name: K, value: FormState[K]) => {
            markStarted();
            setValues((prev) => ({ ...prev, [name]: value }));
            // Clearing as you type is the least punishing feedback loop: the
            // error re-appears on blur if it's still wrong.
            setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
        },
        [markStarted],
    );

    const toggleInArray = useCallback(
        (name: 'applicantTypes' | 'games', option: string) => {
            markStarted();
            setValues((prev) => {
                const current = prev[name];
                const next = current.includes(option)
                    ? current.filter((v) => v !== option)
                    : [...current, option];
                return { ...prev, [name]: next };
            });
            setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
        },
        [markStarted],
    );

    /** Parse the whole form; returns issues keyed by field plus per-link issues. */
    const runValidation = useCallback(
        (state: FormState) => {
            const result = BreakerApplicationSchema.safeParse({
                ...state,
                locale: isThai ? 'th' : 'en',
                utm: readAttributionParams(UTM_KEYS),
                referrer: typeof document !== 'undefined' ? document.referrer.slice(0, 500) : '',
            });
            if (result.success) return { ok: true as const, fields: {} as Errors, links: {} };

            const fields: Errors = {};
            const links: Record<number, string> = {};
            for (const issue of result.error.issues) {
                const [head, index] = issue.path;
                if (head === 'socialLinks' && typeof index === 'number') {
                    links[index] ??= messageFor(issue, copy, !state.socialLinks[index]);
                    continue;
                }
                const key = head as FieldName;
                if (!key || fields[key]) continue;
                const raw = state[key];
                fields[key] = messageFor(issue, copy, typeof raw === 'string' && raw.trim() === '');
            }
            return { ok: false as const, fields, links };
        },
        [copy, isThai],
    );

    /** Live per-section state, so a closed section can still say it's done. */
    const sectionStatus = useMemo(() => {
        const { fields } = runValidation(values);
        const status = {} as Record<SectionId, 'complete' | 'pending'>;
        for (const section of SECTION_ORDER) {
            const owned = SECTION_FIELDS[section] as readonly string[];
            status[section] = owned.some((f) => fields[f as FieldName]) ? 'pending' : 'complete';
        }
        return status;
    }, [values, runValidation]);

    const blur = useCallback(
        (name: FieldName) => {
            setTouched((prev) => ({ ...prev, [name]: true }));
            const { fields } = runValidation(values);
            setErrors((prev) => ({ ...prev, [name]: fields[name] }));
        },
        [runValidation, values],
    );

    const toggleSection = useCallback((section: SectionId) => {
        setOpen((prev) =>
            prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section],
        );
    }, []);

    const handleSubmit = useCallback(
        async (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            // Guard against a double-submit from a fast second click or an
            // Enter keypress landing while the first request is in flight.
            if (submitting || succeededRef.current) return;

            const { ok, fields, links } = runValidation(values);
            if (!ok) {
                setErrors(fields);
                setLinkErrors(links);
                setTouched(
                    Object.fromEntries(Object.keys(fields).map((k) => [k, true])) as Partial<
                        Record<FieldName, boolean>
                    >,
                );
                setShowSummary(true);
                setSubmitError(null);

                // Re-open every section that has something wrong. Focus moves in
                // the effect below, not here — the invalid markers this queries
                // for don't exist in the DOM until React commits this state.
                const bad = SECTION_ORDER.filter((section) =>
                    (SECTION_FIELDS[section] as readonly string[]).some((f) => fields[f as FieldName]),
                );
                setOpen((prev) => Array.from(new Set([...prev, ...bad])));
                setFocusSignal((n) => n + 1);
                return;
            }

            setErrors({});
            setLinkErrors({});
            setShowSummary(false);
            setSubmitError(null);
            setSubmitting(true);
            trackBreakerEvent('breaker_application_submit', {
                games: values.games.length,
                applicant_types: values.applicantTypes.length,
                experience: values.breakingExperience,
            });

            const utm = readAttributionParams(UTM_KEYS);
            try {
                const response = await fetch('/api/breaker-applications', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...values,
                        locale: isThai ? 'th' : 'en',
                        utm,
                        referrer: document.referrer.slice(0, 500),
                    }),
                });

                if (response.ok) {
                    succeededRef.current = true;
                    setSubmitted(true);
                    trackBreakerEvent('breaker_application_success', {
                        ...utm,
                        locale: isThai ? 'th' : 'en',
                    });
                    return;
                }

                const data = await response.json().catch(() => ({}));
                const code: string = data?.code ?? 'SERVER_ERROR';
                trackBreakerEvent('breaker_application_error', { code, status: response.status });

                if (code === 'DUPLICATE_APPLICATION') setSubmitError(copy.errors.duplicate);
                else if (code === 'RATE_LIMITED') setSubmitError(copy.errors.rateLimited);
                else if (code === 'VALIDATION_FAILED') {
                    // The server rejected something the client accepted — trust
                    // the server, surface it against the named fields.
                    const serverFields: Errors = {};
                    for (const [key, list] of Object.entries(data?.fields ?? {})) {
                        if (Array.isArray(list) && list.length) serverFields[key as FieldName] = copy.errors.required;
                    }
                    setErrors(serverFields);
                    setShowSummary(true);
                    setSubmitError(copy.errors.summary);
                } else setSubmitError(copy.errors.server);
            } catch {
                trackBreakerEvent('breaker_application_error', { code: 'NETWORK' });
                setSubmitError(copy.errors.network);
            } finally {
                setSubmitting(false);
            }
        },
        [copy, isThai, runValidation, submitting, values],
    );

    // ── Confirmation state ──
    if (submitted) {
        return (
            <div
                id="apply"
                className="glass scroll-mt-24 rounded-3xl border border-brand-green/25 p-8 text-center sm:p-12"
                role="status"
                aria-live="polite"
            >
                <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/15 text-brand-green">
                    <i className="fa-solid fa-check text-xl" />
                </span>
                <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                    {copy.successTitle}
                </h2>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-300">
                    {copy.successBody}
                </p>
                <Link
                    href={prefix || '/'}
                    className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-white/10 px-6 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
                >
                    {copy.successBack}
                </Link>
            </div>
        );
    }

    // ── Reusable field renderers ──

    const errorNode = (name: FieldName) =>
        errors[name] && touched[name] ? (
            <p id={fid(`${name}-error`)} role="alert" className="mt-1.5 text-xs font-bold text-brand-red">
                {errors[name]}
            </p>
        ) : null;

    const describedBy = (name: FieldName, extra?: string) =>
        [extra, errors[name] && touched[name] ? fid(`${name}-error`) : null].filter(Boolean).join(' ') ||
        undefined;

    const invalid = (name: FieldName) => Boolean(errors[name] && touched[name]);

    const textInput = (
        name: FieldName,
        label: string,
        opts: {
            type?: string;
            required?: boolean;
            hint?: string;
            autoComplete?: string;
            inputMode?: 'text' | 'email' | 'tel' | 'url';
            placeholder?: string;
        } = {},
    ) => {
        const hintId = opts.hint ? fid(`${name}-hint`) : undefined;
        return (
            <div>
                <label htmlFor={fid(name)} className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400">
                    {label}{' '}
                    <span className="font-bold normal-case tracking-normal text-slate-400">
                        {opts.required ? '' : `(${copy.optional})`}
                    </span>
                </label>
                {opts.hint && (
                    <p id={hintId} className="mb-1.5 text-xs text-slate-400">
                        {opts.hint}
                    </p>
                )}
                <input
                    id={fid(name)}
                    name={name}
                    type={opts.type ?? 'text'}
                    inputMode={opts.inputMode}
                    autoComplete={opts.autoComplete}
                    placeholder={opts.placeholder}
                    maxLength={LIMITS[name as keyof typeof LIMITS] as number | undefined}
                    required={opts.required}
                    value={values[name] as string}
                    onChange={(e) => set(name, e.target.value as FormState[typeof name])}
                    onBlur={() => blur(name)}
                    aria-invalid={invalid(name)}
                    aria-describedby={describedBy(name, hintId)}
                    className={`${INPUT_BASE} ${invalid(name) ? INPUT_BAD : INPUT_OK}`}
                />
                {errorNode(name)}
            </div>
        );
    };

    const textArea = (
        name: CountedField,
        label: string,
        opts: { required?: boolean; hint?: string; rows?: number } = {},
    ) => {
        const limit = LIMITS[name];
        const left = limit - (values[name] as string).length;
        const hintId = opts.hint ? fid(`${name}-hint`) : undefined;
        const countId = fid(`${name}-count`);
        return (
            <div>
                <label htmlFor={fid(name)} className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400">
                    {label}{' '}
                    <span className="font-bold normal-case tracking-normal text-slate-400">
                        {opts.required ? '' : `(${copy.optional})`}
                    </span>
                </label>
                {opts.hint && (
                    <p id={hintId} className="mb-1.5 text-xs text-slate-400">
                        {opts.hint}
                    </p>
                )}
                <textarea
                    id={fid(name)}
                    name={name}
                    rows={opts.rows ?? 4}
                    maxLength={limit}
                    required={opts.required}
                    value={values[name] as string}
                    onChange={(e) => set(name, e.target.value as FormState[typeof name])}
                    onBlur={() => blur(name)}
                    aria-invalid={invalid(name)}
                    aria-describedby={describedBy(name, [hintId, countId].filter(Boolean).join(' '))}
                    className={`${INPUT_BASE} resize-y ${invalid(name) ? INPUT_BAD : INPUT_OK}`}
                />
                <div className="mt-1.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">{errorNode(name)}</div>
                    <p id={countId} className={`shrink-0 text-xs ${left < 40 ? 'text-brand-red' : 'text-slate-400'}`}>
                        {copy.charactersLeft(Math.max(left, 0))}
                    </p>
                </div>
            </div>
        );
    };

    const checkboxGroup = (
        name: 'applicantTypes' | 'games',
        legend: string,
        options: readonly string[],
        labels: Record<string, string>,
        opts: { required?: boolean; hint?: string } = {},
    ) => {
        const hintId = opts.hint ? fid(`${name}-hint`) : undefined;
        return (
            <fieldset>
                <legend className="mb-1.5 text-xs font-black uppercase tracking-wider text-slate-400">
                    {legend}{' '}
                    <span className="font-bold normal-case tracking-normal text-slate-400">
                        {opts.required ? '' : `(${copy.optional})`}
                    </span>
                </legend>
                {opts.hint && (
                    <p id={hintId} className="mb-2 text-xs text-slate-400">
                        {opts.hint}
                    </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {options.map((option) => {
                        const on = values[name].includes(option);
                        return (
                            <label
                                key={option}
                                className={`${CHOICE_BASE} ${on ? CHOICE_ON : CHOICE_OFF}`}
                            >
                                <input
                                    type="checkbox"
                                    name={name}
                                    value={option}
                                    checked={on}
                                    onChange={() => toggleInArray(name, option)}
                                    onBlur={() => blur(name)}
                                    aria-invalid={invalid(name)}
                                    aria-describedby={describedBy(name, hintId)}
                                    className="h-4 w-4 shrink-0 accent-brand-cyan"
                                />
                                <span>{labels[option]}</span>
                            </label>
                        );
                    })}
                </div>
                {errorNode(name)}
            </fieldset>
        );
    };

    const radioGroup = (
        name: FieldName,
        legend: string,
        options: readonly string[],
        labels: Record<string, string>,
        opts: { hint?: string } = {},
    ) => (
        <fieldset>
            <legend className="mb-1.5 text-xs font-black uppercase tracking-wider text-slate-400">
                {legend}
            </legend>
            {opts.hint && <p className="mb-2 text-xs text-slate-400">{opts.hint}</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {options.map((option) => {
                    const on = values[name] === option;
                    return (
                        <label key={option} className={`${CHOICE_BASE} ${on ? CHOICE_ON : CHOICE_OFF}`}>
                            <input
                                type="radio"
                                name={fid(name)}
                                value={option}
                                checked={on}
                                onChange={() => set(name, option as FormState[typeof name])}
                                onBlur={() => blur(name)}
                                // aria-invalid isn't valid on role=radio; the
                                // data attribute is what the submit handler's
                                // focus-first-error query looks for instead.
                                data-invalid={invalid(name) || undefined}
                                aria-describedby={describedBy(name)}
                                className="h-4 w-4 shrink-0 accent-brand-cyan"
                            />
                            <span>{labels[option]}</span>
                        </label>
                    );
                })}
            </div>
            {errorNode(name)}
        </fieldset>
    );

    // Also renders the 18+ confirmation, which is the same control shape.
    type BooleanField = 'isAdult' | 'consentAccurate' | 'consentNoGuarantee' | 'consentTerms';
    const consentBox = (name: BooleanField, label: React.ReactNode) => (
        <div>
            <label className={`${CHOICE_BASE} items-start ${values[name] ? CHOICE_ON : CHOICE_OFF}`}>
                <input
                    type="checkbox"
                    name={name}
                    checked={values[name]}
                    onChange={(e) => set(name, e.target.checked)}
                    onBlur={() => blur(name)}
                    aria-invalid={invalid(name)}
                    aria-describedby={describedBy(name)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-cyan"
                />
                <span className="font-bold leading-relaxed">{label}</span>
            </label>
            {errorNode(name)}
        </div>
    );

    const section = (id: SectionId, index: number, body: React.ReactNode) => {
        const isOpen = open.includes(id);
        const status = sectionStatus[id];
        return (
            <section key={id} className="glass overflow-hidden rounded-2xl border border-white/10">
                <h3>
                    <button
                        type="button"
                        onClick={() => toggleSection(id)}
                        aria-expanded={isOpen}
                        aria-controls={fid(`panel-${id}`)}
                        className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-cyan sm:px-5"
                    >
                        <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
                                status === 'complete'
                                    ? 'bg-brand-green/15 text-brand-green'
                                    : 'bg-white/5 text-slate-400'
                            }`}
                        >
                            {status === 'complete' ? <i className="fa-solid fa-check" /> : index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-black text-white">{copy.sections[id].title}</span>
                            <span className="block text-xs text-slate-400">{copy.sections[id].hint}</span>
                        </span>
                        <span className="sr-only">{isOpen ? copy.collapse : copy.expand}</span>
                        <i
                            className={`fa-solid fa-chevron-down shrink-0 text-xs text-slate-400 transition-transform motion-reduce:transition-none ${
                                isOpen ? 'rotate-180' : ''
                            }`}
                            aria-hidden="true"
                        />
                    </button>
                </h3>
                <div id={fid(`panel-${id}`)} hidden={!isOpen} className="space-y-5 border-t border-white/5 px-4 py-5 sm:px-5">
                    {body}
                </div>
            </section>
        );
    };

    const wantsOther = (name: 'applicantTypes' | 'games') => values[name].includes('other');

    return (
        <div id="apply" className="scroll-mt-24">
            <header className="mb-6">
                <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{copy.formTitle}</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">{copy.formIntro}</p>
            </header>

            {(showSummary || submitError) && (
                <div
                    role="alert"
                    className="mb-5 rounded-2xl border border-brand-red/40 bg-brand-red/10 px-4 py-3.5 text-sm font-bold text-white"
                >
                    <p>{submitError ?? copy.errors.summary}</p>
                    <p className="mt-1 text-xs font-bold text-slate-300">{copy.errors.dataKept}</p>
                </div>
            )}

            <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-3">
                {/* Honeypot. Off-screen rather than display:none — some bots skip
                    hidden fields, and this one is meant to be filled in. */}
                <div aria-hidden="true" className="absolute left-[-9999px] h-px w-px overflow-hidden">
                    <label htmlFor={fid('website')}>Website</label>
                    <input
                        id={fid('website')}
                        name="website"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={values.website}
                        onChange={(e) => setValues((prev) => ({ ...prev, website: e.target.value }))}
                    />
                </div>

                {section(
                    'contact',
                    0,
                    <>
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                            {textInput('fullName', copy.fields.fullName, { required: true, autoComplete: 'name' })}
                            {textInput('email', copy.fields.email, {
                                required: true,
                                type: 'email',
                                inputMode: 'email',
                                autoComplete: 'email',
                            })}
                            {textInput('phone', copy.fields.phone, {
                                required: true,
                                type: 'tel',
                                inputMode: 'tel',
                                autoComplete: 'tel',
                                hint: copy.fields.phoneHint,
                            })}
                            {textInput('lineId', copy.fields.lineId)}
                            {textInput('city', copy.fields.city, { required: true, autoComplete: 'address-level2' })}
                            {textInput('province', copy.fields.province, {
                                required: true,
                                autoComplete: 'address-level1',
                            })}
                        </div>
                        {radioGroup(
                            'preferredLanguage',
                            copy.fields.preferredLanguage,
                            PREFERRED_LANGUAGES,
                            copy.options.preferredLanguage,
                        )}
                        {consentBox('isAdult', copy.fields.isAdult)}
                    </>,
                )}

                {section(
                    'profile',
                    1,
                    <>
                        {checkboxGroup(
                            'applicantTypes',
                            copy.fields.applicantTypes,
                            APPLICANT_TYPES,
                            copy.options.applicantType,
                            { required: true, hint: copy.fields.applicantTypesHint },
                        )}
                        {wantsOther('applicantTypes') &&
                            textInput('applicantTypeOther', copy.fields.applicantTypeOther)}
                        {textInput('businessName', copy.fields.businessName)}

                        {/* Repeatable link rows */}
                        <fieldset>
                            <legend className="mb-1.5 text-xs font-black uppercase tracking-wider text-slate-400">
                                {copy.fields.socialLinks}{' '}
                                <span className="font-bold normal-case tracking-normal text-slate-400">
                                    ({copy.optional})
                                </span>
                            </legend>
                            <p className="mb-2 text-xs text-slate-400">{copy.fields.socialLinksHint}</p>
                            <div className="space-y-2">
                                {values.socialLinks.map((link, index) => (
                                    <div key={index}>
                                        <div className="flex items-center gap-2">
                                            <input
                                                id={fid(`socialLinks-${index}`)}
                                                type="url"
                                                inputMode="url"
                                                placeholder="facebook.com/yourpage"
                                                maxLength={LIMITS.socialLink}
                                                value={link}
                                                aria-label={`${copy.fields.socialLinks} ${index + 1}`}
                                                aria-invalid={Boolean(linkErrors[index])}
                                                aria-describedby={
                                                    linkErrors[index] ? fid(`socialLinks-${index}-error`) : undefined
                                                }
                                                onChange={(e) => {
                                                    markStarted();
                                                    setValues((prev) => {
                                                        const next = [...prev.socialLinks];
                                                        next[index] = e.target.value;
                                                        return { ...prev, socialLinks: next };
                                                    });
                                                    setLinkErrors((prev) => {
                                                        if (!prev[index]) return prev;
                                                        const next = { ...prev };
                                                        delete next[index];
                                                        return next;
                                                    });
                                                }}
                                                onBlur={() => {
                                                    const { links } = runValidation(values);
                                                    setLinkErrors(links);
                                                }}
                                                className={`${INPUT_BASE} ${linkErrors[index] ? INPUT_BAD : INPUT_OK}`}
                                            />
                                            {values.socialLinks.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setValues((prev) => ({
                                                            ...prev,
                                                            socialLinks: prev.socialLinks.filter((_, i) => i !== index),
                                                        }))
                                                    }
                                                    aria-label={`${copy.fields.removeLink} ${index + 1}`}
                                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400 transition-colors hover:border-brand-red/50 hover:text-brand-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
                                                >
                                                    <i className="fa-solid fa-xmark text-sm" aria-hidden="true" />
                                                </button>
                                            )}
                                        </div>
                                        {linkErrors[index] && (
                                            <p
                                                id={fid(`socialLinks-${index}-error`)}
                                                role="alert"
                                                className="mt-1.5 text-xs font-bold text-brand-red"
                                            >
                                                {linkErrors[index]}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {values.socialLinks.length < LIMITS.socialLinks && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setValues((prev) => ({ ...prev, socialLinks: [...prev.socialLinks, ''] }))
                                    }
                                    className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-black uppercase tracking-wider text-slate-300 transition-colors hover:border-brand-cyan/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
                                >
                                    <i className="fa-solid fa-plus text-[10px]" aria-hidden="true" />
                                    {copy.fields.addLink}
                                </button>
                            )}
                        </fieldset>

                        {textInput('cardstreetUsername', copy.fields.cardstreetUsername)}
                    </>,
                )}

                {section(
                    'experience',
                    2,
                    <>
                        {checkboxGroup('games', copy.fields.games, BREAKER_GAMES, copy.options.game, {
                            required: true,
                            hint: copy.fields.gamesHint,
                        })}
                        {wantsOther('games') && textInput('gamesOther', copy.fields.gamesOther)}
                        {radioGroup(
                            'breakingExperience',
                            copy.fields.breakingExperience,
                            EXPERIENCE_LEVELS,
                            copy.options.experience,
                        )}
                        {textArea('experienceSummary', copy.fields.experienceSummary, {
                            required: true,
                            hint: copy.fields.experienceSummaryHint,
                            rows: 5,
                        })}
                        {textInput('sampleVideoUrl', copy.fields.sampleVideoUrl, {
                            type: 'url',
                            inputMode: 'url',
                            hint: copy.fields.sampleVideoHint,
                            placeholder: 'youtube.com/watch?v=…',
                        })}
                    </>,
                )}

                {section(
                    'streaming',
                    3,
                    <>
                        {textArea('availability', copy.fields.availability, {
                            required: true,
                            hint: copy.fields.availabilityHint,
                            rows: 3,
                        })}
                        {textArea('breakTypes', copy.fields.breakTypes, {
                            required: true,
                            hint: copy.fields.breakTypesHint,
                            rows: 3,
                        })}
                        {textArea('inventoryNotes', copy.fields.inventoryNotes, { rows: 3 })}
                    </>,
                )}

                {section(
                    'consent',
                    4,
                    <>
                        {consentBox('consentAccurate', copy.consent.accurate)}
                        {consentBox('consentNoGuarantee', copy.consent.noGuarantee)}
                        {/* All three targets are real published pages. Never point a
                            consent link at a URL that doesn't exist — an applicant
                            can't agree to terms they can't read. */}
                        {consentBox(
                            'consentTerms',
                            <>
                                {copy.consent.termsBefore}
                                <Link
                                    href={`${prefix}/privacy`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand-cyan underline underline-offset-2 hover:text-cyan-300"
                                >
                                    {copy.consent.privacyLink}
                                </Link>
                                {copy.consent.termsMiddle}
                                <Link
                                    href={`${prefix}/terms`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand-cyan underline underline-offset-2 hover:text-cyan-300"
                                >
                                    {copy.consent.termsLink}
                                </Link>
                                {copy.consent.termsMiddle2}
                                <Link
                                    href={`${prefix}/breaker-terms`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand-cyan underline underline-offset-2 hover:text-cyan-300"
                                >
                                    {copy.consent.breakerTermsLink}
                                </Link>
                                {copy.consent.termsAfter}
                            </>,
                        )}
                    </>,
                )}

                <div className="pt-2">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-brand-cyan to-brand-green px-6 text-sm font-black uppercase tracking-widest text-brand-darker transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-brand-darker active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                        {submitting && (
                            <i
                                className="fa-solid fa-circle-notch animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                            />
                        )}
                        {submitting ? copy.submitting : copy.submit}
                    </button>
                </div>
            </form>
        </div>
    );
}
