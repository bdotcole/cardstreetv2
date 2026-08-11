/**
 * Bilingual copy for /become-a-breaker.
 *
 * Co-located EN/TH objects rather than lib/locales/*.json keys — the same
 * pattern as the other long-form content pages (app/sell-cards, app/contact,
 * app/prices). The t('key') helper in lib/hooks/useTranslation returns strings
 * only, so the structured copy this page needs (benefit cards, step lists,
 * option labels) can't live in the shared JSON; useTranslation still decides
 * WHICH object renders, via its `isThai` flag.
 *
 * Industry terms stay in English in the Thai copy — "TCG", "Breaker",
 * "Cardstreet Live", "live" — because that is what the Thai TCG community
 * actually says. Translating them would read as stilted, not more Thai.
 *
 * Claims discipline: nothing here promises earnings, audience size, sales
 * volume, or a review deadline. The program is early access to a marketplace
 * feature, not employment. Do not add a number to this file that isn't sourced.
 */

import type {
    ApplicantType,
    BreakerGame,
    EquipmentOption,
    ExperienceLevel,
    PreferredLanguage,
    SectionId,
    SetupStatus,
} from '@/lib/breakerApplication';

export interface BreakerCopy {
    // ── Chrome ──
    backToHome: string;
    langToggleLabel: string;

    // ── Hero ──
    eyebrow: string;
    headline: string;
    subhead: string;
    ctaApply: string;
    ctaHowItWorks: string;
    trustPoints: string[];
    mockupCaption: string;
    mockup: {
        liveLabel: string;
        viewersLabel: string;
        breakTitle: string;
        chat: { user: string; text: string }[];
        purchaseToast: { title: string; detail: string };
    };

    // ── Why ──
    whyTitle: string;
    whyIntro: string;
    benefits: { icon: string; title: string; body: string }[];

    // ── Who ──
    whoTitle: string;
    whoIntro: string;
    checklist: string[];
    whoNote: string;

    // ── How ──
    howTitle: string;
    howIntro: string;
    steps: { title: string; body: string }[];

    // ── Form ──
    formTitle: string;
    formIntro: string;
    sections: Record<SectionId, { title: string; hint: string }>;
    sectionComplete: string;
    sectionIncomplete: string;
    optional: string;
    required: string;
    expand: string;
    collapse: string;

    fields: {
        fullName: string;
        email: string;
        phone: string;
        phoneHint: string;
        lineId: string;
        city: string;
        province: string;
        preferredLanguage: string;
        isAdult: string;

        applicantTypes: string;
        applicantTypesHint: string;
        applicantTypeOther: string;
        businessName: string;
        socialLinks: string;
        socialLinksHint: string;
        addLink: string;
        removeLink: string;
        cardstreetUsername: string;

        games: string;
        gamesHint: string;
        gamesOther: string;
        breakingExperience: string;
        experienceSummary: string;
        experienceSummaryHint: string;
        sampleVideoUrl: string;
        sampleVideoHint: string;

        equipment: string;
        equipmentHint: string;
        equipmentOther: string;
        setupStatus: string;
        availability: string;
        availabilityHint: string;
        breakTypes: string;
        breakTypesHint: string;
        inventoryNotes: string;

        whyApply: string;
        trustAndEntertainment: string;
        anythingElse: string;
    };

    options: {
        preferredLanguage: Record<PreferredLanguage, string>;
        applicantType: Record<ApplicantType, string>;
        game: Record<BreakerGame, string>;
        experience: Record<ExperienceLevel, string>;
        equipment: Record<EquipmentOption, string>;
        setupStatus: Record<SetupStatus, string>;
    };

    consent: {
        accurate: string;
        noGuarantee: string;
        // Assembled as: before + [privacy] + middle + [terms] + middle2 +
        // [breaker terms] + after. Split rather than interpolated so each
        // language can order and punctuate the list its own way.
        termsBefore: string;
        privacyLink: string;
        termsMiddle: string;
        termsLink: string;
        termsMiddle2: string;
        breakerTermsLink: string;
        termsAfter: string;
    };

    submit: string;
    submitting: string;
    charactersLeft: (n: number) => string;

