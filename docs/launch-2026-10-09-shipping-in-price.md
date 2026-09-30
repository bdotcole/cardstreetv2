# Launch: shipping inside the listing price + shop minimum order

**Go-live: Friday, October 9, 2026 at 12:00 am Bangkok time** (Thursday, October 8, 1:00 pm US Eastern).

Status on 2026-09-30: built, held, not on main. Rebased onto main `9303b7a8` on branch
`claude/strange-leakey-13a174`: shipping in price, then shop minimum order. The original
commits (`328516bc`, `a359ea49`) remain on `claude/account-ban-unusual-activity-0a3df4`.

The copy below matches the QC'd Claude Doc "Thai QC: Oct 9 launch emails and pushes" at
rev 26. That doc is the source of truth; edit it first, then this file.

## Send schedule

All times Bangkok (ICT, UTC+7). US Eastern is 11 hours behind.

| # | What | Audience | Bangkok | US Eastern |
|---|------|----------|---------|------------|
| 1 | Email 1: announcement | All users | Wed Sep 30, 10:00 | Tue Sep 29, 23:00 |
| 2 | Email 2: reminder | All users | Mon Oct 5, 10:00 | Sun Oct 4, 23:00 |
| 3 | Push 1: 48 hours | Sellers with listings | Wed Oct 7, 00:00 | Tue Oct 6, 13:00 |
| 4 | Email 3: 24 hours | All users | Thu Oct 8, 00:00 | Wed Oct 7, 13:00 |
| 5 | Push 2: 24 hours | Sellers with listings | Thu Oct 8, 00:00 | Wed Oct 7, 13:00 |
| 6 | Go-live + Email 4 | All users | Fri Oct 9, 00:00 | Thu Oct 8, 13:00 |

Audience on 2026-09-29: 1,302 accounts, 1,089 with a deliverable email, 187 on Apple
private-relay addresses that bounce, 479 with a push token. Sellers with listings: 47, of
whom 38 are emailable and 28 have a push token.

## Go-live runbook (Oct 9, 00:00 Bangkok)

1. About 23:50, push the code: `git push origin HEAD:main`. Wait for the Vercel deploy.
2. Run `supabase/migrations/20260929_shop_min_order.sql` in the Supabase SQL Editor.
3. At 00:00 run the price increase:

```sql
UPDATE listings
SET price = price + 40, updated_at = now()
WHERE status IN ('active', 'draft', 'paused');
```

4. Send Email 4.

The code fails soft without the column, so steps 1 and 2 can swap.

---

## Email 1 — Wednesday, September 30 (announcement)

### Thai

**Subject:** Cardstreet: ราคาเดียวรวมค่าส่ง เริ่ม 9 ต.ค.

**Preview:** ราคาที่เห็นคือราคาที่จ่าย และร้านค้าตั้งยอดสั่งซื้อขั้นต่ำได้

สวัสดีครับ นักสะสมทุกท่าน

เรากำลังทำให้การซื้อขายบน Cardstreet ง่ายขึ้น ตั้งแต่ **วันศุกร์ที่ 9 ตุลาคม 2569 เวลา 00:00 น.** ราคาที่แสดงบนรายการขายคือราคาที่ผู้ซื้อจ่ายจริง รวมค่าส่งแล้ว ไม่มีค่าใช้จ่ายเพิ่มตอนชำระเงิน

**สำหรับผู้ซื้อ**

- **ราคาที่เห็นคือราคาที่จ่าย** ไม่มีค่าส่งเพิ่มตอนชำระเงิน
- **บางร้านมียอดสั่งซื้อขั้นต่ำ** ตะกร้าจะบอกว่าต้องเพิ่มอีกเท่าไรจากร้านนั้นจึงจะชำระเงินได้ เหมาะกับการเก็บการ์ดราคาถูกหลายใบเพื่อจัดเด็คหรือเก็บให้ครบชุดในพัสดุเดียว

**สำหรับผู้ขาย**

- **ระบบจะบวก ฿40 ให้ทุกรายการที่ลงขายอยู่โดยอัตโนมัติ ในเวลา 00:00 น. วันที่ 9 ตุลาคม** เพื่อไม่ให้ผู้ขายต้องออกค่าส่งเอง
- **ยังไม่ต้องปรับราคาก่อนวันดังกล่าว** หากขึ้นราคาเองก่อน ราคาจะถูกบวกซ้ำอีก ฿40 หลังวันที่ 9 ตุลาคม คุณปรับราคาขึ้นหรือลงได้ทุกเมื่อ
- **รายการใหม่หลังวันที่ 9 ตุลาคม** ให้ตั้งราคารวมค่าส่งและค่าแพ็กแล้ว Flash Express อยู่ที่ประมาณ ฿30-40 ต่อพัสดุ
- **ใหม่: ตั้งยอดสั่งซื้อขั้นต่ำของร้านได้** เช่น ลงการ์ดคอมมอนใบละ ฿10 แล้วตั้งขั้นต่ำ ฿100 ออเดอร์สิบใบก็ยังมีกำไรในพัสดุเดียว ตั้งค่าได้ที่ โปรไฟล์ > บัญชีผู้ขาย (บนเดสก์ท็อป: หน้าขาย) ข้อเสนอราคาที่คุณกดรับจะไม่ติดขั้นต่ำ
- **การจัดส่งเหมือนเดิม** ใบจัดส่ง การเข้ารับพัสดุ และการติดตามผ่าน Flash Express ไม่มีอะไรเปลี่ยน

