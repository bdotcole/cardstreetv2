/**
 * Parsing for Postmark inbound replies to support emails
 * (app/api/webhooks/support-email). Pure functions, no I/O.
 */

interface PostmarkAddress { Email?: string; MailboxHash?: string }

export interface PostmarkInbound {
    From?: string
    FromFull?: PostmarkAddress
    Subject?: string
    MailboxHash?: string
    OriginalRecipient?: string
    ToFull?: PostmarkAddress[]
    CcFull?: PostmarkAddress[]
    BccFull?: PostmarkAddress[]
    TextBody?: string
    HtmlBody?: string
    StrippedTextReply?: string
    Headers?: { Name?: string; Value?: string }[]
}

// Shape of the token lib/supportEmail.ts puts after the "+": role char,
// 8 hex of ticket id, 16 hex of HMAC.
const TOKEN_SHAPE = /^[au][0-9a-f]{24}$/i

/** The reply token from wherever the reply address landed (To, Cc or Bcc). */
export function findReplyToken(p: PostmarkInbound): string | null {
    const candidates: (string | undefined)[] = [
        p.MailboxHash,
        ...(p.ToFull ?? []).map((a) => a.MailboxHash),
        ...(p.CcFull ?? []).map((a) => a.MailboxHash),
        ...(p.BccFull ?? []).map((a) => a.MailboxHash),
        p.OriginalRecipient?.match(/\+([^@]+)@/)?.[1],
    ]
    for (const c of candidates) {
        const v = (c ?? '').trim()
        if (TOKEN_SHAPE.test(v)) return v
    }
    return null
}

/**
 * Vacation responders and other robots answer the Reply-To too; posting those
 * onto a ticket would email the other side and could loop.
 */
export function isAutoReply(p: PostmarkInbound): boolean {
    const header = (name: string) =>
        (p.Headers ?? []).find((h) => (h.Name ?? '').toLowerCase() === name)?.Value?.trim().toLowerCase() ?? ''
    const autoSubmitted = header('auto-submitted')
    if (autoSubmitted && autoSubmitted !== 'no') return true
    if (header('x-autoreply') || header('x-autorespond')) return true
    if (/^(bulk|junk|list|auto_reply)$/.test(header('precedence') || header('x-precedence'))) return true
    return /^(auto(matic)?[ -]?reply|out of (the )?office|ตอบกลับอัตโนมัติ)/i.test((p.Subject ?? '').trim())
}

function htmlToText(html: string): string {
    return html
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
}

const QUOTE_INTRO_END = /(wrote|เขียนว่า):?$/

/**
 * Fallback for when Postmark could not isolate the new text itself: cut at the
 * first quote header ("On ... wrote:", Thai Gmail's "... เขียนว่า:", Outlook's
 * "From:" block, a "-- " signature) or quoted ">" line.
 */
export function stripQuoted(text: string): string {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const out: string[] = []
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim()
        const next = (lines[i + 1] ?? '').trim()
        if (t.startsWith('>')) break
        // Gmail wraps a long "On <date> <name> <address> wrote:" onto two lines.
        if (/^(On|เมื่อ|ใน)\s/.test(t) && (QUOTE_INTRO_END.test(t) || QUOTE_INTRO_END.test(next))) break
        if (/(wrote|เขียนว่า):$/.test(t)) break
        if (/^-{2,}\s*(Original Message|Forwarded message)/i.test(t)) break
        // Outlook's header block, told apart from a sentence starting "From:"
        // by the Sent/Date/To/Subject lines that follow it.
        if (/^From:\s/i.test(t) && lines.slice(i + 1, i + 5).some((l) => /^(Sent|Date|To|Subject):\s/i.test(l.trim()))) break
        if (lines[i] === '-- ' || t === '--') break
        out.push(lines[i])
    }
    return out.join('\n')
}

/** The new text of a reply, without the quoted thread or a phone signature. */
export function replyText(p: PostmarkInbound): string {
    const stripped = (p.StrippedTextReply ?? '').trim()
    const raw = stripped || stripQuoted(p.TextBody?.trim() ? p.TextBody : htmlToText(p.HtmlBody ?? ''))
    return raw
        .replace(/^\s*Sent from my .+$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 5000)
}