    // ── Validation + errors ──
    errors: {
        required: string;
        tooShort: string;
        tooLong: string;
        email: string;
        phone: string;
        url: string;
        pickOne: string;
        consent: string;
        adult: string;
        summary: string;
        network: string;
        duplicate: string;
        rateLimited: string;
        server: string;
        dataKept: string;
    };

    // ── Success ──
    successTitle: string;
    successBody: string;
    successBack: string;
}

const EN: BreakerCopy = {
    backToHome: 'Back to CardStreet',
    langToggleLabel: 'อ่านภาษาไทย',

    eyebrow: 'Applications Now Open',
    headline: 'Become a Founding Cardstreet Breaker',
    subhead:
        "Host live TCG breaks, connect with collectors and help shape Cardstreet Live from the beginning. We're now accepting applications from breakers, card shops, sellers and TCG creators across Thailand.",
    ctaApply: 'Apply Now',
    ctaHowItWorks: 'How It Works',
    trustPoints: [
        'Early access to Cardstreet Live',
        'Dedicated TCG marketplace',
        'Open to experienced and first-time breakers',
    ],
    mockupCaption: 'Interface preview — Cardstreet Live',
    mockup: {
        liveLabel: 'LIVE',
        viewersLabel: 'watching',
        breakTitle: 'Pokémon Thai — MA3 booster box break',
        chat: [
            { user: 'nong_tcg', text: 'slot 4 please' },
            { user: 'bkkcollector', text: 'that hit is clean' },
            { user: 'preechaa', text: 'next box?' },
        ],
        purchaseToast: { title: 'Slot claimed', detail: 'Spot 4 · paid' },
    },

    whyTitle: 'Why break on Cardstreet?',
    whyIntro:
        'Cardstreet is a trading-card marketplace first. Cardstreet Live is being built on top of it, for the people who already know these cards.',
    benefits: [
        {
            icon: 'fa-layer-group',
            title: 'Built Specifically for TCG',
            body: 'Reach collectors through a marketplace designed around trading cards rather than general livestream shopping.',
        },
        {
            icon: 'fa-tower-broadcast',
            title: 'Integrated Selling Experience',
            body: 'Showcase products, interact with viewers and manage live purchases through the Cardstreet ecosystem.',
        },
        {
            icon: 'fa-seedling',
            title: 'Become an Early Creator',
            body: 'Join during the initial rollout and help influence how Cardstreet Live develops.',
        },
        {
            icon: 'fa-users',
            title: 'Grow With the Community',
            body: 'Build your presence alongside Cardstreet as livestream selling expands across Thailand and Southeast Asia.',
        },
    ],

    whoTitle: "Who we're looking for",
    whoIntro: 'The hosts we can help most tend to share these traits:',
    checklist: [
        'Comfortable and engaging on camera',
        'Knowledgeable about at least one TCG',
        'Able to explain products and pulls accurately',
        'Careful when handling cards and customer orders',
        'Reliable internet and an appropriate streaming setup',
        'Committed to creating a trustworthy buyer experience',
    ],
    whoNote:
        'Previous breaking experience is helpful, but it is not required. Strong TCG knowledge, reliability and an engaging personality also matter.',

    howTitle: 'How it works',
    howIntro: 'Four steps from application to your first public break.',
    steps: [
        {
            title: 'Submit your application',
            body: 'Tell us about your experience, favorite TCGs and livestream setup.',
        },
        {
            title: 'Application review',
            body: 'The Cardstreet team reviews your application and content.',
        },
        {
            title: 'Complete a test stream',
            body: 'Selected applicants test the platform and demonstrate their hosting setup.',
        },
        {
            title: 'Host your first live break',
            body: 'Approved breakers receive onboarding before scheduling their first public stream.',
        },
    ],

    formTitle: 'Breaker application',
    formIntro:
        'Six short sections. Open one at a time — your answers stay put as you move between them.',
    sections: {
        contact: { title: 'Contact information', hint: 'How we reach you' },
        profile: { title: 'Applicant profile', hint: 'Who you are and where you sell' },
        experience: { title: 'TCG experience', hint: 'The games you know best' },
        streaming: { title: 'Streaming readiness', hint: 'Your setup and availability' },
        written: { title: 'Written application', hint: 'In your own words' },
        consent: { title: 'Consent', hint: 'Three confirmations' },
    },
    sectionComplete: 'Complete',
    sectionIncomplete: 'Needs attention',
    optional: 'optional',
    required: 'required',
    expand: 'Open section',
    collapse: 'Close section',

    fields: {
        fullName: 'Full name',
        email: 'Email address',
        phone: 'Phone number',
        phoneHint: 'Thai mobile or landline, e.g. 081 234 5678',
        lineId: 'LINE ID',
        city: 'City',
        province: 'Province',
        preferredLanguage: 'Preferred language',
        isAdult: 'I confirm that I am at least 18 years old',

        applicantTypes: 'What describes you? Select all that apply',
        applicantTypesHint: 'Pick every one that fits — most applicants are more than one.',
        applicantTypeOther: 'Tell us more',
        businessName: 'Shop, business or channel name',
        socialLinks: 'Social media or livestream profile links',
        socialLinksHint: 'Facebook, TikTok, YouTube, Instagram — whatever you stream or sell on.',
        addLink: 'Add another link',
        removeLink: 'Remove link',
        cardstreetUsername: 'Existing Cardstreet username or profile',

        games: 'Games you specialize in',
        gamesHint: 'Select every game you could confidently host a break for.',
        gamesOther: 'Which other game?',
        breakingExperience: 'Breaking or livestream experience',
        experienceSummary: 'Describe your selling, breaking or content experience',
        experienceSummaryHint:
            'What you sell, where you sell it, and anything you have hosted before.',
        sampleVideoUrl: 'Link to a sample livestream or introduction video',
        sampleVideoHint: 'A past stream, a clip, or a short self-introduction.',

        equipment: 'Current equipment',
        equipmentHint: 'Select everything you already have.',
        equipmentOther: 'Anything else?',
        setupStatus: 'Streaming setup status',
        availability: 'Typical availability',
        availabilityHint: 'Which days and times you could realistically stream.',
        breakTypes: 'Types of products or breaks you want to host',
        breakTypesHint: 'For example: booster box breaks, single-pack rips, sealed case breaks.',
        inventoryNotes: 'TCGs or products currently available to sell',

        whyApply: 'Why do you want to become a Cardstreet Breaker?',
        trustAndEntertainment: 'What would make your livestreams entertaining and trustworthy?',
        anythingElse: 'Is there anything else you would like us to know?',
    },

    options: {
        preferredLanguage: { th: 'Thai', en: 'English', bilingual: 'Bilingual' },
        applicantType: {
            breaker: 'Breaker',
            card_shop: 'Card shop',
            marketplace_seller: 'Marketplace seller',
            content_creator: 'TCG content creator',
            collector: 'Collector',
            other: 'Other',
        },
        game: {
            pokemon: 'Pokémon',
            one_piece: 'One Piece',
            mtg: 'Magic: The Gathering',
            yugioh: 'Yu-Gi-Oh!',
            lorcana: 'Disney Lorcana',
            riftbound: 'Riftbound',
            other: 'Other',
        },
        experience: {
            none: 'No previous experience',
            under_1y: 'Less than one year',
            '1_to_3y': 'One to three years',
            over_3y: 'More than three years',
        },
        equipment: {
            smartphone: 'Smartphone',
            camera: 'Camera',
            microphone: 'Microphone',
            lighting: 'Lighting',
            tripod_or_mount: 'Tripod or overhead mount',
            computer: 'Computer',
            other: 'Other',
        },
        setupStatus: {
            ready: 'Ready now',
            minor_improvements: 'Need minor improvements',
            building: 'Still building my setup',
        },
    },

    consent: {
        accurate: 'The information I have submitted is accurate.',
        noGuarantee: 'I understand that applying does not guarantee approval.',
        termsBefore: 'I agree to CardStreet’s ',
        privacyLink: 'Privacy Policy',
        termsMiddle: ', ',
        termsLink: 'Terms of Service',
        termsMiddle2: ', and ',
        breakerTermsLink: 'Breaker Program Terms',
        termsAfter: '.',
    },

    submit: 'Submit Application',
    submitting: 'Submitting…',
    charactersLeft: (n) => `${n.toLocaleString('en-US')} characters left`,

    errors: {
        required: 'This field is required.',
        tooShort: 'Please add a little more detail.',
        tooLong: 'This answer is too long.',
        email: 'Enter a valid email address, e.g. name@example.com.',
        phone: 'Enter a valid Thai phone number, e.g. 081 234 5678.',
        url: 'Enter a valid link, e.g. facebook.com/yourpage.',
        pickOne: 'Select at least one option.',
        consent: 'Please confirm to continue.',
        adult: 'You must be at least 18 to apply.',
        summary: 'Some answers need another look. The sections below are open.',
        network: 'We could not reach the server. Check your connection and try again.',
        duplicate: 'We already have an application from this email address.',
        rateLimited: 'Too many applications from this connection. Please try again later.',
        server: 'Something went wrong on our side. Please try again.',
        dataKept: 'Your answers have been kept.',
    },

    successTitle: 'Application received!',
    successBody:
        'Thank you for applying to become a Cardstreet Breaker. Our team will review your information and contact you if you are selected for the next step.',
    successBack: 'Back to CardStreet',
};

