'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import GooglePlacesAddressInput from '@/components/GooglePlacesAddressInput';
import ThaiAddressFields from '@/components/ThaiAddressFields';
import type { ParsedThaiAddress } from '@/lib/utils/parseGoogleAddress';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    type BuyerRequiredField,
} from '@/lib/profileValidation';
import { isValidThaiPhone } from '@/lib/utils/phone';

/**
 * In-checkout shipping-details step for the mobile shell.
 *
 * Shown when a buyer taps Checkout / Buy Now / Pay Offer without a complete
 * shipping profile. Collects the same fields the /api/orders/checkout gate
 * requires (address + district + city + province + postcode + valid TH phone),
 * saves them to the profile via PATCH /api/profile, and hands control back so
 * the interrupted purchase resumes — instead of the old dead-end bounce to the
 * Profile tab. Desktop's cart drawer has the equivalent inline 'address' phase.
 */

export type CheckoutAddressValues = Record<BuyerRequiredField, string>;

export const EMPTY_CHECKOUT_ADDRESS: CheckoutAddressValues = {
    address: '',
    district: '',
    state: '',
    province: '',
    postcode: '',
    phone_number: '',
};

const FIELD_INPUT_CLASS =
    'w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors';

interface CheckoutAddressSheetProps {
    isOpen: boolean;
    initialValues: CheckoutAddressValues;
    onClose: () => void;
    /** Profile saved — the caller resumes the purchase that hit the gate. */
    onSaved: () => void;
}

const CheckoutAddressSheet: React.FC<CheckoutAddressSheetProps> = ({
    isOpen,
    initialValues,
    onClose,
    onSaved,
}) => {
    const { t } = useTranslation();
    const [form, setForm] = useState<CheckoutAddressValues>(initialValues);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-seed whenever the sheet opens for a fresh gate (partial profiles
    // prefill whatever the buyer already saved).
    useEffect(() => {
        if (isOpen) {
            setForm(initialValues);
            setError(null);
            setSaving(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    if (!isOpen) return null;

    const setField = (field: BuyerRequiredField, value: string) => {
        setForm(prev => ({ ...prev, [field]: value }));
        if (error) setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (BUYER_REQUIRED_PROFILE_FIELDS.some(f => !form[f].trim())) return;
        // The <input required> only guarantees non-empty; Flash needs a
        // dialable TH number — same rule the server gate enforces.
        if (!isValidThaiPhone(form.phone_number)) {
            setError(t('profile.invalidPhone'));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: form.address.trim(),
                    district: form.district.trim(),
                    state: form.state.trim(),
                    province: form.province.trim(),
                    postcode: form.postcode.trim(),
                    phone_number: form.phone_number.trim(),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || t('checkoutAddress.saveFailed'));
            onSaved();
        } catch (err: any) {
            setError(err?.message || t('checkoutAddress.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        // Above the cart drawer / listing details (z-60); same layer as the
        // region-block popup. Bottom-sheet so the keyboard pushes it naturally.
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 backdrop-blur-md animate-fadeIn">
            <div className="bg-slate-900 w-full max-w-lg rounded-t-[2rem] border-t border-x border-white/10 shadow-2xl max-h-[92dvh] flex flex-col">
                <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center">
                            <i className="fa-solid fa-truck-fast text-brand-cyan"></i>
                        </div>
                        <h3 className="text-white text-base font-black">
                            {t('checkoutAddress.title')}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 transition-colors"
                    >
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 pb-8 space-y-3">
                    <p className="text-xs text-slate-400 leading-relaxed">
                        {t('checkoutAddress.subtitle')}
                    </p>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            {t('profile.phoneNumber')} <span className="text-rose-400">*</span>
                        </label>
                        <input
                            type="tel"
                            required
                            value={form.phone_number}
                            onChange={(e) => setField('phone_number', e.target.value)}
                            className={FIELD_INPUT_CLASS}
                            placeholder={t('profile.phonePlaceholder')}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            {t('profile.shippingAddress')} <span className="text-rose-400">*</span>
                        </label>
                        <GooglePlacesAddressInput
                            id="checkout-address-autocomplete"
                            defaultValue=""
                            placeholder={t('checkoutAddress.searchPlaceholder')}
                            className={FIELD_INPUT_CLASS}
                            onAddressParsed={(parsed: ParsedThaiAddress) => {
                                // Same Google→profile field mapping the Profile
                                // editor uses (district = tambon, state = amphoe).
                                setForm(prev => ({
                                    ...prev,
                                    address: parsed.detail_address || prev.address,
                                    district: parsed.sub_district || prev.district,
                                    state: parsed.district || prev.state,
                                    province: parsed.province || prev.province,
                                    postcode: parsed.postal_code || prev.postcode,
                                }));
                                if (error) setError(null);
                            }}
                        />
                        <p className="text-[10px] text-slate-600">
                            {t('checkoutAddress.searchHint')}
                        </p>
                    </div>

                    <input
                        type="text"
                        required
                        value={form.address}
                        onChange={(e) => setField('address', e.target.value)}
                        className={FIELD_INPUT_CLASS}
                        placeholder={t('profile.streetPlaceholder')}
                    />
                    <ThaiAddressFields
                        required
                        values={{
                            province: form.province,
                            state: form.state,
                            district: form.district,
                            postcode: form.postcode,
                        }}
                        onChange={(patch) => {
                            setForm(prev => ({ ...prev, ...patch }));
                            if (error) setError(null);
                        }}
                        inputClassName={FIELD_INPUT_CLASS}
                    />

                    {error && (
                        <p className="text-xs text-rose-400">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full h-14 bg-brand-cyan hover:bg-brand-cyan/90 text-black font-bold rounded-2xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                        {saving ? (
                            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                        ) : (
                            t('checkoutAddress.saveContinue')
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default CheckoutAddressSheet;
