/**
 * LANGUAGE PICKER DEBUG CHECKLIST
 * Run through these steps to identify the issue
 */

// Step 1: Check if dev server is running
// Open terminal and run: npm run dev
// Should see: ready - started server on http://localhost:3000

// Step 2: Open browser console (F12)
// Navigate to http://localhost:3000

// Step 3: Check initial language
// In console, type: localStorage.getItem('cardstreet-settings')
// Should see: {"currency":"THB","language":"EN",...}

// Step 4: Look for the language picker
// Should be in top right corner, shows "EN" or "TH"

// Step 5: Click the language picker
// Watch console for these logs:
// - "LanguagePicker: Changing language from EN to TH"
// - "updateLanguage called with: TH"
// - "Setting language from EN to TH"
// - "useTranslation: current language is TH" (multiple times)

// Step 6: If you see NO logs at all
// The component might not be rendering. Check:
console.log('=== MANUAL DEBUG TEST ===');
console.log('Current settings:', localStorage.getItem('cardstreet-settings'));

// Step 7: If you see logs but UI doesn't change
// Manually change language and reload:
localStorage.setItem('cardstreet-settings', JSON.stringify({
    currency: 'THB',
    language: 'TH',
    twoFactorEnabled: false,
    notifyPriceDrops: true,
    notifyOrderUpdates: true,
    notifyMarketing: false
}));
console.log('Changed to Thai - now reload page');
// Then reload the page - UI should be in Thai

// Step 8: Check if translations are loading
import enTranslations from '@/lib/locales/en.json';
import thTranslations from '@/lib/locales/th.json';
console.log('EN translations loaded:', enTranslations);
console.log('TH translations loaded:', thTranslations);
console.log('nav.shop in English:', enTranslations.nav.shop);
console.log('nav.shop in Thai:', thTranslations.nav.shop);
