const fs = require('fs');

const replacements = [
  // CardDetails & ListingDetails
  { th: "รายละเอียดสินค้า", en: "Listing details" },
  { th: "ราคาขาย", en: "Asking price" },
  { th: "ผู้ขาย", en: "Seller" },
  { th: "เพิ่มลงรถเข็น", en: "Add to cart" },
  { th: "ซื้อเลย", en: "Buy now" },
  { th: "ข้อมูลเชิงลึก", en: "Asset Details" },
  { th: "ราคาปัจจุบัน", en: "Spot Price" },
  { th: "ราคาสูงสุด", en: "Market High" },
  { th: ">สูงสุด<", en: ">Peak<", raw: true, replaceTh: ">{isThai ? 'สูงสุด' : 'Peak'}<" },
  { th: "สถานะการวางขาย", en: "Marketplace Availability" },
  { th: "ไม่มีรายการขายในขณะนี้", en: "No listings available for this item" },
  { th: "แดชบอร์ดการ์ดเกรด", en: "Graded Dashboard" },
  { th: "เพิ่มเข้าคลัง", en: "Add to Vault" },
  { th: "ช้อปเลย", en: "Shop Now" },

  // BuylistRequest
  { th: "รายการขอซื้อ", en: "Buylist Request" },
  { th: "ไม่มีรายการวางขายในขณะนี้", en: "No Active Listings" },
  { th: "ไม่มีรายการวางขาย", en: "No listings available" },
  { th: "ขออภัย ขณะนี้ยังไม่มีสินค้านี้ในตลาด กรุณาเพิ่มสินค้าลงในรายการขอซื้อ แล้วเราจะแจ้งเตือนผู้ขายให้คุณ", en: "This card isn't currently available on the marketplace. Add it to the Cardstreet buylist and we’ll notify sellers to list it for you!" },
  { th: "สภาพที่ต้องการ", en: "Desired Condition" },
  { th: "ราคาสูงสุด", en: "Maximum Price" },
  { th: "จำนวนที่ต้องการ", en: "Quantity Needed" },
  { th: "แจ้งเตือนเมื่อมีสินค้า", en: "Notify on availability" },
  { th: "รับการแจ้งเตือนเมื่อการ์ดพร้อมวางขาย", en: "Get alerts when this card is listed" },
  { th: "เพิ่มลงรายการขอซื้อ", en: "Add to Buylist" },
  { th: "ข้อผิดพลาด", en: "Error" },
  { th: "สร้างรายการขอซื้อไม่สำเร็จ", en: "Failed to create buylist request" },

  // ListingForm
  { th: "รายการขาย", en: "List for Sale" },
  { th: "ตลาด:", en: "Market:" },
  { th: "ราคาขาย \\(THB\\)", en: "Asking Price (THB)", raw: true, replaceTh: ">{isThai ? 'ราคาขาย (THB)' : 'Asking Price (THB)'}<" },
  { th: ">สภาพการ์ด<", en: ">Condition<", raw: true, replaceTh: ">{isThai ? 'สภาพการ์ด' : 'Condition'}<" },
  { th: "การ์ดใบนี้ได้รับการเกรดอย่างเป็นทางการ", en: "This card is professionally graded" },

  // Vault
  { th: "จัดเรียงตาม:", en: "Sort By:" },
  { th: ">จัดเรียงตาม<", en: ">Sort By<", raw: true, replaceTh: ">{isThai ? 'จัดเรียงตาม' : 'Sort By'}<" },
  { th: "'วางขายล่าสุด'", en: "'Recently Added'", raw: true, replaceTh: "(isThai ? 'วางขายล่าสุด' : 'Recently Added')" },
  { th: "'ชื่อ \\(ก-ฮ\\)'", en: "'Name (A-Z)'", raw: true, replaceTh: "(isThai ? 'ชื่อ (ก-ฮ)' : 'Name (A-Z)')" },
  { th: "'ราคา \\(สูง-ต่ำ\\)'", en: "'Price (High-Low)'", raw: true, replaceTh: "(isThai ? 'ราคา (สูง-ต่ำ)' : 'Price (High-Low)')" },
  { th: "'ราคา \\(ต่ำ-สูง\\)'", en: "'Price (Low-High)'", raw: true, replaceTh: "(isThai ? 'ราคา (ต่ำ-สูง)' : 'Price (Low-High)')" },
  { th: "วางขายล่าสุด", en: "Recently Added" },
  { th: "ลงขายสินสินค้า", en: "Sell Asset" },
  { th: "กำลังประกาศขาย", en: "Active Listings" },
  { th: "ประกาศขายใหม่", en: "New Listing" },
  { th: "วางขายในตลาด", en: "Live on Market" },
  { th: " ใบ", en: " Unit(s)", raw: true, replaceTh: " {isThai ? 'ใบ' : 'Unit(s)'}" },
  { th: "แก้ไข", en: "Edit Listing" },
  { th: "ลบ", en: "Remove" },

  // Profile
  { th: "ยังไม่มีข้อมูลการชำระเงิน", en: "No payment methods saved" },
  { th: "เพิ่มการ์ดใหม่", en: "Add New Card" },
  { th: ">ตั้งค่า<", en: ">Settings<", raw: true, replaceTh: ">{isThai ? 'ตั้งค่า' : 'Settings'}<" },
  { th: ">ความปลอดภัย<", en: ">Security<", raw: true, replaceTh: ">{isThai ? 'ความปลอดภัย' : 'Security'}<" },
  { th: "การยืนยันตัวตนแบบสองชั้น", en: "Two-Factor Authentication" },
  { th: "ยังไม่ได้เปิดใช้งาน", en: "Not enabled" },
  { th: ">การแจ้งเตือน<", en: ">Notifications<", raw: true, replaceTh: ">{isThai ? 'การแจ้งเตือน' : 'Notifications'}<" },
  { th: "แจ้งเตือนเมื่อราคาลดลง", en: "Price Drop Alerts" },
  { th: "แจ้งเตือนเมื่อรายการโปรดลดรา", en: "Get notified when wishlist items drop" },
  { th: "สถานะคำสั่งซื้อ", en: "Order Updates" },
  { th: "แจ้งเตือนการจัดส่งสินค้า", en: "Shipping and delivery notifications" },
  { th: "ข่าวสารและกิจกรรม", en: "Marketing" },
  { th: "โปรโมชันและข้อเสนอพิเศษ", en: "Promotions and special offers" },
  { th: "ติดตามคำสั่งซื้อ", en: "Track Orders" },
  { th: "ยืนยันการรับพัสดุและรีวิว", en: "Confirm Delivery & Review" },
  { th: "รายการรอจัดส่ง", en: "Pending Shipments" },
  { th: "ไม่มีรายการรอจัดส่ง", en: "No pending shipments" },
  { th: "เมื่อมีผู้ซื้อสั่งซื้อการ์ดของคุณ รายการจะปรากฏที่นี่เพื่อรอการจัดส่ง", en: "When buyers purchase your cards, they will appear here to be shipped." },
  { th: "สถานะ:", en: "Status:" },
  { th: "สร้างป้ายชื่อและจัดส่ง", en: "Generate Label & Ship" },
  { th: "พิมพ์ป้ายชื่อจัดส่ง", en: "Print Shipping Label" },
  { th: "ยืนยัน<br />การจัดส่ง", en: "Confirm<br />Shipment", raw: true, replaceTh: "{isThai ? 'ยืนยัน' : 'Confirm'}<br />{isThai ? 'การจัดส่ง' : 'Shipment'}" },
  { th: "ระบบจะสร้างหมายเลขติดตามและป้ายจัดส่งผ่าน SHIPPOP สำหรับคำสั่งซื้อนี้โดยอัตโนมัติ คุณพร้อมที่จะแพ็คและนำพัสดุไปส่งแล้วหรือยัง\\?", en: "This will automatically generate a tracking number and shipping label via SHIPPOP for this order. Are you ready to box and drop off the package?" },
  { th: "สร้างป้ายชื่อจัดส่งอัตโนมัติ", en: "Generate Auto-Label" },
  { th: "ยืนยัน<br />การรับพัสดุ", en: "Confirm<br />Delivery", raw: true, replaceTh: "{isThai ? 'ยืนยัน' : 'Confirm'}<br />{isThai ? 'การรับพัสดุ' : 'Delivery'}" },
  { th: "สินค้าชิ้นนี้ถึงมือคุณอย่างปลอดภัยแล้วใช่หรือไม่\\? การยืนยันจะถือเป็นการสิ้นสุดการทำธุรกรรมและจะทำการโอนเงินให้กับผู้ขาย", en: "Has this order safely arrived in your hands? Confirming will finalize the transaction and release the funds from escrow to the seller.", raw: true, replaceTh: "{isThai ? 'สินค้าชิ้นนี้ถึงมือคุณอย่างปลอดภัยแล้วใช่หรือไม่? การยืนยันจะถือเป็นการสิ้นสุดการทำธุรกรรมและจะทำการโอนเงินให้กับผู้ขาย' : 'Has this order safely arrived in your hands? Confirming will finalize the transaction and release the funds from escrow to the seller.'}" },
  { th: "ให้คะแนน", en: "Leave a Rating" },
  { th: "ความคิดเห็น \\(ไม่บังคับ\\)", en: "Review Comment (Optional)", raw: true, replaceTh: ">{isThai ? 'ความคิดเห็น (ไม่บังคับ)' : 'Review Comment (Optional)'}<" },
  { th: "แพ็คเกจดีมาก การ์ดสภาพสมบูรณ์!", en: "Great packaging, card arrived mint!", raw: true, replaceTh: "{(isThai ? 'แพ็คเกจดีมาก การ์ดสภาพสมบูรณ์!' : 'Great packaging, card arrived mint!')}" },
  { th: "ยืนยันรับพัสดุ", en: "Confirm Received" },
  { th: "'กำลังดำเนินการ...'", en: "'Processing...'", raw: true, replaceTh: "(isThai ? 'กำลังดำเนินการ...' : 'Processing...')" }
];

