'use client'

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import AuthModal from '@/components/AuthModal';

type Tab = 'profile' | 'preferences';

interface ProfileForm {
    display_name: string;
    username: string;
    phone_number: string;
    address: string;
    district: string;
    state: string;
    province: string;
    postcode: string;
}

interface Prefs {
    two_factor_enabled: boolean;
    notify_price_drops: boolean;
    notify_order_updates: boolean;
    notify_marketing: boolean;
}

const EMPTY_FORM: ProfileForm = {
    display_name: '',
    username: '',
    phone_number: '',
    address: '',
    district: '',
    state: '',
    province: '',
    postcode: '',
};

// Downscale a picked image to a square-friendly avatar and re-encode as JPEG so
// avatar files stay tiny (same policy as the mobile Profile).
async function downscaleImage(file: File, max: number): Promise<Blob> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not load image'));
        el.src = dataUrl;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.85),
    );
}

export default function DesktopSettings() {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialTab: Tab = searchParams?.get('tab') === 'preferences' ? 'preferences' : 'profile';

    const [tab, setTab] = useState<Tab>(initialTab);
    const [user, setUser] = useState<User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
    const [usernameUpdatedAt, setUsernameUpdatedAt] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [prefs, setPrefs] = useState<Prefs>({
        two_factor_enabled: false,
        notify_price_drops: true,
        notify_order_updates: true,
        notify_marketing: false,
    });

    // Avatar
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarOverride, setAvatarOverride] = useState<string | null>(null);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            setUser(data.user ?? null);
            setAuthChecked(true);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
        return () => sub.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!authChecked) return;
        if (!user) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/profile');
                if (res.ok) {
                    const data = await res.json();
                    if (cancelled) return;
                    const p = data.profile || {};
                    setForm({
                        display_name: p.display_name || '',
                        username: p.username || '',
                        phone_number: p.phone_number || '',
                        address: p.address || '',
                        district: p.district || '',
                        state: p.state || '',
                        province: p.province || '',
                        postcode: p.postcode || '',
                    });
                    setUsernameUpdatedAt(p.username_updated_at || null);
                    if (data.settings) {
                        setPrefs({
                            two_factor_enabled: !!data.settings.two_factor_enabled,
                            notify_price_drops: data.settings.notify_price_drops !== false,
                            notify_order_updates: data.settings.notify_order_updates !== false,
                            notify_marketing: !!data.settings.notify_marketing,
                        });
                    }
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [authChecked, user]);

    const setField = (k: keyof ProfileForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

    const saveProfile = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || t('desktop.settings.saveFailed'));
            showToast(t('desktop.settings.saved'), 'success');
        } catch (err: any) {
            showToast(err.message || t('desktop.settings.saveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const togglePref = async (key: keyof Prefs) => {
        const next = !prefs[key];
        setPrefs((p) => ({ ...p, [key]: next }));
        try {
            const res = await fetch('/api/profile/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [key]: next }),
            });
            if (!res.ok) throw new Error();
        } catch {
            setPrefs((p) => ({ ...p, [key]: !next }));
            showToast(t('desktop.settings.saveFailed'), 'error');
        }
    };

    const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !user) return;
        if (!file.type.startsWith('image/')) {
            showToast(t('desktop.settings.avatarNotImage'), 'error');
            return;
        }
        setAvatarUploading(true);
        try {
            const supabase = createClient();
            const blob = await downscaleImage(file, 512);
            const path = `${user.id}/${Date.now()}.jpg`;
            const { data, error } = await supabase.storage
                .from('avatars')
                .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
            if (error) throw error;
            const publicUrl = supabase.storage.from('avatars').getPublicUrl(data.path).data.publicUrl;
            const bustUrl = `${publicUrl}?v=${Date.now()}`;
            const { error: updErr } = await supabase.auth.updateUser({ data: { avatar_url: bustUrl } });
            if (updErr) throw updErr;
            setAvatarOverride(bustUrl);
            showToast(t('desktop.settings.avatarUpdated'), 'success');
        } catch (err: any) {
            showToast(err?.message || t('desktop.settings.saveFailed'), 'error');
        } finally {
            setAvatarUploading(false);
        }
    };

    const goTab = (nextTab: Tab) => {
        setTab(nextTab);
        router.replace(`/settings?tab=${nextTab}`);
    };

    if (!authChecked) return <div className="h-64 rounded-2xl bg-white/5 animate-pulse"></div>;

    if (!user) {
        return (
            <div className="text-center py-24">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                    <i className="fa-solid fa-gear text-2xl text-slate-600"></i>
                </div>
                <h1 className="text-white font-bold uppercase tracking-widest text-sm mb-1">{t('desktop.settings.signedOutTitle')}</h1>
                <p className="text-slate-500 text-sm mb-6">{t('desktop.settings.signedOutDesc')}</p>
                <button
                    onClick={() => setAuthOpen(true)}
                    className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-6 py-2.5 rounded-xl transition-colors"
                >
                    {t('desktop.signIn')}
                </button>
                <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
            </div>
        );
    }

    const avatarUrl = avatarOverride || (user.user_metadata?.avatar_url as string | undefined);
    const email = user.email || '';

    return (
        <div className="max-w-3xl">
            <h1 className="text-2xl font-black text-white">{t('desktop.settings.title')}</h1>
            <p className="text-sm text-slate-400 mt-1">{t('desktop.settings.subtitle')}</p>

            <div className="flex gap-2 mt-6 border-b border-white/5 pb-3">
                {([['profile', t('desktop.editProfile')], ['preferences', t('desktop.settings.preferences')]] as [Tab, string][]).map(([id, label]) => (
                    <button
                        key={id}
                        onClick={() => goTab(id)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                            tab === id ? 'bg-brand-cyan text-brand-darker' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="h-64 rounded-2xl bg-white/5 animate-pulse mt-8"></div>
            ) : tab === 'profile' ? (
                <div className="mt-8 space-y-6">
                    {/* Avatar */}
                    <div className="flex items-center gap-5">
                        <span className="w-20 h-20 rounded-2xl bg-slate-800 overflow-hidden flex items-center justify-center text-2xl font-black text-white">
                            {avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                (form.display_name || email).charAt(0).toUpperCase()
                            )}
                        </span>
                        <div>
                            <button
                                onClick={() => avatarInputRef.current?.click()}
                                disabled={avatarUploading}
                                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                            >
                                {avatarUploading ? (
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                ) : (
                                    <><i className="fa-solid fa-camera mr-2 text-slate-400"></i>{t('desktop.settings.changePhoto')}</>
                                )}
                            </button>
                            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
                        </div>
                    </div>

                    <Field label={t('desktop.settings.displayName')}>
                        <input value={form.display_name} onChange={(e) => setField('display_name', e.target.value)} className={inputCls} placeholder={t('desktop.settings.displayName')} />
                    </Field>

                    <Field label={t('desktop.settings.username')} hint={usernameUpdatedAt ? t('desktop.settings.usernameRule') : undefined}>
                        <input value={form.username} onChange={(e) => setField('username', e.target.value)} maxLength={20} className={inputCls} placeholder={t('desktop.settings.usernamePlaceholder')} />
                    </Field>

                    <Field label={t('desktop.settings.email')}>
                        <input value={email} disabled className={`${inputCls} text-slate-500 cursor-not-allowed`} />
                    </Field>

                    <Field label={t('desktop.settings.phone')}>
                        <input value={form.phone_number} onChange={(e) => setField('phone_number', e.target.value)} className={inputCls} placeholder={t('desktop.settings.phonePlaceholder')} />
                    </Field>

                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('desktop.settings.shippingAddress')}</p>
                        <div className="space-y-2">
                            <input value={form.address} onChange={(e) => setField('address', e.target.value)} className={inputCls} placeholder={t('desktop.settings.streetPlaceholder')} />
                            <div className="grid grid-cols-2 gap-2">
                                <input value={form.district} onChange={(e) => setField('district', e.target.value)} className={inputCls} placeholder={t('desktop.settings.districtPlaceholder')} />
                                <input value={form.state} onChange={(e) => setField('state', e.target.value)} className={inputCls} placeholder={t('desktop.settings.statePlaceholder')} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <input value={form.province} onChange={(e) => setField('province', e.target.value)} className={inputCls} placeholder={t('desktop.settings.provincePlaceholder')} />
                                <input value={form.postcode} onChange={(e) => setField('postcode', e.target.value)} className={inputCls} placeholder={t('desktop.settings.postalPlaceholder')} />
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={saveProfile}
                        disabled={saving}
                        className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-6 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                    >
                        {saving ? <i className="fa-solid fa-spinner fa-spin"></i> : t('desktop.settings.saveChanges')}
                    </button>
                </div>
            ) : (
                <PreferencesTab prefs={prefs} togglePref={togglePref} />
            )}

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        </div>
    );
}

