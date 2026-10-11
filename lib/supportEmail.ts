import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSupportInboxAlert, sendSupportReplyNotification } from '@/lib/courier';
import { translateTexts, type Translation } from '@/lib/supportTranslate';
import { languageName } from '@/lib/languageNames';

/**
 * Support tickets over email (server-only).
 *
 * Every new ticket and every customer reply is emailed to the support inbox
 * (SUPPORT_INBOX_EMAIL, default info@cardstreet.app) with an English
 * translation, and every answer from the team is emailed to the customer.
 *
 * Replying by email works in both directions through Postmark inbound
 * (app/api/webhooks/support-email). Each email's Reply-To is the inbound
 * address plus a signed token, `<inbound>+<token>@<domain>`, and the token says
 * which ticket the reply belongs to and who is answering. It is the only thing
 * that authorizes an emailed reply: From headers are trivially forged, the
 * token is an HMAC only this server can mint, and the team token is only ever
 * sent to the support inbox, so a customer cannot post as the team.
 *
 * Until SUPPORT_INBOUND_ADDRESS is set the inbox alert's Reply-To is the
 * customer's own address, so answering by email still reaches them, just off
 * the ticket; the alert says which of the two modes is in effect.
 */

export type ReplyRole = 'admin' | 'user';

export function supportInboxEmail(): string {
    return (process.env.SUPPORT_INBOX_EMAIL || 'info@cardstreet.app').trim();
}

function appBaseUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL || 'https://cardstreet.app').replace(/\/+$/, '');
}

// ─── Signed reply addresses ──────────────────────────────────────────────────

// Token = role char + first 8 hex of the ticket id + 16 hex (64 bits) of HMAC.
// Sized for the RFC 5321 64-octet local-part limit: Postmark's default inbound
// address already spends 33-37 of those on its own hash and the "+", so a full
// UUID plus a signature would not fit. The 8-hex prefix only narrows the
// lookup; the HMAC over the FULL ticket id is what identifies the ticket.
const TOKEN_RE = /^([au])([0-9a-f]{8})([0-9a-f]{16})$/;
const ROLE_CHAR: Record<ReplyRole, 'a' | 'u'> = { admin: 'a', user: 'u' };

function signingKey(): Buffer | null {
    // A dedicated secret when set; otherwise derived from the service-role key
    // with a purpose label, so it is never the raw key and needs no extra setup
    // (the lib/streamKeyCrypto.ts approach). Rotating the source invalidates
    // reply addresses already sent, which then 403 instead of posting.
    const base = (process.env.SUPPORT_REPLY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!base) return null;
    return crypto.createHmac('sha256', base).update('cardstreet-support-reply-v1').digest();
}

function signature(role: ReplyRole, ticketId: string): string | null {
    const key = signingKey();
    if (!key) return null;
    return crypto.createHmac('sha256', key).update(`${role}:${ticketId.toLowerCase()}`).digest('hex').slice(0, 16);
}

/** `local+token@domain` for the configured inbound address, or null when unset. */
export function replyAddress(role: ReplyRole, ticketId: string): string | null {
    const inbound = (process.env.SUPPORT_INBOUND_ADDRESS || '').trim();
    const m = inbound.match(/^([^@+\s]+)(?:\+[^@\s]*)?@([^@\s]+)$/);
    if (!m) return null;
    const sig = signature(role, ticketId);
    if (!sig) return null;
    const token = `${ROLE_CHAR[role]}${ticketId.toLowerCase().replace(/-/g, '').slice(0, 8)}${sig}`;
    const local = `${m[1]}+${token}`;
    if (local.length > 64) {
        console.warn(`[supportEmail] reply address local part is ${local.length} chars (limit 64); some mail servers may refuse it`);
    }
    return `${local}@${m[2]}`;
}

export interface ReplyTicket {
    id: string;
    user_id: string;
    status: string;
    subject: string;
}

export interface ParsedReplyToken {
    role: ReplyRole;
    /** First 8 hex of the ticket id. */
    prefix: string;
    sig: string;
}

export function parseReplyToken(rawToken: string): ParsedReplyToken | null {
    const m = rawToken.trim().toLowerCase().match(TOKEN_RE);
    if (!m) return null;
    return { role: m[1] === 'a' ? 'admin' : 'user', prefix: m[2], sig: m[3] };
}

