import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface UserSettings {
    currency: string;
    language: 'TH' | 'EN';
    phoneNumber?: string;
    shippingAddress?: any;
    twoFactorEnabled: boolean;
    notifyPriceDrops: boolean;
    notifyOrderUpdates: boolean;
    notifyMarketing: boolean;
}

interface UseUserSettingsReturn {
    settings: UserSettings;
    isLoading: boolean;
    error: string | null;
    updateCurrency: (currency: string) => Promise<void>;
    updateLanguage: (language: 'TH' | 'EN') => Promise<void>;
    updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
    refreshSettings: () => Promise<void>;
}

const DEFAULT_SETTINGS: UserSettings = {
    currency: 'THB',
    language: 'TH',
    twoFactorEnabled: false,
    notifyPriceDrops: true,
    notifyOrderUpdates: true,
    notifyMarketing: false
};

export function useUserSettings(): UseUserSettingsReturn {
    const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSettings = async () => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                // Guest user - load from localStorage
                const saved = localStorage.getItem('cardstreet-settings');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    setSettings({ ...DEFAULT_SETTINGS, ...parsed });
                }
                setIsLoading(false);
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
                    currency: DEFAULT_SETTINGS.currency, // Not in user_settings table, handle separately
                    language: DEFAULT_SETTINGS.language,
                    phoneNumber: data.phone_number,
                    shippingAddress: data.shipping_address,
                    twoFactorEnabled: data.two_factor_enabled,
                    notifyPriceDrops: data.notify_price_drops,
                    notifyOrderUpdates: data.notify_order_updates,
                    notifyMarketing: data.notify_marketing
                };

                // Load currency/language from localStorage or profile
                const saved = localStorage.getItem('cardstreet-settings');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed.currency) userSettings.currency = parsed.currency;
                    if (parsed.language) userSettings.language = parsed.language;
                }

                setSettings(userSettings);
            }

            setError(null);
        } catch (err: any) {
            console.error('Error loading settings:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const updateCurrency = async (currency: string) => {
        // Currency stored in localStorage for now
        localStorage.setItem('cardstreet-settings', JSON.stringify({
            ...settings,
            currency
        }));
        setSettings(prev => ({ ...prev, currency }));
    };

    const updateLanguage = async (language: 'TH' | 'EN') => {
        console.log('updateLanguage called with:', language);
        // Language stored in localStorage for now
        const newSettings = {
            ...settings,
            language
        };
        localStorage.setItem('cardstreet-settings', JSON.stringify(newSettings));
        setSettings(prev => {
            console.log('Setting language from', prev.language, 'to', language);
            return { ...prev, language };
        });
    };

    const updateSettings = async (updates: Partial<UserSettings>) => {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                // Guest user - save to localStorage
                const newSettings = { ...settings, ...updates };
                localStorage.setItem('cardstreet-settings', JSON.stringify(newSettings));
                setSettings(newSettings);
                return;
            }

            // Build database updates
            const dbUpdates: any = {};
            if (updates.phoneNumber !== undefined) dbUpdates.phone_number = updates.phoneNumber;
            if (updates.shippingAddress !== undefined) dbUpdates.shipping_address = updates.shippingAddress;
            if (updates.twoFactorEnabled !== undefined) dbUpdates.two_factor_enabled = updates.twoFactorEnabled;
            if (updates.notifyPriceDrops !== undefined) dbUpdates.notify_price_drops = updates.notifyPriceDrops;
            if (updates.notifyOrderUpdates !== undefined) dbUpdates.notify_order_updates = updates.notifyOrderUpdates;
            if (updates.notifyMarketing !== undefined) dbUpdates.notify_marketing = updates.notifyMarketing;

            if (Object.keys(dbUpdates).length > 0) {
                const { error } = await supabase
                    .from('user_settings')
                    .update(dbUpdates)
                    .eq('user_id', user.id);

                if (error) throw error;
            }

            // Handle currency/language separately
            if (updates.currency) await updateCurrency(updates.currency);
            if (updates.language) await updateLanguage(updates.language);

            setSettings(prev => ({ ...prev, ...updates }));
        } catch (err: any) {
            console.error('Error updating settings:', err);
            setError(err.message);
            throw err;
        }
    };

    const refreshSettings = async () => {
        setIsLoading(true);
        await loadSettings();
    };

    return {
        settings,
        isLoading,
        error,
        updateCurrency,
        updateLanguage,
        updateSettings,
        refreshSettings
    };
}