**อัปเดตอื่น ๆ บน Cardstreet**

- **หยุดร้านชั่วคราว** กดครั้งเดียวเพื่อซ่อนทุกรายการ และกดอีกครั้งเพื่อเปิดร้านกลับมา
- **เลือกจำนวนได้** การ์ดใบเดียวกันหลายใบแสดงเป็นรายการเดียวพร้อมตัวเลือกจำนวน
- **ชุด 30th CELEBRATION มาแล้ว** พร้อมราคาที่อัปเดตทุกคืน
- **ราคาแม่นยำขึ้น** ราคาตลาดแสดงราคาล่าสุดจริง และสินค้าซีลมีกราฟราคาย้อนหลัง

มีคำถาม ตอบกลับอีเมลนี้ หรือเขียนถึงเราที่ support@thailandtcg.com

ขอบคุณที่สะสมไปกับเรา
ทีม Cardstreet

### English

**Subject:** Cardstreet: one price, shipping included, from October 9

**Preview:** The price you see is the price you pay, and shops can set a minimum order.

Hi collectors,

We're making buying and selling on Cardstreet simpler. From **Friday, October 9, 2026 at 12:00 am Bangkok time**, the price on a listing is the price the buyer pays. Shipping is included. Nothing is added at checkout.

**If you buy**

- **The price you see is the price you pay.** No shipping line at checkout.
- **Some shops have a minimum order.** Your cart tells you how much more to add from that shop before you can check out. It is the easy way to pick up a stack of cheap singles for a deck or a set in one parcel.

**If you sell**

- **We will add ฿40 to every existing listing automatically at 12:00 am on October 9,** so no seller is left paying postage out of pocket.
- **Please don't raise your prices before then.** If you do, the ฿40 lands on top. After October 9 you can lower or raise any price whenever you like.
- **New listings after October 9** should be priced with shipping and handling included. Flash Express runs about ฿30-40 a parcel.
- **New: set a minimum order for your shop.** List commons at ฿10 each, set a ฿100 minimum, and a ten-card order still earns you money on one parcel. Find it in Profile > Seller Account (on desktop: Sell). Offers you accept are exempt.
- **Shipping itself is unchanged.** Labels, pickup and tracking through Flash Express work exactly as before.

**Also new on Cardstreet**

- **Pause your shop.** One tap hides every listing, and one tap brings them back.
- **Quantity picker.** Identical copies of a card show as one listing with a quantity.

Questions? Reply to this email or write to support@thailandtcg.com.

Thank you for collecting with us.
The Cardstreet team

---

## Email 2 — Monday, October 5 (reminder)

### Thai

**Subject:** อีก 4 วัน: ราคาเดียวรวมค่าส่งบน Cardstreet

**Preview:** เริ่มวันศุกร์ที่ 9 ต.ค. เวลา 00:00 น.

สวัสดีครับ

เตือนอีกครั้ง ตั้งแต่ **วันศุกร์ที่ 9 ตุลาคม เวลา 00:00 น.** ทุกราคาบน Cardstreet จะรวมค่าส่งแล้ว ผู้ซื้อจ่ายเท่าที่เห็น

**ผู้ขายควรรู้ 3 ข้อ**

1. **ระบบบวก ฿40 ให้ทุกรายการโดยอัตโนมัติ** ในเวลาที่เปลี่ยน ยังไม่ต้องขึ้นราคาเองก่อน
2. **หลังวันที่ 9 ตุลาคม ตรวจราคาของคุณ** แล้วปรับขึ้นหรือลงได้ตามต้องการ
3. **ตั้งยอดสั่งซื้อขั้นต่ำของร้าน** ที่ โปรไฟล์ > บัญชีผู้ขาย เพื่อให้ลงการ์ดราคาถูกได้โดยไม่ขาดทุนค่าส่ง

**ผู้ซื้อไม่ต้องทำอะไร** ราคาที่เห็นคือราคาที่จ่าย

มีคำถาม ตอบกลับอีเมลนี้ หรือเขียนถึงเราที่ support@thailandtcg.com

ทีม Cardstreet

### English

**Subject:** 4 days to go: one price, shipping included

**Preview:** Starts Friday, October 9 at 12:00 am Bangkok time.

Hi,

A reminder: from **Friday, October 9 at 12:00 am Bangkok time**, every price on Cardstreet includes shipping. Buyers pay what they see.

**Three things for sellers**

1. **We add ฿40 to every listing automatically** at the moment of the change. Please don't raise prices yourself before then.
2. **After October 9, review your prices** and lower or raise them as you like.
3. **Set a minimum order for your shop** in Profile > Seller Account, so cheap singles are worth listing.

