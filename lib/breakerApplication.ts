/**
 * Breaker application — the shape of a submission, shared by the public form
 * (app/become-a-breaker) and the server endpoint (app/api/breaker-applications).
 *
 * Both sides parse with the SAME zod schema so client-side inline validation
 * and the authoritative server check can never drift: a value the form accepts
 * is a value the endpoint accepts. Keep this module pure — no next/* or
 * supabase imports — so it runs identically in the browser and on the server.
 *
 * The option ids here are the values persisted to breaker_applications
 * (supabase/migrations/20260809_breaker_applications.sql). They are stable
 * machine ids, never display labels; the bilingual labels live in
 * app/become-a-breaker/content.ts and are keyed off these.
 */

import { z } from 'zod';
import { isValidThaiPhone, normalizePhone } from '@/lib/utils/phone';

// ── Option vocabularies ────────────────────────────────────────────────────

export const APPLICANT_TYPES = [
    'breaker',
    'card_shop',
    'marketplace_seller',
    'content_creator',
    'collector',
    'other',
] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];

// Mirrors the six games CardStreet actually carries (lib/games.ts) plus a
// free-text escape hatch, so the option list can't advertise a game we don't
// have a catalog for.
export const BREAKER_GAMES = [
    'pokemon',
    'one_piece',
    'mtg',
    'yugioh',
    'lorcana',
    'riftbound',
    'other',
] as const;
export type BreakerGame = (typeof BREAKER_GAMES)[number];

export const EXPERIENCE_LEVELS = ['none', 'under_1y', '1_to_3y', 'over_3y'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

// The equipment and setup-status questions were removed from the form
// (2026-08-15), but the vocabularies stay: applications submitted before then
// carry these values, and the review console still labels them.
export const EQUIPMENT_OPTIONS = [
    'smartphone',
    'camera',
    'microphone',
    'lighting',
    'tripod_or_mount',
    'computer',
    'other',
] as const;
export type EquipmentOption = (typeof EQUIPMENT_OPTIONS)[number];

export const SETUP_STATUSES = ['ready', 'minor_improvements', 'building'] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

export const PREFERRED_LANGUAGES = ['th', 'en', 'bilingual'] as const;
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number];

/** Application lifecycle. A fresh submission is always 'new'. */
export const APPLICATION_STATUSES = [
    'new',
    'reviewing',
    'test_stream',
    'approved',
    'rejected',
    'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// ── Field limits ───────────────────────────────────────────────────────────
// Exported so the form can render live character counters off the same numbers
// the schema enforces. A counter that disagrees with the validator is a bug
// the user only discovers on submit.

export const LIMITS = {
    fullName: 100,
    email: 254,
    phone: 32,
    lineId: 64,
    city: 80,
    province: 80,
    businessName: 120,
    socialLink: 300,
    socialLinks: 5,
    cardstreetUsername: 64,
    gamesOther: 120,
    applicantTypeOther: 120,
    experienceSummary: 1000,
    sampleVideoUrl: 300,
    availability: 300,
    breakTypes: 500,
    inventoryNotes: 500,
} as const;

/** Long-answer fields that render a character counter. */
export const COUNTED_FIELDS = [
    'experienceSummary',
    'availability',
    'breakTypes',
    'inventoryNotes',
] as const;
export type CountedField = (typeof COUNTED_FIELDS)[number];

// ── Primitives ─────────────────────────────────────────────────────────────

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, min = 1) => trimmed(max).min(min);

/**
 * Accepts a bare domain ("facebook.com/me") as well as a full URL — people
 * paste profile links both ways — but stores an absolute https URL so the
 * reviewer can click it. Rejects anything that isn't http(s) once normalized,
 * which keeps `javascript:` and `data:` out of a field an admin will click.
 */
export function normalizeUrl(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    try {
        const u = new URL(withScheme);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        if (!u.hostname.includes('.')) return '';
        return u.toString();
    } catch {
        return '';
    }
}

export function isValidUrl(raw: string): boolean {
    return normalizeUrl(raw).length > 0;
}

// Refine BEFORE transform, deliberately. The other order lets normalizeUrl turn
// an unparseable value ("javascript:alert(1)") into '' and then wave it through
// on the "empty is fine" branch — the applicant's typo silently disappears
// instead of being flagged.
const urlField = (max: number) =>
    trimmed(max)
        .refine((v) => v === '' || isValidUrl(v), { message: 'invalid_url' })
        .transform((v) => (v ? normalizeUrl(v) : ''));

// Deliberately looser than the app's own signup validation: this is a lead
// form, and a valid-looking address that bounces costs us a follow-up email,
// while an over-strict regex costs us the applicant.
//
// min(1), not min(5): a longer minimum fires FIRST and reports "too short",
// which the client would render as "add a little more detail" — the wrong
// instruction for someone who typed a malformed address. The format refine is
// the real gate, and min(1) exists only to distinguish empty (= required).
const emailField = trimmed(LIMITS.email)
    .min(1)
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), { message: 'invalid_email' });

// Applicants are in Thailand (the program's stated market) and the team calls
// them back, so the number has to be dialable here — same bar the checkout
// path holds buyers to. min(1) for the same reason as email above.
const phoneField = trimmed(LIMITS.phone)
    .min(1)
    .refine((v) => isValidThaiPhone(v), { message: 'invalid_phone' })
    .transform((v) => normalizePhone(v));

// ── Submission schema ──────────────────────────────────────────────────────

