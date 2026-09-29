'use client';

/**
 * Shop minimum order card — sits under the shop status card in Profile >
 * Seller Account (mobile) and on desktop /sell.
 *
 * Shipping is inside every listing price, so a one-card order of a 10-baht
 * common costs the seller more to post than it earns. Rather than pricing
 * every common at 50 baht, the seller sets the smallest order the shop
 * accepts: buyers can cart cheap singles freely but can only check out once
 * their total from this shop reaches the minimum. See lib/minOrder.ts.
 *
 * Renders nothing while the feature is unavailable (migration not applied):
 * a field that 503s on save would be worse than no field.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ShoppingBasket } from 'lucide-react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { MIN_ORDER_MAX_THB } from '@/lib/minOrder';

const PRESETS = [0, 50, 100, 200];

export default function ShopMinOrderSection({ className = '' }: { className?: string }) {
    const { isThai } = useTranslation();
    const { showToast } = useToast();
    const [available, setAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saved, setSaved] = useState(0);
    const [draft, setDraft] = useState('0');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const copy = isThai
        ? {
            title: 'ยอดสั่งซื้อขั้นต่ำ',
            desc: 'กำหนดยอดสั่งซื้อขั้นต่ำของร้าน ผู้ซื้อยังหยิบการ์ดราคาถูกใส่ตะกร้าได้ แต่จะชำระเงินได้เมื่อยอดรวมจากร้านคุณถึงจำนวนนี้ ช่วยให้ลงขายการ์ดคอมมอนใบละ ฿10 ได้โดยไม่ขาดทุนค่าส่ง',
            label: 'ยอดขั้นต่ำ (฿)',
            off: 'ปิด',
            hint: 'ใส่ 0 เพื่อปิด ข้อเสนอราคาที่คุณกดรับจะไม่ติดขั้นต่ำ',
            save: 'บันทึก',
            savedToast: 'บันทึกยอดสั่งซื้อขั้นต่ำแล้ว',
            invalid: `กรุณาใส่จำนวนตั้งแต่ 0 ถึง ${MIN_ORDER_MAX_THB.toLocaleString()}`,
            failed: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
            current: 'ตอนนี้',
        }
        : {
            title: 'Minimum order',
            desc: 'Set the smallest order your shop accepts. Buyers can still add your cheap singles to their cart, but they can only check out once their total from your shop reaches this amount. It lets you list ฿10 commons without losing money on a one-card parcel.',
            label: 'Minimum order (฿)',
            off: 'Off',
            hint: '0 turns it off. Offers you accept are exempt.',
            save: 'Save',
            savedToast: 'Minimum order saved',
            invalid: `Enter a number from 0 to ${MIN_ORDER_MAX_THB.toLocaleString()}`,
            failed: 'Could not save. Please try again.',
            current: 'Now',
        };

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/profile/shop/min-order', { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setAvailable(!!data.available);
            const value = typeof data.minOrderThb === 'number' ? data.minOrderThb : 0;
            setSaved(value);
            setDraft(String(value));
        } catch {
            // A failed read hides the card rather than showing a broken field.
            setAvailable(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const parsed = Number(draft);
    const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= MIN_ORDER_MAX_THB;
    const dirty = valid && Math.floor(parsed) !== saved;

    const save = async () => {
        if (!valid) { setError(copy.invalid); return; }
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/profile/shop/min-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ minOrderThb: Math.floor(parsed) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || copy.failed);
            const value = typeof data.minOrderThb === 'number' ? data.minOrderThb : Math.floor(parsed);
            setSaved(value);
            setDraft(String(value));
            showToast(copy.savedToast, 'success');
        } catch (e) {
            setError(e instanceof Error && e.message ? e.message : copy.failed);
        } finally {
            setBusy(false);
        }
    };

    if (loading || !available) return null;

    return (
        <div className={`bg-slate-900/40 border border-white/10 rounded-2xl p-5 space-y-4 ${className}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-white font-bold text-base flex items-center gap-2">
                        <ShoppingBasket className="w-4 h-4 text-brand-cyan shrink-0" />
                        {copy.title}
                    </h3>
                    <p className="text-slate-400 text-xs mt-1 leading-relaxed">{copy.desc}</p>
                </div>
                <div className={`text-xs font-bold uppercase tracking-wider shrink-0 ${saved > 0 ? 'text-brand-green' : 'text-slate-500'}`}>
                    {copy.current}: {saved > 0 ? `฿${saved.toLocaleString()}` : copy.off}
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg p-3">
                    {error}
                </div>
            )}

            <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                    {copy.label}
                </label>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">฿</span>
                        <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={MIN_ORDER_MAX_THB}
                            step={10}
                            value={draft}
                            onChange={(e) => { setDraft(e.target.value); setError(null); }}
                            className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-8 pr-4 text-white font-bold outline-none focus:border-brand-cyan transition-colors"
                        />
                    </div>
                    <button
                        onClick={save}
                        disabled={busy || !dirty}
                        className="h-11 px-5 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        {copy.save}
                    </button>
                </div>
                <div className="flex gap-2 mt-2">
                    {PRESETS.map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => { setDraft(String(value)); setError(null); }}
                            className={`h-8 px-3 rounded-lg text-[11px] font-black transition-colors ${
                                Number(draft) === value
                                    ? 'bg-brand-cyan text-brand-darker'
                                    : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                            }`}
                        >
                            {value === 0 ? copy.off : `฿${value}`}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">{copy.hint}</p>
            </div>
        </div>
    );
}