**Buyers have nothing to do.** The price you see is the price you pay.

Questions? Reply to this email or write to support@thailandtcg.com.

The Cardstreet team

---

## Email 3 — Thursday, October 8, 00:00 (24 hours before)

### Thai

**Subject:** พรุ่งนี้: ทุกราคาบน Cardstreet รวมค่าส่ง

**Preview:** เปลี่ยนคืนนี้เวลา 00:00 น. วันที่ 9 ต.ค.

สวัสดีครับ

อีก 24 ชั่วโมง ในเวลา **00:00 น. วันศุกร์ที่ 9 ตุลาคม** ทุกราคาบน Cardstreet จะรวมค่าส่งแล้ว

- **ผู้ขาย:** ทุกรายการของคุณจะถูกบวก ฿40 โดยอัตโนมัติ เมื่อเปลี่ยนแล้วเข้าไปตรวจราคาและตั้งยอดสั่งซื้อขั้นต่ำของร้านได้ที่ โปรไฟล์ > บัญชีผู้ขาย
- **ผู้ซื้อ:** ไม่มีค่าส่งเพิ่มตอนชำระเงินอีกต่อไป

มีคำถาม ตอบกลับอีเมลนี้ได้เลย

ทีม Cardstreet

### English

**Subject:** Tomorrow: every Cardstreet price includes shipping

**Preview:** The change happens at 12:00 am on October 9, Bangkok time.

Hi,

In 24 hours, at **12:00 am on Friday, October 9 (Bangkok time)**, every price on Cardstreet will include shipping.

- **Sellers:** ฿40 is added to each of your listings automatically. Once it's live, review your prices and set your shop's minimum order in Profile > Seller Account.
- **Buyers:** no more shipping charge at checkout.

Questions? Just reply to this email.

The Cardstreet team

---

## Email 4 — Friday, October 9, 00:00 (live)

### Thai

**Subject:** เริ่มแล้ว: ราคาเดียวรวมค่าส่งบน Cardstreet

**Preview:** ราคาที่เห็นคือราคาที่จ่าย ตั้งแต่ตอนนี้

สวัสดีครับ

เริ่มแล้วตั้งแต่ตอนนี้ ทุกราคาบน Cardstreet รวมค่าส่ง ผู้ซื้อจ่ายเท่าที่เห็น

**ผู้ขาย ทำ 2 อย่างนี้วันนี้**

1. **ตรวจราคาของคุณ** เราบวก ฿40 ให้ทุกรายการแล้ว ปรับขึ้นหรือลงได้ที่คลังการ์ด
2. **ตั้งยอดสั่งซื้อขั้นต่ำของร้าน** ที่ โปรไฟล์ > บัญชีผู้ขาย (บนเดสก์ท็อป: หน้าขาย)

**ผู้ซื้อ** เลือกการ์ด ใส่ตะกร้า แล้วจ่ายตามราคาที่เห็น ถ้าร้านมียอดขั้นต่ำ ตะกร้าจะบอกว่าต้องเพิ่มอีกเท่าไร

ขอบคุณที่สะสมไปกับเรา
ทีม Cardstreet

### English

**Subject:** It's live: one price, shipping included

**Preview:** The price you see is the price you pay, starting now.

Hi,

It's live. Every price on Cardstreet now includes shipping, and buyers pay what they see.

**Sellers, two things to do today**

1. **Review your prices.** We added ฿40 to every listing. Lower or raise any of them from your vault.
2. **Set your shop's minimum order** in Profile > Seller Account (on desktop: Sell).

**Buyers:** pick your cards, add them to your cart, and pay the price you see. If a shop has a minimum, your cart tells you how much more to add.

Thank you for collecting with us.
The Cardstreet team

---

## Push 1 — Wednesday, October 7, 00:00 (48 hours, sellers)

| | Title | Body |
|---|---|---|
| Thai | อีก 48 ชม. ราคารวมค่าส่ง | 9 ต.ค. 00:00 น. ระบบบวก ฿40 ให้ทุกรายการของคุณอัตโนมัติ ยังไม่ต้องขึ้นราคาเอง ตั้งยอดขั้นต่ำของร้านได้ที่โปรไฟล์ |
| English | 48 hours: prices will include shipping | At 12:00 am Oct 9 we add ฿40 to each of your listings. No need to raise prices yourself. Set your shop minimum in Profile. |

Opens: the seller's vault (`/?view=vault`).

## Push 2 — Thursday, October 8, 00:00 (24 hours, sellers)

| | Title | Body |
|---|---|---|
| Thai | พรุ่งนี้ ราคารวมค่าส่ง | คืนนี้ 00:00 น. ทุกรายการของคุณ +฿40 อัตโนมัติ หลังเปลี่ยนแล้วเข้ามาตรวจราคาและตั้งยอดขั้นต่ำของร้าน |
| English | Tomorrow: prices include shipping | At 12:00 am tonight ฿40 is added to each of your listings. After the change, review your prices and set your shop minimum. |

Opens: the seller's vault (`/?view=vault`).
