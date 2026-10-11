import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit } from '@/lib/rateLimit'
import { notifyCustomerOfReply, notifySupportInbox, resolveReplyToken } from '@/lib/supportEmail'
import { findReplyToken, isAutoReply, replyText, type PostmarkInbound } from '@/lib/supportInbound'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/support-email — Postmark inbound webhook.
 *
 * Every support email we send carries a Reply-To of
 * `<SUPPORT_INBOUND_ADDRESS local>+<token>@<domain>`; Postmark receives the
 * reply and posts it here as JSON, with the token in MailboxHash. The token
 * (lib/supportEmail.ts) is the authorization: it names the ticket and whether
 * the sender is the support team or the customer, and it is an HMAC nobody
 * else can mint. From headers are not trusted for anything.
 *
 *   team reply      -> admin message on the thread, ticket Open -> In Progress,
 *                      customer emailed + pushed
 *   customer reply  -> user message on the thread, Resolved -> Open,
 *                      support inbox emailed
 *
 * Postmark retries any non-2xx except 403, so a bad token answers 403 (stop)
 * and anything we deliberately skip answers 200.
 */
export async function POST(request: Request) {
    const payload = (await request.json().catch(() => null)) as PostmarkInbound | null
    if (!payload) return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })

    const token = findReplyToken(payload)
    const resolved = token ? await resolveReplyToken(token) : null
    if (!resolved) {
        console.warn('[support-email] rejected inbound mail without a valid reply token', {
            from: payload.FromFull?.Email ?? payload.From ?? null,
            hasToken: !!token,
        })
        return NextResponse.json({ error: 'unknown or invalid reply address' }, { status: 403 })
    }
    const { role, ticket } = resolved
    const from = payload.FromFull?.Email ?? payload.From ?? 'unknown'

    if (isAutoReply(payload)) {
        console.log(`[support-email] ignored auto-reply from ${from} on ticket ${ticket.id}`)
        return NextResponse.json({ ok: true, ignored: 'auto_reply' })
    }

    const body = replyText(payload)
    if (!body) return NextResponse.json({ ok: true, ignored: 'empty' })

    const rl = await checkRateLimit(`ticketmail:${ticket.id}:1h`, { windowSeconds: 3600, max: 30 })
    if (!rl.allowed) return NextResponse.json({ ok: true, ignored: 'rate_limited' })

    const admin = createAdminClient()
    const { error: insertErr } = await admin.from('support_ticket_messages').insert({
        ticket_id: ticket.id,
        // The team may answer from any mailbox that receives the inbox, so no
        // profile is attributable; the customer's own replies are theirs.
        sender_id: role === 'user' ? ticket.user_id : null,
        sender_role: role,
        body,
    })
    if (insertErr) {
        // 500 so Postmark retries; nothing else has happened yet.
        console.error(`[support-email] could not post reply on ticket ${ticket.id}:`, insertErr)
        return NextResponse.json({ error: 'could not post reply' }, { status: 500 })
    }

    if (role === 'admin') {
        // Mirrors the console reply for older app builds that read admin_reply.
        // An emailed answer has no status picker, so an Open ticket moves to In
        // Progress: answered, waiting on the customer.
        await admin.from('support_tickets').update({
            admin_reply: body,
            replied_at: new Date().toISOString(),
            ...(ticket.status === 'Open' ? { status: 'In Progress' } : {}),
        }).eq('id', ticket.id)
        after(() => notifyCustomerOfReply(ticket.id, body))
    } else {
        if (ticket.status === 'Resolved') {
            await admin.from('support_tickets').update({ status: 'Open' }).eq('id', ticket.id)
        }
        after(() => notifySupportInbox(ticket.id, { kind: 'reply', message: body, via: 'email' }))
    }

    console.log(`[support-email] posted ${role} reply from ${from} on ticket ${ticket.id}`)
    return NextResponse.json({ ok: true })
}
