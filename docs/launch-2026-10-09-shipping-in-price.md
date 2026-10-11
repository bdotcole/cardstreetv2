# Launch: shipping inside the listing price + shop minimum order

**Go-live: Friday, October 9, 2026 at 12:00 am Bangkok time** (Thursday, October 8, 1:00 pm US Eastern).

## What ships when

- **Now (before Email 1):** the shop minimum order and the scheduled sender. Needs
  `supabase/migrations/20260929_shop_min_order.sql` and
  `supabase/migrations/20260930_campaign_messages.sql`.
- **Oct 9, 00:00 Bangkok:** shipping inside the listing price, the +฿40 on every listing,
  and the go-live email.

## Send schedule

All times Bangkok (ICT, UTC+7). US Eastern is 11 hours behind. The schedule is the
`campaign_messages` table; `/api/cron/launch-campaign` sends whatever is due every ten
minutes, and the copy is in `lib/launchCampaign.ts`. The messages below are generated from
that file.

| # | What | Audience | Bangkok | US Eastern |
|---|------|----------|---------|------------|
| 1 | Email 1: announcement | All users | Thu Oct 1, 14:00 | Thu Oct 1, 03:00 |
| 2 | Email 2: reminder | All users | Mon Oct 5, 10:00 | Sun Oct 4, 23:00 |
| 3 | Push 1: 48 hours | Sellers with listings | Tue Oct 6, 18:00 | Tue Oct 6, 07:00 |
| 4 | Email 3: 24 hours | All users | Thu Oct 8, 00:00 | Wed Oct 7, 13:00 |
| 5 | Push 2: tonight | Sellers with listings | Thu Oct 8, 18:00 | Thu Oct 8, 07:00 |
| 6 | Go-live + Email 4 | All users | Fri Oct 9, 00:00 | Thu Oct 8, 13:00 |

Every email carries the Thai message with the English one beneath it, under the Thai
subject. Every push carries the Thai title and both bodies. Emails skip banned accounts,
partner placeholder addresses and Apple private-relay addresses. Admins get a preview copy
of all six as soon as the sender is deployed and its migration is run.

To move a send: `UPDATE campaign_messages SET send_at = '...' WHERE key = '...';`
To stop one: `UPDATE campaign_messages SET held = true WHERE key = '...';`
Keys: `shipping-email-1` to `-4`, `shipping-push-1`, `shipping-push-2`.

## Go-live runbook (Oct 9, 00:00 Bangkok)

1. About 23:50, push the code: `git push origin HEAD:main`. Wait for the Vercel deploy.
2. At 00:00 run this in the Supabase SQL Editor. It raises every listing by ฿40 and
   releases the go-live email, which the sender then delivers within ten minutes.

```sql
UPDATE listings
SET price = price + 40, updated_at = now()
WHERE status IN ('active', 'draft', 'paused');

UPDATE campaign_messages
SET held = false, send_at = now()
WHERE key = 'shipping-email-4';
```

After Oct 9, remove `/api/cron/launch-campaign`, its `vercel.json` entry and
`lib/launchCampaign.ts`.

---

## Email 1: announcement

**Sends:** Thursday, October 1, 14:00 Bangkok. All users.

**Subject:** Cardstreet: ราคาเดียวรวมค่าส่ง เริ่ม 9 ต.ค.

**Preview:** ราคาที่เห็นคือราคาที่จ่ายจริง และร้านค้าตั้งยอดสั่งซื้อขั้นต่ำได้

สวัสดีนักสะสมทุกท่าน

เรากำลังปรับปรุงระบบซื้อขายบน Cardstreet ให้ง่ายขึ้นอีกขั้น ตั้งแต่ **วันศุกร์ที่ 9 ตุลาคม 2569 เวลา 00:00 น.** ราคาที่แสดงบนรายการสินค้าคือราคาที่ผู้ซื้อจ่ายจริง (รวมค่าจัดส่งแล้ว) โดยจะไม่มีการบวกค่าบริการหรือค่าส่งเพิ่มในหน้าชำระเงินอีก

**สำหรับผู้ซื้อ**

- **ราคาที่เห็นคือราคาที่จ่ายจริง** ไม่มีค่าส่งบวกเพิ่มในหน้าชำระเงิน
- **บางร้านอาจมีการตั้งยอดสั่งซื้อขั้นต่ำ** โดยระบบจะแจ้งในตะกร้าสินค้าว่าต้องเลือกซื้อเพิ่มอีกเท่าไรจึงจะชำระเงินได้ เหมาะกับการเก็บการ์ดราคาถูกหลายใบเพื่อจัดเด็คหรือเก็บให้ครบชุดในพัสดุเดียว