const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{label}</label>
            {children}
            {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
        </div>
    );
}

function PreferencesTab({ prefs, togglePref }: { prefs: Prefs; togglePref: (k: keyof Prefs) => void }) {
    const { t, language } = useTranslation();
    const { updateLanguage } = useUserSettings();
    const router = useRouter();

    const setLang = async (lang: 'TH' | 'EN') => {
        if (lang === language) return;
        await updateLanguage(lang);
        router.refresh();
    };

    return (
        <div className="mt-8 space-y-8">
            {/* Language */}
            <section>
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">{t('desktop.settings.language')}</h2>
                <div className="flex gap-2">
                    {(['TH', 'EN'] as const).map((l) => (
                        <button
                            key={l}
                            onClick={() => setLang(l)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                                language === l ? 'bg-brand-cyan text-brand-darker' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                            }`}
                        >
                            {l === 'TH' ? 'ไทย' : 'English'}
                        </button>
                    ))}
                </div>
            </section>

            {/* Security */}
            <section>
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">{t('desktop.settings.security')}</h2>
                <ToggleRow
                    icon="fa-shield-halved"
                    label={t('desktop.settings.twoFactor')}
                    desc={prefs.two_factor_enabled ? t('desktop.settings.enabled') : t('desktop.settings.notEnabled')}
                    on={prefs.two_factor_enabled}
                    onToggle={() => togglePref('two_factor_enabled')}
                />
            </section>

            {/* Notifications */}
            <section>
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">{t('desktop.settings.notifications')}</h2>
                <div className="space-y-2">
                    <ToggleRow icon="fa-arrow-trend-down" label={t('desktop.settings.priceDrops')} desc={t('desktop.settings.priceDropsDesc')} on={prefs.notify_price_drops} onToggle={() => togglePref('notify_price_drops')} />
                    <ToggleRow icon="fa-box" label={t('desktop.settings.orderUpdates')} desc={t('desktop.settings.orderUpdatesDesc')} on={prefs.notify_order_updates} onToggle={() => togglePref('notify_order_updates')} />
                    <ToggleRow icon="fa-bullhorn" label={t('desktop.settings.marketing')} desc={t('desktop.settings.marketingDesc')} on={prefs.notify_marketing} onToggle={() => togglePref('notify_marketing')} />
                </div>
            </section>

            {/* Account links */}
            <section className="border-t border-white/5 pt-6 flex flex-wrap gap-4">
                <a href="/sell" className="text-sm text-slate-300 hover:text-brand-cyan transition-colors font-bold">
                    <i className="fa-solid fa-wallet mr-2 text-slate-500"></i>{t('desktop.settings.sellerPayouts')}
                </a>
                <a href="/delete" className="text-sm text-slate-500 hover:text-brand-red transition-colors font-bold">
                    <i className="fa-solid fa-trash-can mr-2"></i>{t('desktop.settings.deleteAccount')}
                </a>
            </section>
        </div>
    );
}

function ToggleRow({
    icon,
    label,
    desc,
    on,
    onToggle,
}: {
    icon: string;
    label: string;
    desc?: string;
    on: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center justify-between gap-4 bg-[#1e293b]/40 border border-white/5 rounded-xl px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
                <i className={`fa-solid ${icon} ${on ? 'text-brand-cyan' : 'text-slate-500'} w-5 text-center`}></i>
                <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{label}</p>
                    {desc && <p className="text-[11px] text-slate-500 truncate">{desc}</p>}
                </div>
            </div>
            <button
                onClick={onToggle}
                role="switch"
                aria-checked={on}
                aria-label={label}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-brand-cyan' : 'bg-slate-700'}`}
            >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`}></span>
            </button>
        </div>
    );
}
