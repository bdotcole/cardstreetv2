# Courier dashboard — push copy fixes (drafted 2026-08-28)

Push QC on 2026-08-27 (verified against Courier's rendered-output API) found that the
four dashboard templates deliver push bodies with raw URLs, order UUIDs, a literal
`xxx` placeholder, and missing spaces. Inline (code-owned) sends were fixed in
`lib/courier.ts` the same day; the four templates below can only be fixed in the
Courier dashboard (Content → Templates → open the template → click the **Push**
channel tab → edit the title and the body block shown there → **Publish**).

## How the templates render push (learned the hard way)

- The push channel defines only a **title**; the push **body** comes from the text
  block bound to the Push tab (the *second* of the two near-duplicate blocks in each
  of these templates — confirmed by matching rendered output to block markup).
- The email body is a *separate* block — editing the push block does not touch email.
- Variables must be inserted as **tokens** (type `{` and pick from the list). Braces
  typed as plain text are NOT substituted — that is exactly why the Shipped and
  Order Confirmed pushes have been delivering a literal `xxx`, and why the Label
  email's English line shows raw `{orderDetails.id}` today.
- Email subjects are forced from code via a Postmark override (`SUBJECTS` in
  `lib/courier.ts`), so retitling the push channel does not affect email subjects.

## 1. Sold — `BATFJT2XTH4YAHJNK96A3MG762DQ`

- Push **title** (replace `CardStreet: คุณมีคำสั่งซื้อใหม่ You have a new sale!`):

  > คุณมีคำสั่งซื้อใหม่ — New sale!

- Push **body** (replace the whole block; `{orderDetails.total_amount}` as a token):

  > ขายได้ในราคา {orderDetails.total_amount} บาท — เปิดแอปเพื่อเตรียมจัดส่ง · Open the app to arrange shipping.

  (Also retires the current block's missing-space render: "sold for 131THB".)

## 2. Shipping label — `000AHF66DDMCJVMGZJK5P8Q2824Z`

- Push **title** (replace `CardStreet: สร้างใบปะหน้าพัสดุสำเร็จ Shipping Label Generated!`):

  > ใบปะหน้าพัสดุพร้อมแล้ว — Label ready

- Push **body** (replace the whole block — currently order UUID ×2 + full URL ×2):

  > เปิดแอปเพื่อพิมพ์ใบปะหน้าและจัดส่งได้เลย · Open the app to print your label and ship.

  The PDF-attachment mention stays in the email, where the attachment actually is.

- **While in this template**: in the EMAIL block, the English sentence's
  `{orderDetails.id}` and `{labelUrl}` are plain text, so subscribers see the raw
  braces. Delete both and re-insert them as variable tokens (the Thai sentence and
  the push block already use tokens — copy how those look). No code change can fix
  this; see the long comment in `sendLabelGeneratedNotification`.

## 3. Shipped — `PN39K94HQS47C4GTEGVSDD7GFMPR`

- Push **title** (replace `CardStreet: สินค้าถูกจัดส่งแล้ว Order Shipped!`):

  > สินค้าถูกจัดส่งแล้ว — Order shipped!

- Push **body** (replace the block that renders `...track your shipment here: xxx`;
  `{trackingNumber}` as a token — the send already passes it):

  > พัสดุ {trackingNumber} กำลังเดินทางถึงคุณ — ติดตามสถานะได้ในแอป · On the way — track it in the app.

## 4. Order confirmed — `WAE55N73MYM5CAGN7GTWQT7XPN8B`

- Push **title** (replace `CardStreet: ยืนยันคำสั่งซื้อ Order Confirmed!`):

  > ยืนยันคำสั่งซื้อแล้ว — Order confirmed!

- Push **body** (replace the block that renders `...here: xxx`; no variable — at
  confirmation time tracking numbers can still be empty):

  > ขอบคุณสำหรับคำสั่งซื้อ — ติดตามสถานะพัสดุได้ในแอป · Thanks for your order — track it in the app.

## House rules for push copy (apply to future templates too)

- **Title carries the signal**, and the signal goes first — trays truncate the tail.
  No `CardStreet:` prefix (the OS already shows the app name and icon).
- **Body is one short line**, roughly ≤ 90 characters per language pair.
- **Never a URL, UUID, or email address in visible push text.** Taps deep-link from
  the message `data` payload (`hooks/usePushNotifications.ts`); links belong in the
  email CTA button only.
- Bilingual = one short Thai clause `·` one short English clause, not two paragraphs.
- Code-owned (inline) push copy lives in `lib/courier.ts` — the
  `emailPlusPushContent` helper gives email and push different bodies in one send;
  its per-element `channels` scoping was verified against Courier's live renderer
  on 2026-08-28. The TH payout copy is duplicated in
  `supabase/functions/release-funds/index.ts` — change both together.