**สำหรับผู้ขาย**

- **ระบบจะบวกเพิ่ม ฿40 เข้ากับทุกรายการสินค้าที่ลงขายอยู่ในปัจจุบันให้อัตโนมัติ ในเวลา 00:00 น. ของวันที่ 9 ตุลาคม** เพื่อให้มั่นใจว่าผู้ขายไม่ต้องแบกรับค่าจัดส่งเอง
- **โปรดอย่าเพิ่งปรับขึ้นราคาเองก่อนวันดังกล่าว** เพราะหากคุณปรับขึ้นราคาไว้ก่อน ระบบจะบวกเพิ่มอีก ฿40 ทับซ้อนเข้าไปอีก (หลังวันที่ 9 ตุลาคม คุณสามารถปรับราคาสินค้าขึ้นหรือลงได้ตามปกติทุกเมื่อ)
- **สินค้าที่ลงขายหลังวันที่ 9 ตุลาคม เป็นต้นไป** ขอให้ตั้งราคารวมค่าจัดส่งและค่าแพ็กให้เรียบร้อย (โดยปกติค่าบริการ Flash Express จะอยู่ที่ประมาณ ฿30–40 ต่อพัสดุ)
- **ใหม่! ตั้งยอดสั่งซื้อขั้นต่ำของร้านค้าได้** เช่น ลงการ์ด Common ใบละ ฿10 แล้วตั้งยอดขั้นต่ำไว้ที่ ฿100 เมื่อมีออเดอร์ 10 ใบขึ้นไป การจัดส่งใน 1 พัสดุก็จะคุ้มค่าทันที ตั้งค่าได้ที่ โปรไฟล์ > บัญชีผู้ขาย (บน Desktop: ขาย) หมายเหตุ: ข้อเสนอราคา (Offers) ที่คุณกดรับ จะไม่อยู่ในเงื่อนไขยอดขั้นต่ำนี้
- **การจัดส่งยังคงเหมือนเดิม** ระบบใบจัดส่ง การเข้ารับพัสดุ และการติดตามสถานะผ่าน Flash Express สามารถใช้งานได้ตามปกติไม่มีเปลี่ยนแปลง

**อัปเดตอื่น ๆ บน Cardstreet**

- **หยุดร้านชั่วคราว** กดเพียงครั้งเดียวเพื่อซ่อนรายการสินค้าทั้งหมด และกดอีกครั้งเพื่อเปิดร้านกลับมาขายตามปกติ
- **เลือกจำนวนสินค้า** การ์ดใบเดียวกันที่มีหลายใบ จะแสดงเป็นรายการเดียวพร้อมเมนูให้เลือกจำนวน

หากมีข้อสงสัยเพิ่มเติม สามารถตอบกลับอีเมลนี้ หรือติดต่อเราได้ที่ support@thailandtcg.com

ขอบคุณที่ร่วมสะสมไปกับเรา

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

## Email 2: reminder

**Sends:** Monday, October 5, 10:00 Bangkok. All users.

**Subject:** อีก 4 วันเท่านั้น: ราคาเดียวรวมค่าส่งบน Cardstreet

**Preview:** เริ่มวันศุกร์ที่ 9 ต.ค. นี้ เวลา 00:00 น.

สวัสดีครับ

ขอแจ้งเตือนอีกครั้ง ตั้งแต่**วันศุกร์ที่ 9 ตุลาคม เวลา 00:00 น.** เป็นต้นไป ทุกราคาบน Cardstreet จะรวมค่าจัดส่งเรียบร้อยแล้ว ผู้ซื้อจ่ายตรงตามราคาที่เห็นทันที

**3 ข้อที่ผู้ขายควรรู้**

1. **ระบบจะบวกเพิ่ม ฿40 ให้ทุกรายการสินค้าโดยอัตโนมัติ**เมื่อถึงเวลาเปลี่ยนผ่าน โปรดอย่าเพิ่งปรับขึ้นราคาเองก่อนวันดังกล่าว
2. **หลังวันที่ 9 ตุลาคม ตรวจสอบราคาของคุณ** แล้วปรับขึ้นหรือลงได้ตามต้องการทุกเมื่อ
3. **ตั้งยอดสั่งซื้อขั้นต่ำของร้าน** สามารถตั้งค่าได้ที่ โปรไฟล์ > บัญชีผู้ขาย ช่วยให้ลงขายการ์ดราคาย่อมเยาได้โดยไม่ขาดทุนค่าส่ง

