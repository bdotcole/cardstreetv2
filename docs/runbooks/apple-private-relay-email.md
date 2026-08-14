# Fixing Apple Private Relay email bounces

**Status: open — needs dashboard + DNS work. No code change involved.**

## The problem

Every transactional email CardStreet sends to an `@privaterelay.appleid.com`
address is rejected. Courier records the bounce verbatim as:

```
smtp; 550 5.1.1 <pm_bounces@pm.mtasv.net>: unauthorized sender
```

Measured 2026-08-14 against the live DB and the Courier message log:

- **123 of 881 auth accounts (14%) sign in with Apple's Hide My Email.**
- Those accounts had made 14 offers and placed **0 orders**.
- It affects *all* mail, not just offers: order confirmations, shipping
  notices, sold notifications, offer accepted/countered/expired.
- Two of the three most recent accepted offers went to such a buyer; both
  acceptance emails bounced, and neither offer was ever paid.

## Why it happens

Apple's relay only forwards mail from senders registered with the Apple
Developer team behind Sign in with Apple. It checks the **envelope sender
(Return-Path) domain**, not just the visible `From:`.

Postmark's default Return-Path is `pm_bounces@pm.mtasv.net` — a Postmark-owned
domain that can never be registered under a CardStreet Apple team. So Apple
rejects it outright, no matter what the `From:` header says.

Verified DNS state for `cardstreet.app` on 2026-08-14:

| Record | State |
|---|---|
| `pm-bounces.cardstreet.app` CNAME | **missing** — no custom Return-Path configured in Postmark |
| SPF (`v=spf1 ...`) TXT | **missing** — only two `google-site-verification` TXTs exist |
| `_dmarc.cardstreet.app` | **missing** |
| `apple-domain-verification=...` TXT | **missing** |

## The fix

### Step 0 — confirm the sending address

Open any CardStreet email that *did* deliver (a Gmail recipient), and use
"Show original" / "View source". Note two values:

- the `From:` address
- the `Return-Path:` — this is currently expected to read `pm_bounces@pm.mtasv.net`

If `From:` is not `@cardstreet.app`, use whatever domain it *is* in the steps
below. Courier holds this in its Postmark integration settings; Postmark holds
it as the Sender Signature.

### Step 1 — give Postmark a custom Return-Path (DNS)

In Postmark: **Sending → Domains → cardstreet.app → Return-Path**. Postmark
shows a hostname to add. Create it at the DNS host:

```
pm-bounces.cardstreet.app.   CNAME   pm.mtasv.net.
```

Click Verify in Postmark. The envelope sender then becomes
`pm-bounces@cardstreet.app` — a domain you control and can register with Apple.

While in that screen, confirm **DKIM** is verified for the domain too; Apple
wants the mail authenticated.

### Step 2 — publish SPF (DNS)

There is no SPF record at all today. Add one TXT record at the apex:

```
cardstreet.app.   TXT   "v=spf1 a mx include:spf.mtasv.net ~all"
```

`spf.mtasv.net` is Postmark's include. If any other service sends as
`@cardstreet.app` (Google Workspace, etc.) merge its include into this **single**
record — a domain may only have one SPF record.

### Step 3 — register the domain with Apple

Apple Developer → **Certificates, Identifiers & Profiles → Identifiers →**
select the Services ID / App ID used for Sign in with Apple → **Sign in with
Apple → Configure → Email Sources**.

- Add `cardstreet.app` under **Domains**.
- Add the exact `From:` address from Step 0 under **Email Addresses**.
- Apple returns an `apple-domain-verification=...` value. Publish it as a TXT
  record at the apex, then press Verify in the Apple portal.

Apple will not verify a domain that lacks SPF, so Step 2 must land first.

### Step 4 — verify

Send yourself a test to a Hide My Email address, then confirm in the Courier
log that it reports `DELIVERED` rather than `UNDELIVERABLE`. To re-check the
whole population afterwards, look for relay recipients in the message log —
before this fix, every one of them bounced.

### Optional but recommended — DMARC

Once SPF and DKIM both pass, add a monitoring-only DMARC record:

```
_dmarc.cardstreet.app.   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@cardstreet.app"
```

`p=none` changes no delivery behavior; it just reports who is sending as the
domain, which is how you'd catch a regression here.

## Note on retention

Courier's message log on the current plan only retains about 1.5 days, so
bounces older than that are not auditable after the fact. Check soon after a
send, or rely on Postmark's own bounce records.
