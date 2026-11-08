// The admin Support inbox (/admin/inbox): one list for everything users send
// the team. Shared types for /api/admin/inbox and the page.
//
//   dm      a chat with the "Cardstreet TCG Marketplace" support shop
//   ticket  Profile → Support, and buyer problem reports on an order
//   report  a listing or seller reported from the app

export type InboxKind = 'dm' | 'ticket' | 'report'

export interface InboxPerson {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
}

export interface InboxReport {
    reason: string
    description: string | null
    entityType: string
    entityId: string
    entityName: string | null
    listing: {
        id: string
        cardId: string | null
        cardName: string | null
        photo: string | null
        price: number | null
        status: string | null
    } | null
    /** The seller of the reported listing, or the reported seller. */
    target: InboxPerson | null
}

export interface InboxItem {
    /** `${kind}:${id}`, also the ?open= deep-link value. */
    key: string
    kind: InboxKind
    id: string
    person: InboxPerson | null
    /** Ticket subject or report reason; DMs have none. */
    title: string | null
    preview: string | null
    previewFromTeam: boolean
    lastAt: string
    /** Ticket: Open / In Progress / Resolved. Report: Open / Reviewed / Resolved / Dismissed. DM: ''. */
    status: string
    /** The last word is the user's (DM, open ticket) or the report is still open. */
    needsReply: boolean
    /** DM only: arrived since the team last opened it. */
    unread: boolean
    category: string | null
    /** A buyer problem report's order. */
    orderId: string | null
    report: InboxReport | null
}

export const inboxKey = (kind: InboxKind, id: string) => `${kind}:${id}`

export function parseInboxKey(value: string | null | undefined): { kind: InboxKind; id: string } | null {
    const m = /^(dm|ticket|report):([0-9a-f-]{36})$/i.exec(value ?? '')
    return m ? { kind: m[1].toLowerCase() as InboxKind, id: m[2].toLowerCase() } : null
}

export const personName = (p: InboxPerson | null | undefined) =>
    p?.display_name?.trim() || p?.username || 'Unknown user'