export const BreakerApplicationSchema = z.object({
    // Contact information
    fullName: requiredText(LIMITS.fullName, 2),
    email: emailField,
    phone: phoneField,
    lineId: trimmed(LIMITS.lineId).optional().default(''),
    city: requiredText(LIMITS.city),
    province: requiredText(LIMITS.province),
    preferredLanguage: z.enum(PREFERRED_LANGUAGES),
    isAdult: z.literal(true),

    // Applicant profile
    applicantTypes: z.array(z.enum(APPLICANT_TYPES)).min(1).max(APPLICANT_TYPES.length),
    applicantTypeOther: trimmed(LIMITS.applicantTypeOther).optional().default(''),
    businessName: trimmed(LIMITS.businessName).optional().default(''),
    socialLinks: z
        .array(urlField(LIMITS.socialLink))
        .max(LIMITS.socialLinks)
        .optional()
        .default([])
        // Blank rows are how the repeatable field renders an empty slot; drop
        // them rather than failing a submission over an untouched input.
        .transform((links) => links.filter(Boolean)),
    cardstreetUsername: trimmed(LIMITS.cardstreetUsername).optional().default(''),

    // TCG experience
    games: z.array(z.enum(BREAKER_GAMES)).min(1).max(BREAKER_GAMES.length),
    gamesOther: trimmed(LIMITS.gamesOther).optional().default(''),
    breakingExperience: z.enum(EXPERIENCE_LEVELS),
    experienceSummary: requiredText(LIMITS.experienceSummary, 20),
    sampleVideoUrl: urlField(LIMITS.sampleVideoUrl).optional().default(''),

    // Streaming readiness
    availability: requiredText(LIMITS.availability, 3),
    breakTypes: requiredText(LIMITS.breakTypes, 3),
    inventoryNotes: trimmed(LIMITS.inventoryNotes).optional().default(''),

    // Consent — each box is stored separately so a later change to the wording
    // of one doesn't invalidate the record of the others.
    consentAccurate: z.literal(true),
    consentNoGuarantee: z.literal(true),
    consentTerms: z.literal(true),

    // Context
    locale: z.enum(['th', 'en']).optional().default('th'),
    utm: z.record(z.string().max(200)).optional().default({}),
    referrer: trimmed(500).optional().default(''),

    // Spam honeypot: a real applicant never sees this field, so any value in it
    // means a bot filled the form in. Named to look worth filling.
    website: z.string().max(200).optional().default(''),
});

export type BreakerApplicationInput = z.input<typeof BreakerApplicationSchema>;
export type BreakerApplication = z.output<typeof BreakerApplicationSchema>;

/**
 * The subset of fields a section owns, so the form can expand exactly the
 * sections that failed validation instead of dumping the user at the top.
 */
export const SECTION_FIELDS = {
    contact: ['fullName', 'email', 'phone', 'lineId', 'city', 'province', 'preferredLanguage', 'isAdult'],
    profile: ['applicantTypes', 'applicantTypeOther', 'businessName', 'socialLinks', 'cardstreetUsername'],
    experience: ['games', 'gamesOther', 'breakingExperience', 'experienceSummary', 'sampleVideoUrl'],
    streaming: ['availability', 'breakTypes', 'inventoryNotes'],
    consent: ['consentAccurate', 'consentNoGuarantee', 'consentTerms'],
} as const;

export type SectionId = keyof typeof SECTION_FIELDS;
export const SECTION_ORDER = Object.keys(SECTION_FIELDS) as SectionId[];

/** UTM/attribution params worth keeping with the lead. */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'] as const;

// ── Admin-facing labels ────────────────────────────────────────────────────
/**
 * English labels for the option ids, for the review console (/admin/breakers).
 *
 * Deliberately NOT reusing app/become-a-breaker/content.ts: that module is the
 * public page's bilingual copy, and importing it into admin would pull the
 * whole Thai translation payload into a console that is English-only. Keeping
 * these beside the vocabularies they label also means a new option and its
 * admin label are added in one place.
 */
export const ADMIN_LABELS: {
    applicantType: Record<ApplicantType, string>;
    game: Record<BreakerGame, string>;
    experience: Record<ExperienceLevel, string>;
    equipment: Record<EquipmentOption, string>;
    setupStatus: Record<SetupStatus, string>;
    preferredLanguage: Record<PreferredLanguage, string>;
    status: Record<ApplicationStatus, string>;
} = {
    applicantType: {
        breaker: 'Breaker',
        card_shop: 'Card shop',
        marketplace_seller: 'Marketplace seller',
        content_creator: 'Content creator',
        collector: 'Collector',
        other: 'Other',
    },
    game: {
        pokemon: 'Pokémon',
        one_piece: 'One Piece',
        mtg: 'Magic',
        yugioh: 'Yu-Gi-Oh!',
        lorcana: 'Lorcana',
        riftbound: 'Riftbound',
        other: 'Other',
    },
    experience: {
        none: 'No experience',
        under_1y: 'Under 1 year',
        '1_to_3y': '1–3 years',
        over_3y: '3+ years',
    },
    equipment: {
        smartphone: 'Smartphone',
        camera: 'Camera',
        microphone: 'Microphone',
        lighting: 'Lighting',
        tripod_or_mount: 'Tripod / mount',
        computer: 'Computer',
        other: 'Other',
    },
    setupStatus: {
        ready: 'Ready now',
        minor_improvements: 'Needs minor work',
        building: 'Still building',
    },
    preferredLanguage: { th: 'Thai', en: 'English', bilingual: 'Bilingual' },
    status: {
        new: 'New',
        reviewing: 'Reviewing',
        test_stream: 'Test stream',
        approved: 'Approved',
        rejected: 'Rejected',
        withdrawn: 'Withdrawn',
    },
};

/** Statuses that still need a decision, for the review queue's default view. */
export const OPEN_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
    'new',
    'reviewing',
    'test_stream',
];