**สำหรับผู้ซื้อไม่ต้องดำเนินการใดๆ เพิ่มเติม** ราคาที่เห็นคือราคาที่จ่ายจริง

หากมีข้อสงสัย สามารถตอบกลับอีเมลนี้ หรือติดต่อเราได้ที่ support@thailandtcg.com

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

## Push 1: 48 hours

**Sends:** Tuesday, October 6, 18:00 Bangkok. Sellers with listings. Opens the Vault.

**Title:** อีก 48 ชม. ราคารวมค่าส่งบน Cardstreet

**Message:** 9 ต.ค. เวลา 00:00 น. ระบบจะบวก ฿40 ให้ทุกรายการอัตโนมัติ ยังไม่ต้องปรับราคาเอง และตั้งยอดขั้นต่ำได้ที่โปรไฟล์

### English

**Title:** 48 hours: prices will include shipping

**Message:** At 12:00 am Oct 9 we add ฿40 to each of your listings. No need to raise prices yourself. Set your shop minimum in Profile.

---

## Email 3: 24 hours

**Sends:** Thursday, October 8, 00:00 Bangkok. All users.

**Subject:** พรุ่งนี้: ทุกราคาบน Cardstreet รวมค่าส่งแล้ว

**Preview:** เริ่มเปลี่ยนคืนนี้ เวลา 00:00 น. (เข้าสู่วันศุกร์ที่ 9 ต.ค.)

สวัสดีครับ

อีก 24 ชั่วโมงเท่านั้น! ในเวลา **00:00 น. ของวันศุกร์ที่ 9 ตุลาคม** ทุกราคาบน Cardstreet จะรวมค่าจัดส่งเรียบร้อยแล้ว

- **ผู้ขาย:** ทุกรายการของคุณจะถูกบวกเพิ่ม ฿40 โดยอัตโนมัติ เมื่อระบบเริ่มใช้งานแล้ว สามารถเข้าไปตรวจราคาและตั้งยอดสั่งซื้อขั้นต่ำของร้านได้ที่ โปรไฟล์ > บัญชีผู้ขาย
- **ผู้ซื้อ:** ไม่มีค่าส่งบวกเพิ่มในหน้าชำระเงินอีกต่อไป

หากมีข้อสงสัย สามารถตอบกลับอีเมลนี้ได้เลยครับ

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

## Push 2: tonight

**Sends:** Thursday, October 8, 18:00 Bangkok. Sellers with listings. Opens the Vault.

**Title:** พรุ่งนี้: ทุกราคาบน Cardstreet รวมค่าส่ง

**Message:** เที่ยงคืนนี้ 00:00 น. ทุกรายการของคุณ +฿40 อัตโนมัติ หลังระบบเปลี่ยนแล้วเข้ามาตรวจราคาและตั้งยอดขั้นต่ำของร้าน

### English

**Title:** Tomorrow: prices include shipping

**Message:** At 12:00 am tonight ฿40 is added to each of your listings. After the change, review your prices and set your shop minimum.

---

## Email 4: live

**Sends:** Friday, October 9, 00:00 Bangkok, released by hand at go-live. All users.

**Subject:** เริ่มแล้ววันนี้: ราคาเดียวรวมค่าส่งบน Cardstreet

**Preview:** ราคาที่เห็นคือราคาที่จ่ายจริง เริ่มแล้วตอนนี้

สวัสดีครับ

ระบบใหม่เริ่มใช้งานแล้ว ตั้งแต่ตอนนี้เป็นต้นไป ทุกราคาบน Cardstreet ได้รวมค่าจัดส่งเรียบร้อยแล้ว ผู้ซื้อจ่ายตรงตามราคาที่เห็นทันที

**ผู้ขายมี 2 สิ่งที่ต้องทำในวันนี้**

1. **ตรวจสอบราคาของคุณ** ระบบบวกเพิ่ม ฿40 ให้ทุกรายการแล้ว ปรับราคาขึ้นหรือลงตามต้องการได้ที่หน้าคลังการ์ด
2. **ตั้งยอดสั่งซื้อขั้นต่ำของร้าน** ที่ โปรไฟล์ > บัญชีผู้ขาย (บน Desktop: ขาย)

**ผู้ซื้อ** เลือกการ์ด ใส่ตะกร้า แล้วชำระเงินตามราคาที่เห็นได้เลย (หากร้านมียอดขั้นต่ำ ระบบในตะกร้าจะคำนวณและแจ้งเตือนว่าต้องเลือกซื้อเพิ่มอีกเท่าไร)

ขอบคุณที่ร่วมสะสมไปกับเรา

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

