'use client';

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

export type AppTheme = 'dark' | 'light';

interface UserSettings {
    currency: string;
    language: 'TH' | 'EN';
    theme: AppTheme;
    phoneNumber?: string;
    shippingAddress?: any;
    twoFactorEnabled: boolean;
    notifyPriceDrops: boolean;
    notifyOrderUpdates: boolean;
    notifyMarketing: boolean;
}

interface UserSettingsContextType {
    settings: UserSettings;
    isLoading: boolean;
    error: string | null;
    updateCurrency: (currency: string) => Promise<void>;
    updateLanguage: (language: 'TH' | 'EN') => Promise<void>;
    updateTheme: (theme: AppTheme) => Promise<void>;
    updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS: UserSettings = {
    currency: 'THB',
    language: 'EN',  // Default to English
    theme: 'dark',   // The app is dark-first; light is opt-in
    twoFactorEnabled: false,
    notifyPriceDrops: true,
    notifyOrderUpdates: true,
    notifyMarketing: false
};

// First-visit UI language when the user has no saved preference. We're a
// Thailand-first platform, so a visitor whose browser prefers Thai should land
// in Thai; everyone else (expats, tourists, the international TCG community)
// gets English. This is a client-side proxy for "is this a Thai visitor" —
// a proper geo/locale-routing model (language in the URL) comes later.
function detectBrowserLanguage(): 'TH' | 'EN' {
    if (typeof navigator === 'undefined') return DEFAULT_SETTINGS.language;
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
    // Honor preference order: whichever of Thai or English the visitor ranks
    // higher wins. A device set to English-primary with Thai as a fallback
    // (e.g. ['en-US', 'th']) should stay in English.
    for (const pref of prefs) {
        const lang = pref.toLowerCase();
        if (lang.startsWith('th')) return 'TH';
        if (lang.startsWith('en')) return 'EN';
    }
    return DEFAULT_SETTINGS.language;
}

// Server-readable mirror of the UI language so the next request's middleware +
// root layout render the right locale (and <html lang>) without a flash.
function writeLangCookie(language: 'TH' | 'EN') {
    if (typeof document === 'undefined') return;
    document.cookie = `cs_lang=${language}; path=/; max-age=31536000; samesite=lax`;
}

// Same idea for the theme: the root layout reads cs_theme to put
// .theme-light on <html> server-side, so a light-mode user never sees a
// dark flash on load (and vice versa).
function writeThemeCookie(theme: AppTheme) {
    if (typeof document === 'undefined') return;
    document.cookie = `cs_theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

function applyThemeToDocument(theme: AppTheme) {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('theme-light', theme === 'light');
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

export function UserSettingsProvider({
    children,
    initialLanguage,
    initialTheme,
}: {
    children: ReactNode;
    // Locale resolved on the server (cs_lang cookie / Accept-Language) so the
    // first client render matches the SSR HTML. Falls back to the default.
    initialLanguage?: 'TH' | 'EN';
    // Theme resolved on the server (cs_theme cookie) — mirrors the class the
    // root layout already put on <html>.
    initialTheme?: AppTheme;
}) {
    const [settings, setSettings] = useState<UserSettings>({
        ...DEFAULT_SETTINGS,
        language: initialLanguage ?? DEFAULT_SETTINGS.language,
        theme: initialTheme ?? DEFAULT_SETTINGS.theme,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const hasLoadedOnce = useRef(false);

    const loadSettings = async () => {
        // Only load settings once on mount
        if (hasLoadedOnce.current) {
            console.log('Settings already loaded, skipping reload to preserve manual changes');
            return;
        }

        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                // Guest user - load from localStorage
                const saved = localStorage.getItem('cardstreet-settings');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    const merged = { ...DEFAULT_SETTINGS, ...parsed };
                    // Explicit choice wins; keep the server cookie aligned with it.
                    if (merged.language) writeLangCookie(merged.language);
                    writeThemeCookie(merged.theme);
                    setSettings(merged);
                } else {
                    // No saved choice: trust the server's resolved locale, else detect.
                    const lang = initialLanguage ?? detectBrowserLanguage();
                    writeLangCookie(lang);
                    setSettings({ ...DEFAULT_SETTINGS, language: lang });
                }
                setIsLoading(false);
                hasLoadedOnce.current = true;
                return;
            }

            // Load from Supabase
            const { data, error: settingsError } = await supabase
                .from('user_settings')
                .select('*')
                .eq('user_id', user.id)
                .single();

            if (settingsError && settingsError.code !== 'PGRST116') {
                throw settingsError;
            }

            if (data) {
                const userSettings: UserSettings = {
                    currency: DEFAULT_SETTINGS.currency,
                    language: initialLanguage ?? detectBrowserLanguage(),
                    theme: initialTheme ?? DEFAULT_SETTINGS.theme,
                    phoneNumber: data.phone_number,
                    shippingAddress: data.shipping_address,
                    twoFactorEnabled: data.two_factor_enabled,
                    notifyPriceDrops: data.notify_price_drops,
                    notifyOrderUpdates: data.notify_order_updates,
                    notifyMarketing: data.notify_marketing
                };

                // Load currency/language from localStorage
                const saved = localStorage.getItem('cardstreet-settings');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed.currency) userSettings.currency = parsed.currency;
                    if (parsed.language) userSettings.language = parsed.language;
                    if (parsed.theme === 'light' || parsed.theme === 'dark') userSettings.theme = parsed.theme;
                }

                writeLangCookie(userSettings.language);
                writeThemeCookie(userSettings.theme);
                setSettings(userSettings);
            }

            setError(null);
            hasLoadedOnce.current = true;
        } catch (err: any) {
            console.error('Error loading settings:', err);
            setError(err.message);
            hasLoadedOnce.current = true;
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    // Keep <html class="theme-light"> in sync with the active theme. The
    // server already rendered the right class from the cs_theme cookie; this
    // covers in-session toggles and a saved localStorage preference from
    // before the cookie existed.
    useEffect(() => {
        applyThemeToDocument(settings.theme);
    }, [settings.theme]);

    const updateCurrency = async (currency: string) => {
        const newSettings = { ...settings, currency };
        localStorage.setItem('cardstreet-settings', JSON.stringify(newSettings));
        setSettings(newSettings);
    };

    const updateLanguage = async (language: 'TH' | 'EN') => {
        const newSettings = { ...settings, language };
        localStorage.setItem('cardstreet-settings', JSON.stringify(newSettings));
        // Keep the server-readable mirror in sync so the next navigation's SSR
        // (and <html lang>) render in the chosen language.
        writeLangCookie(language);
        setSettings(newSettings);
    };

    const updateTheme = async (theme: AppTheme) => {
        const newSettings = { ...settings, theme };
        localStorage.setItem('cardstreet-settings', JSON.stringify(newSettings));
        writeThemeCookie(theme);
        setSettings(newSettings);
    };

    const updateSettings = async (updates: Partial<UserSettings>) => {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            throw new Error('Must be logged in to update settings');
        }

        const { error: updateError } = await supabase
            .from('user_settings')
            .upsert({
                user_id: user.id,
                phone_number: updates.phoneNumber,
                shipping_address: updates.shippingAddress,
                two_factor_enabled: updates.twoFactorEnabled,
                notify_price_drops: updates.notifyPriceDrops,
                notify_order_updates: updates.notifyOrderUpdates,
                notify_marketing: updates.notifyMarketing
            }, { onConflict: 'user_id' });

        if (updateError) throw updateError;

        setSettings(prev => ({ ...prev, ...updates }));
        setError(null);
    };

    const value: UserSettingsContextType = {
        settings,
        isLoading,
        error,
        updateCurrency,
        updateLanguage,
        updateTheme,
        updateSettings
    };

    return (
        <UserSettingsContext.Provider value={value}>
            {children}
        </UserSettingsContext.Provider>
    );
}

export function useUserSettings(): UserSettingsContextType {
    const context = useContext(UserSettingsContext);
    if (context === undefined) {
        throw new Error('useUserSettings must be used within a UserSettingsProvider');
    }
    return context;
}