const TH: BreakerCopy = {
    backToHome: 'กลับสู่ CardStreet',
    langToggleLabel: 'Read in English',

    eyebrow: 'เปิดรับสมัครแล้ว',
    headline: 'มาเป็น Cardstreet Breaker รุ่นก่อตั้ง',
    subhead:
        'จัดไลฟ์เปิดการ์ด TCG พูดคุยกับนักสะสม และร่วมกำหนดทิศทางของ Cardstreet Live ตั้งแต่วันแรก ตอนนี้เราเปิดรับสมัคร breaker ร้านการ์ด ผู้ขาย และครีเอเตอร์สาย TCG ทั่วประเทศไทย',
    ctaApply: 'สมัครเลย',
    ctaHowItWorks: 'ขั้นตอนเป็นอย่างไร',
    trustPoints: [
        'เข้าใช้ Cardstreet Live ก่อนใคร',
        'มาร์เก็ตเพลสสำหรับการ์ด TCG โดยเฉพาะ',
        'เปิดรับทั้งมือเก่าและคนที่ยังไม่เคยจัดไลฟ์',
    ],
    mockupCaption: 'ตัวอย่างหน้าจอ — Cardstreet Live',
    mockup: {
        liveLabel: 'LIVE',
        viewersLabel: 'กำลังดู',
        breakTitle: 'โปเกม่อนไทย — เปิดกล่องบูสเตอร์ MA3',
        chat: [
            { user: 'nong_tcg', text: 'ขอช่อง 4 ครับ' },
            { user: 'bkkcollector', text: 'ใบนี้สวยมาก' },
            { user: 'preechaa', text: 'กล่องต่อไปเลยไหม' },
        ],
        purchaseToast: { title: 'จองช่องแล้ว', detail: 'ช่อง 4 · ชำระเงินแล้ว' },
    },

    whyTitle: 'ทำไมต้องจัดไลฟ์บน Cardstreet',
    whyIntro:
        'Cardstreet เป็นมาร์เก็ตเพลสการ์ดสะสมมาก่อน และ Cardstreet Live ถูกสร้างต่อยอดขึ้นมาเพื่อคนที่รู้จักการ์ดเหล่านี้จริง ๆ',
    benefits: [
        {
            icon: 'fa-layer-group',
            title: 'สร้างมาเพื่อ TCG โดยเฉพาะ',
            body: 'เข้าถึงนักสะสมผ่านมาร์เก็ตเพลสที่ออกแบบมาเพื่อการ์ดสะสมโดยตรง ไม่ใช่แพลตฟอร์มไลฟ์ขายของทั่วไป',
        },
        {
            icon: 'fa-tower-broadcast',
            title: 'ระบบขายที่เชื่อมกันครบ',
            body: 'โชว์สินค้า พูดคุยกับผู้ชม และจัดการคำสั่งซื้อระหว่างไลฟ์ได้ในระบบเดียวของ Cardstreet',
        },
        {
            icon: 'fa-seedling',
            title: 'เป็นครีเอเตอร์รุ่นแรก',
            body: 'เข้าร่วมตั้งแต่ช่วงเริ่มต้น และมีส่วนกำหนดว่า Cardstreet Live จะพัฒนาไปทางไหน',
        },
        {
            icon: 'fa-users',
            title: 'เติบโตไปพร้อมคอมมูนิตี้',
            body: 'สร้างตัวตนของคุณไปพร้อมกับ Cardstreet ในขณะที่การไลฟ์ขายการ์ดกำลังขยายทั่วไทยและเอเชียตะวันออกเฉียงใต้',
        },
    ],

    whoTitle: 'เรากำลังมองหาใคร',
    whoIntro: 'โฮสต์ที่เราช่วยได้มากที่สุดมักมีลักษณะเหล่านี้:',
    checklist: [
        'อยู่หน้ากล้องได้อย่างเป็นธรรมชาติและคุยสนุก',
        'มีความรู้เรื่อง TCG อย่างน้อยหนึ่งเกม',
        'อธิบายสินค้าและการ์ดที่เปิดได้ถูกต้อง',
        'ดูแลการ์ดและคำสั่งซื้อของลูกค้าอย่างระมัดระวัง',
        'อินเทอร์เน็ตเสถียร และมีอุปกรณ์ไลฟ์ที่เหมาะสม',
        'ตั้งใจสร้างประสบการณ์ที่ผู้ซื้อไว้ใจได้',
    ],
    whoNote:
        'เคยจัด break มาก่อนถือเป็นข้อได้เปรียบ แต่ไม่ใช่ข้อบังคับ ความรู้เรื่อง TCG ความน่าเชื่อถือ และบุคลิกที่ชวนติดตาม ก็สำคัญไม่แพ้กัน',

    howTitle: 'ขั้นตอนการสมัคร',
    howIntro: 'สี่ขั้นตอน จากใบสมัครถึงไลฟ์แรกของคุณ',
    steps: [
        {
            title: 'ส่งใบสมัคร',
            body: 'เล่าให้เราฟังเรื่องประสบการณ์ของคุณ เกม TCG ที่ถนัด และอุปกรณ์ไลฟ์ที่มี',
        },
        {
            title: 'ทีมงานพิจารณา',
            body: 'ทีม Cardstreet จะตรวจสอบใบสมัครและผลงานของคุณ',
        },
        {
            title: 'ทดลองไลฟ์',
            body: 'ผู้สมัครที่ผ่านการคัดเลือกจะได้ทดลองใช้ระบบและแสดงการจัดไลฟ์ของตัวเอง',
        },
        {
            title: 'จัดไลฟ์ break ครั้งแรก',
            body: 'breaker ที่ผ่านการอนุมัติจะได้รับการแนะนำการใช้งานก่อนนัดหมายไลฟ์สาธารณะครั้งแรก',
        },
    ],

    formTitle: 'ใบสมัคร Breaker',
    formIntro: 'มีหกส่วนสั้น ๆ เปิดทีละส่วนได้ คำตอบของคุณจะยังอยู่ครบเมื่อสลับไปมา',
    sections: {
        contact: { title: 'ข้อมูลติดต่อ', hint: 'ช่องทางที่เราจะติดต่อกลับ' },
        profile: { title: 'ข้อมูลผู้สมัคร', hint: 'คุณคือใคร และขายอยู่ที่ไหน' },
        experience: { title: 'ประสบการณ์ TCG', hint: 'เกมที่คุณถนัดที่สุด' },
        streaming: { title: 'ความพร้อมในการไลฟ์', hint: 'อุปกรณ์และเวลาที่สะดวก' },
        written: { title: 'คำถามปลายเปิด', hint: 'เล่าด้วยคำพูดของคุณเอง' },
        consent: { title: 'การยืนยัน', hint: 'ยืนยันสามข้อ' },
    },
    sectionComplete: 'ครบแล้ว',
    sectionIncomplete: 'ต้องแก้ไข',
    optional: 'ไม่บังคับ',
    required: 'จำเป็น',
    expand: 'เปิดส่วนนี้',
    collapse: 'ปิดส่วนนี้',

    fields: {
        fullName: 'ชื่อ-นามสกุล',
        email: 'อีเมล',
        phone: 'เบอร์โทรศัพท์',
        phoneHint: 'เบอร์มือถือหรือเบอร์บ้านในไทย เช่น 081 234 5678',
        lineId: 'LINE ID',
        city: 'อำเภอ/เขต',
        province: 'จังหวัด',
        preferredLanguage: 'ภาษาที่ถนัด',
        isAdult: 'ยืนยันว่าฉันมีอายุ 18 ปีบริบูรณ์ขึ้นไป',

        applicantTypes: 'คุณตรงกับข้อไหนบ้าง เลือกได้มากกว่าหนึ่งข้อ',
        applicantTypesHint: 'เลือกทุกข้อที่ตรงกับคุณ ผู้สมัครส่วนใหญ่ตรงมากกว่าหนึ่งข้อ',
        applicantTypeOther: 'ระบุเพิ่มเติม',
        businessName: 'ชื่อร้าน ธุรกิจ หรือช่องของคุณ',
        socialLinks: 'ลิงก์โซเชียลหรือโปรไฟล์ไลฟ์',
        socialLinksHint: 'Facebook, TikTok, YouTube, Instagram — ช่องทางที่คุณไลฟ์หรือขายอยู่',
        addLink: 'เพิ่มลิงก์',
        removeLink: 'ลบลิงก์',
        cardstreetUsername: 'ชื่อผู้ใช้หรือโปรไฟล์ Cardstreet ที่มีอยู่แล้ว',

        games: 'เกมที่คุณถนัด',
        gamesHint: 'เลือกทุกเกมที่คุณจัด break ได้อย่างมั่นใจ',
        gamesOther: 'เกมอื่นคือเกมอะไร',
        breakingExperience: 'ประสบการณ์จัด break หรือไลฟ์',
        experienceSummary: 'เล่าประสบการณ์การขาย การจัด break หรือการทำคอนเทนต์ของคุณ',
        experienceSummaryHint: 'คุณขายอะไร ขายที่ไหน และเคยจัดไลฟ์แบบไหนมาบ้าง',
        sampleVideoUrl: 'ลิงก์ไลฟ์ตัวอย่างหรือวิดีโอแนะนำตัว',
        sampleVideoHint: 'ไลฟ์ที่เคยจัด คลิปสั้น ๆ หรือวิดีโอแนะนำตัวก็ได้',

        equipment: 'อุปกรณ์ที่มีอยู่',
        equipmentHint: 'เลือกทุกอย่างที่คุณมีอยู่แล้ว',
        equipmentOther: 'มีอย่างอื่นอีกไหม',
        setupStatus: 'ความพร้อมของอุปกรณ์ไลฟ์',
        availability: 'ช่วงเวลาที่สะดวก',
        availabilityHint: 'วันและเวลาที่คุณจัดไลฟ์ได้จริง',
        breakTypes: 'ประเภทสินค้าหรือ break ที่อยากจัด',
        breakTypesHint: 'เช่น เปิดกล่องบูสเตอร์ เปิดซองเดี่ยว หรือเปิดยกลัง',
        inventoryNotes: 'การ์ด TCG หรือสินค้าที่มีพร้อมขายตอนนี้',

        whyApply: 'ทำไมคุณถึงอยากเป็น Cardstreet Breaker',
        trustAndEntertainment: 'อะไรที่จะทำให้ไลฟ์ของคุณสนุกและน่าเชื่อถือ',
        anythingElse: 'มีอะไรอยากบอกเราเพิ่มเติมไหม',
    },

    options: {
        preferredLanguage: { th: 'ไทย', en: 'อังกฤษ', bilingual: 'ได้ทั้งสองภาษา' },
        applicantType: {
            breaker: 'Breaker',
            card_shop: 'ร้านการ์ด',
            marketplace_seller: 'ผู้ขายบนมาร์เก็ตเพลส',
            content_creator: 'ครีเอเตอร์สาย TCG',
            collector: 'นักสะสม',
            other: 'อื่น ๆ',
        },
        game: {
            pokemon: 'โปเกม่อน',
            one_piece: 'วันพีช',
            mtg: 'Magic: The Gathering',
            yugioh: 'ยูกิโอ',
            lorcana: 'Disney Lorcana',
            riftbound: 'Riftbound',
            other: 'อื่น ๆ',
        },
        experience: {
            none: 'ยังไม่เคยมีประสบการณ์',
            under_1y: 'น้อยกว่า 1 ปี',
            '1_to_3y': '1–3 ปี',
            over_3y: 'มากกว่า 3 ปี',
        },
        equipment: {
            smartphone: 'สมาร์ตโฟน',
            camera: 'กล้อง',
            microphone: 'ไมโครโฟน',
            lighting: 'ไฟ',
            tripod_or_mount: 'ขาตั้งกล้องหรือแขนจับกล้องมุมบน',
            computer: 'คอมพิวเตอร์',
            other: 'อื่น ๆ',
        },
        setupStatus: {
            ready: 'พร้อมแล้วตอนนี้',
            minor_improvements: 'ต้องปรับปรุงเล็กน้อย',
            building: 'ยังจัดเตรียมอุปกรณ์อยู่',
        },
    },

    consent: {
        accurate: 'ข้อมูลที่ฉันกรอกเป็นความจริง',
        noGuarantee: 'ฉันเข้าใจว่าการสมัครไม่ได้รับประกันว่าจะได้รับการอนุมัติ',
        termsBefore: 'ฉันยอมรับ',
        privacyLink: 'นโยบายความเป็นส่วนตัว',
        termsMiddle: ' ',
        termsLink: 'ข้อกำหนดการใช้งาน',
        termsMiddle2: ' และ',
        breakerTermsLink: 'ข้อกำหนดโปรแกรม Breaker',
        // Leading space: Thai runs words together, but this segment now follows
        // the Latin "Breaker", and "Breakerของ" reads as one broken token.
        termsAfter: ' ของ CardStreet',
    },

    submit: 'ส่งใบสมัคร',
    submitting: 'กำลังส่ง…',
    charactersLeft: (n) => `เหลืออีก ${n.toLocaleString('th-TH')} ตัวอักษร`,

    errors: {
        required: 'กรุณากรอกข้อมูลในช่องนี้',
        tooShort: 'กรุณาเล่ารายละเอียดเพิ่มอีกนิด',
        tooLong: 'คำตอบนี้ยาวเกินไป',
        email: 'กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com',
        phone: 'กรุณากรอกเบอร์โทรในไทยให้ถูกต้อง เช่น 081 234 5678',
        url: 'กรุณากรอกลิงก์ให้ถูกต้อง เช่น facebook.com/yourpage',
        pickOne: 'กรุณาเลือกอย่างน้อยหนึ่งข้อ',
        consent: 'กรุณายืนยันเพื่อดำเนินการต่อ',
        adult: 'ผู้สมัครต้องมีอายุ 18 ปีขึ้นไป',
        summary: 'มีบางคำตอบที่ต้องแก้ไข ระบบได้เปิดส่วนที่เกี่ยวข้องไว้ให้แล้ว',
        network: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
        duplicate: 'เราได้รับใบสมัครจากอีเมลนี้แล้ว',
        rateLimited: 'มีการส่งใบสมัครจากการเชื่อมต่อนี้มากเกินไป กรุณาลองใหม่ภายหลัง',
        server: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง',
        dataKept: 'คำตอบของคุณยังอยู่ครบ',
    },

    successTitle: 'ได้รับใบสมัครแล้ว!',
    successBody:
        'ขอบคุณที่สมัครเป็น Cardstreet Breaker ทีมงานของเราจะตรวจสอบข้อมูลของคุณ และจะติดต่อกลับหากคุณได้รับเลือกให้เข้าสู่ขั้นตอนถัดไป',
    successBack: 'กลับสู่ CardStreet',
};

export function getBreakerCopy(isThai: boolean): BreakerCopy {
    return isThai ? TH : EN;
}
