import { useMemo } from 'react';
import { useUserSettings } from './useUserSettings';
import enTranslations from '../locales/en.json';
import thTranslations from '../locales/th.json';

/**
 * Translation hook for multilingual UI support
 * Usage: const { t } = useTranslation();
 *        <span>{t('nav.shop')}</span>
 */
export function useTranslation() {
    const { settings } = useUserSettings();
    const lang = settings.language;

    console.log('useTranslation: current language is', lang);

    // Use useMemo to ensure translations reload when language changes
    const translations = useMemo(() => {
        return lang === 'TH' ? thTranslations : enTranslations;
    }, [lang]);

    /**
     * Get translation for a key
     * @param key - Translation key in dot notation (e.g., 'nav.shop')
     * @returns Translated string or key if not found
     */
    const t = (key: string): string => {
        const keys = key.split('.');
        let value: any = translations;

        for (const k of keys) {
            value = value?.[k];
            if (value === undefined) {
                console.warn(`Translation missing for key: ${key}`);
                return key;
            }
        }

        return typeof value === 'string' ? value : key;
    };

    return {
        t,
        language: lang,
        isThai: lang === 'TH'
    };
}