const files = [
  'components/ListingDetails.tsx',
  'components/CardDetails.tsx',
  'components/BuylistRequest.tsx',
  'components/ListingForm.tsx',
  'components/Vault.tsx',
  'components/Profile.tsx'
];

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  
  if (!content.includes("import { useTranslation }")) {
    content = "import { useTranslation } from '@/lib/hooks/useTranslation';\n" + content;
  }
  
  // Inject const { isThai } = useTranslation();
  // Using generic Profile = ({ user }) => { or Profile = () => { etc
  const componentMatch = content.match(/(const\s+\w+\s*(:\s*React\.FC<[^>]+>)?\s*=\s*\([^)]*\)\s*=>\s*\{)(?!\s*const\s+\{\s*isThai\s*\})/);
  if (componentMatch) {
    content = content.replace(componentMatch[1], componentMatch[1] + "\n  const { isThai } = useTranslation();\n");
  } else if (!content.includes('const { isThai }')) {
    const altMatch = content.match(/(export\s+default\s+function\s+\w+\([^)]*\)\s*\{)(?!\s*const\s+\{\s*isThai\s*\})/);
    if(altMatch) {
        content = content.replace(altMatch[1], altMatch[1] + "\n  const { isThai } = useTranslation();\n");
    }
  }

  replacements.forEach(r => {
    if (r.raw) {
      content = content.replace(new RegExp(r.th, 'g'), r.replaceTh);
    } else {
      let regex1 = new RegExp(`>\\s*${r.th}\\s*<`, 'g');
      content = content.replace(regex1, `>{isThai ? '${r.th.replace(/\\/g, '')}' : '${r.en}'}<`);
      
      let regex2 = new RegExp(`['"]${r.th}['"]`, 'g');
      content = content.replace(regex2, `(isThai ? '${r.th.replace(/\\/g, '')}' : '${r.en}')`);
      
      let regex3 = new RegExp(`([ \\n\\r\\t]+)(${r.th})([ \\n\\r\\.\\!]+)`, 'g');
      content = content.replace(regex3, `$1{isThai ? '${r.th.replace(/\\/g, '')}' : '${r.en}'}$3`);
    }
  });

  fs.writeFileSync(f, content);
});
console.log('Safe replacements complete');
