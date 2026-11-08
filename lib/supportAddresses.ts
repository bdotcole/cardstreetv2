/**
 * The three addresses the team's mail goes to or names. No imports, so both
 * lib/courier.ts and lib/supportEmail.ts (which imports courier) can read them.
 *
 * - supportInboxEmail: where everything users send the team lands, and where
 *   every order alert goes: ticket and problem-report emails, support-shop
 *   chat alerts, the 72h unshipped-order page. ONE inbox, read next to the
 *   admin Support inbox (/admin/inbox) and the order lookup (/admin/orders).
 *   Before 2026-11-08 these were split across the founder's personal Gmail,
 *   the support shop's sign-in address and info@.
 * - founderAlertEmail: business signals that are not support (a partner
 *   activated their mailed kit, a breaker application), per the founder's
 *   2026-11-07 ask to keep them off his personal address.
 * - customerSupportEmail: the contact address printed in customer emails.
 *   Defaults to the inbox address so a reply lands where the team reads.
 */
export function supportInboxEmail(): string {
    return (process.env.SUPPORT_INBOX_EMAIL || 'info@cardstreet.app').trim();
}

export function founderAlertEmail(): string {
    return (process.env.FOUNDER_ALERT_EMAIL || 'brandon@cardstreet.app').trim();
}

export function customerSupportEmail(): string {
    return (process.env.CARDSTREET_SUPPORT_EMAIL || supportInboxEmail()).trim();
}