/** Whether a parsed token was minted for this ticket. Constant-time. */
export function tokenMatchesTicket(token: ParsedReplyToken, ticketId: string): boolean {
    if (!ticketId.toLowerCase().startsWith(token.prefix)) return false;
    const expected = signature(token.role, ticketId);
    if (!expected) return false;
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(token.sig, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Resolve a token from an inbound email to its ticket and role, or null when
 * it is malformed, forged, or names no ticket.
 */
export async function resolveReplyToken(rawToken: string): Promise<{ role: ReplyRole; ticket: ReplyTicket } | null> {
    const token = parseReplyToken(rawToken);
    if (!token) return null;

    // uuid ordering is bytewise, so the prefix maps to one contiguous range.
    const admin = createAdminClient();
    const { data: candidates } = await admin
        .from('support_tickets')
        .select('id, user_id, status, subject')
        .gte('id', `${token.prefix}-0000-0000-0000-000000000000`)
        .lte('id', `${token.prefix}-ffff-ffff-ffff-ffffffffffff`)
        .limit(20);

    const ticket = ((candidates ?? []) as ReplyTicket[]).find((t) => tokenMatchesTicket(token, t.id));
    return ticket ? { role: token.role, ticket } : null;
}

// ─── Inbox alert ─────────────────────────────────────────────────────────────

type InboxEvent =
    | { kind: 'new' }
    | { kind: 'reply'; message: string; via: 'app' | 'email' };

function bangkokTime(iso: string | null | undefined): string {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
}

function translatedBlock(label: string, original: string, translation: Translation | null | undefined): string[] {
    if (!translation) return [label ? `${label}: ${original}` : original];
    return [
        `${label ? `${label}: ` : ''}${translation.text}`,
        '',
        `[Original, ${languageName(translation.sourceLang)}]`,
        original,
    ];
}

/**
 * Email the support inbox about a ticket event. Best-effort: never throws, so
 * callers can fire it from `after()` without guarding.
 */
export async function notifySupportInbox(ticketId: string, event: InboxEvent): Promise<void> {
    try {
        const admin = createAdminClient();
        const { data: ticket } = await admin
            .from('support_tickets')
            .select('id, user_id, subject, description, category, created_at')
            .eq('id', ticketId)
            .maybeSingle();
        if (!ticket) return;

        const [{ data: profile }, authRes] = await Promise.all([
            admin.from('profiles').select('display_name, username').eq('id', ticket.user_id).maybeSingle(),
            admin.auth.admin.getUserById(ticket.user_id),
        ]);
        const customerEmail = authRes.data?.user?.email ?? null;
        const name = profile?.display_name || profile?.username || 'Customer';
        const who = customerEmail ? `${name} <${customerEmail}>` : name;

        const text = event.kind === 'new' ? ticket.description : event.message;
        const tr = await translateTexts([
            { id: 'subject', text: ticket.subject },
            { id: 'text', text },
        ], 'en');

        const shortId = ticket.id.slice(0, 8).toUpperCase();
        const enSubject = tr.subject?.text;
        // Same subject for every alert on a ticket, so mail clients thread them.
        const mailSubject = `[Ticket #${shortId}] ${enSubject ? `${enSubject} (${ticket.subject})` : ticket.subject}`;

        const adminReply = replyAddress('admin', ticket.id);
        const replyTo = adminReply ?? customerEmail;
        const howToAnswer = adminReply
            ? 'To answer, reply to this email. Your reply is posted on the ticket and the customer gets it by email and in the app. It is sent as you write it; to send a Thai translation, answer from the admin console instead.'
            : customerEmail
                ? 'Replying to this email writes to the customer directly. It is NOT recorded on the ticket; answer from the admin console to keep the conversation there.'
                : 'This customer has no email on file. Answer from the admin console.';

        const lines = event.kind === 'new'
            ? [
                `New support ticket from ${who}`,
                `Category: ${ticket.category} · Opened ${bangkokTime(ticket.created_at)} (Bangkok)`,
                '',
                `Subject: ${enSubject ?? ticket.subject}`,
                '',
                ...translatedBlock('', text, tr.text),
            ]
            : [
                `${who} replied on ticket #${shortId}${event.via === 'email' ? ' (by email)' : ''}`,
                `Subject: ${enSubject ?? ticket.subject} · ${bangkokTime(null)} (Bangkok)`,
                '',
                ...translatedBlock('', text, tr.text),
            ];
        if (tr.text) lines.push('', '(English text above is a machine translation.)');
        lines.push(
            '',
            '----',
            howToAnswer,
            `Admin console: ${appBaseUrl()}/admin/tickets?ticket=${ticket.id}`,
        );

        await sendSupportInboxAlert({
            to: supportInboxEmail(),
            subject: mailSubject,
            body: lines.join('\n'),
            replyTo,
            ticketId: ticket.id,
            kind: event.kind,
        });
    } catch (e) {
        console.error(`[supportEmail] inbox alert for ticket ${ticketId} failed:`, e);
    }
}

/**
 * Email + push the ticket owner the team's answer. Best-effort, never throws.
 */
export async function notifyCustomerOfReply(ticketId: string, body: string): Promise<void> {
    try {
        const admin = createAdminClient();
        const { data: ticket } = await admin
            .from('support_tickets')
            .select('id, user_id, subject')
            .eq('id', ticketId)
            .maybeSingle();
        if (!ticket?.user_id) return;
        await sendSupportReplyNotification(ticket.user_id, {
            ticketId: ticket.id,
            subject: ticket.subject,
            body,
            replyTo: replyAddress('user', ticket.id) ?? supportInboxEmail(),
        });
    } catch (e) {
        console.error(`[supportEmail] reply notification for ticket ${ticketId} failed:`, e);
    }
}
