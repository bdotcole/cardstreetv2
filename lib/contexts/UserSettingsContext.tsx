import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
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

interface UserSettingsContextType {
    settings: UserSettings;
    isLoading: boolean;
    error: string | null;
    updateCurrency: (currency: string) => Promise<void>;
    updateLanguage: (language: 'TH' | 'EN') => Promise<void>;
    updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS: UserSettings = {
    currency: 'THB',
    language: 'EN',  // Default to English
    twoFactorEnabled: false,
    notifyPriceDrops: true,
    notifyOrderUpdates: true,
    notifyMarketing: false
};

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
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
                    setSettings({ ...DEFAULT_SETTINGS, ...parsed });
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
                    language: DEFAULT_SETTINGS.language,
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
                }

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

    const updateCurrency = async (currency: string) => {
        const newSettings = { ...settings, currency };
        localStorage.setItem('cardstreet-settings', JSON.stringify(newSettings));
        setSettings(newSettings);
    };

    const updateLanguage = async (language: 'TH' | 'EN') => {
        console.log('Context updateLanguage called with:', language);
        const newSettings = { ...settings, language };
        localStorage.setItem('cardstreet-settings', JSON.stringify(newSettings));
        console.log('Updating settings state to:', newSettings);
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
