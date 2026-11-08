'use client';

import React from 'react';
import BodyPortal from './BodyPortal';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { handoffOf, pickupBookedAt, isPickupCancelled, PICKUP_REBOOK_AFTER_MS, type HandoffFields, type ShipMethod } from '@/lib/orderGroups';
import { CARRIERS, isByHand } from '@/lib/carriers';

/**
 * How a seller's parcel reaches Flash, for both shells (mobile Pending
 * Shipments in components/Profile.tsx, desktop "To ship" in
 * components/desktop/DesktopOrders.tsx).
 *
 * Every label used to book a courier pickup at the seller's profile address
 * without saying so. Sellers were out, or had not packed yet, and Flash
 * cancelled 6 of 7 such pickups (2026-10). Now the seller chooses when they
 * create the label (ShipMethodSheet), and the parcel card says what was
 * arranged and lets them book a courier later (ParcelHandoffNote).
 *
 * A parcel can also leave without any Flash scan of our label (handed to
 * Flash staff who key it in themselves, another courier, by hand). The order
 * would then sit at label_generated forever, so the seller says so in
 * ShippedElsewhereSheet (POST /api/orders/label/handoff) and HandoffSummary
 * shows what they told us.
 */

export interface PickupInfo {
    /** One line from the seller's profile (lib/parcels formatPickupAddress). */
    address: string | null;
    phone: string | null;
}

// Flash's own locator lists official branches only. A maps search for
// "Flash Express" returns Flash Home franchise shops too, and those have
// refused parcels carrying our API labels (2026-11).
const FLASH_BRANCH_SEARCH_URL = 'https://www.flashexpress.co.th/fle/location';

async function openFlashBranchSearch() {
    try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({ url: FLASH_BRANCH_SEARCH_URL });
            return;
        }
    } catch {
        // Not in the native shell; fall through to a normal tab.
    }
    window.open(FLASH_BRANCH_SEARCH_URL, '_blank', 'noopener');
}

/**
 * Asked when the seller creates a label ('create': drop-off or pickup), or
 * when they book a courier for a parcel that already has one ('pickup').
 * Drop-off is one tap; a pickup shows the address the courier will go to and
 * needs its own confirm, because it sends a person to the seller's door.
 */
export function ShipMethodSheet({ mode, pickup, onChoose, onClose, onEditAddress }: {
    mode: 'create' | 'pickup';
    pickup: PickupInfo | null;
    onChoose: (method: ShipMethod) => void;
    onClose: () => void;
    onEditAddress?: () => void;
}) {
    const { t } = useTranslation();
    const address = pickup?.address || null;

    return (
        <BodyPortal>
        <div
            className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 bg-brand-darker/90 backdrop-blur-sm"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))', paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-sm max-h-full overflow-y-auto glass rounded-3xl p-6 border border-white/10 relative bg-slate-900"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="ship-method-title"
            >
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-green to-brand-cyan"></div>
                <div className="flex justify-between items-start gap-3 mb-2">
                    <h3 id="ship-method-title" className="text-lg font-black text-white leading-tight">
                        {mode === 'create' ? t('parcel.methodTitle') : t('parcel.bookPickup')}
                    </h3>
                    <button onClick={onClose} aria-label={t('orderActions.cancel')} className="w-8 h-8 flex-shrink-0 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <i className="fa-solid fa-xmark text-slate-400"></i>
                    </button>
                </div>
                {mode === 'create' && (
                    <p className="text-slate-400 text-sm mb-4 leading-relaxed">{t('parcel.methodIntro')}</p>
                )}

                <div className="space-y-3">
                    {mode === 'create' && (
                        <button
                            onClick={() => onChoose('dropoff')}
                            className="w-full text-left rounded-2xl border border-brand-green/30 bg-brand-green/10 hover:bg-brand-green/20 p-4 transition-colors"
                        >
                            <span className="flex items-center gap-2 text-brand-green font-bold text-sm">
                                <i className="fa-solid fa-store"></i>
                                {t('parcel.dropoffTitle')}
                            </span>
                            <span className="block text-slate-300 text-xs leading-relaxed mt-1.5">{t('parcel.dropoffBody')}</span>
                        </button>
                    )}

                    <div className="rounded-2xl border border-brand-cyan/30 bg-brand-cyan/5 p-4 space-y-3">
                        <div>
                            <p className="flex items-center gap-2 text-brand-cyan font-bold text-sm">
                                <i className="fa-solid fa-truck"></i>
                                {t('parcel.pickupTitle')}
                            </p>
                            <p className="text-slate-300 text-xs leading-relaxed mt-1.5">{t('parcel.pickupBody')}</p>
                        </div>
                        <div className="rounded-xl bg-black/30 border border-white/5 px-3 py-2.5 space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('parcel.pickupAddress')}</p>
                            <p className="text-white text-xs leading-relaxed break-words">{address || t('parcel.noPickupAddress')}</p>
                            {address && pickup?.phone && (
                                <p className="text-slate-400 text-xs">{t('parcel.pickupPhone')}: <span className="text-slate-200">{pickup.phone}</span></p>
                            )}
                            {onEditAddress && (
                                <button onClick={onEditAddress} className="text-brand-cyan text-xs font-bold underline underline-offset-2">
                                    {t('parcel.editAddress')}
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => onChoose('pickup')}
                            disabled={!address}
                            className="w-full h-11 rounded-xl bg-brand-cyan text-black font-bold text-sm hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {t('parcel.bookPickupConfirm')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
        </BodyPortal>
    );
}

interface HandoffLabel {
    pickup_status?: string | null;
    updated_at?: string | null;
}

/**
 * The line under a labelled parcel Flash has not scanned yet: what was
 * arranged, and the way out when it did not happen. A pickup Flash cancelled
 * (found by the reconcile-pickups cron, pickup_status 'cancelled') says so
 * plainly and offers Book again at once; while a booking still reads
 * 'scheduled', the seller may book again after PICKUP_REBOOK_AFTER_MS
 * (lib/parcels bookPickup enforces the same window).
 */
export function ParcelHandoffNote({ labels, busy, onBookPickup, onShippedElsewhere }: {
    labels: (HandoffLabel | null | undefined)[];
    busy: boolean;
    onBookPickup: () => void;
    /** The parcel already left without a Flash scan of this label. */
    onShippedElsewhere?: () => void;
}) {
    const { t, isThai } = useTranslation();
    const statuses = labels.map((l) => l?.pickup_status || null);
    const bookedAt = pickupBookedAt(labels);
    const requesting = statuses.includes('requesting');
    const cancelled = isPickupCancelled(labels);
    const failed = !bookedAt && !cancelled && statuses.includes('manual');
    const canRebook = bookedAt !== null && Date.now() - bookedAt >= PICKUP_REBOOK_AFTER_MS;
    const alert = cancelled || failed;

    let text: string;
    if (bookedAt !== null) {
        const when = new Date(bookedAt).toLocaleString(isThai ? 'th-TH' : 'en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        text = t('parcel.pickupBooked').replace('{when}', when);
    } else if (cancelled) {
        text = t('parcel.pickupCancelled');
    } else if (failed) {
        text = t('parcel.pickupNotBooked');
    } else {
        text = t('parcel.dropoffPlanned');
    }

    const showBook = !requesting && (bookedAt === null || canRebook);
    const icon = cancelled ? 'fa-triangle-exclamation' : bookedAt !== null ? 'fa-truck' : 'fa-store';

    return (
        <div className={`rounded-xl border p-3 space-y-2 ${alert ? 'border-amber-500/20 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}>
            <p className={`text-xs leading-relaxed flex gap-2 ${alert ? 'text-amber-200' : 'text-slate-300'}`}>
                <i className={`fa-solid ${icon} mt-0.5 opacity-70`}></i>
                <span>{text}</span>
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {(showBook || requesting || busy) && (
                    <button
                        onClick={onBookPickup}
                        disabled={busy || requesting}
                        className="h-9 px-3 rounded-lg bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/30 font-bold text-xs hover:bg-brand-cyan/25 transition-colors disabled:opacity-50"
                    >
                        {busy || requesting
                            ? t('parcel.bookingPickup')
                            : cancelled ? t('parcel.bookAgain')
                            : bookedAt !== null ? t('parcel.rebookPickup') : t('parcel.bookPickup')}
                    </button>
                )}
                <button
                    onClick={openFlashBranchSearch}
                    className="text-slate-400 hover:text-white text-xs font-bold underline underline-offset-2"
                >
                    {t('parcel.findBranch')}
                </button>
                {onShippedElsewhere && (
                    <button
                        onClick={onShippedElsewhere}
                        className="text-slate-400 hover:text-white text-xs font-bold underline underline-offset-2"
                    >
                        {t('parcel.shippedElsewhere')}
                    </button>
                )}
            </div>
        </div>
    );
}

export const HANDOFF_FIELD_MAX = 60;

/** The buyer's details a seller copies onto the counter's form (self mode). */
export interface RecipientInfo {
    name: string | null;
    phone: string | null;
    address: string | null;
}

/**
 * Two jobs, one sheet. 'self': the seller shipped a PAID order themselves,
 * from any counter, and enters the number it gave them (lib/parcels
 * shipSelf; the buyer's address and phone are shown so they can fill the
 * form, and the number is required unless the cards were handed over in
 * person). 'elsewhere': a parcel that already had our Flash label left
 * another way (lib/parcels handOffParcel; the number is optional). Carrier
 * chips come from lib/carriers so the same names reach 17TRACK; free text
 * covers everything else.
 */
export function ShippedElsewhereSheet({ busy, onSubmit, onClose, mode = 'elsewhere', recipient = null }: {
    busy: boolean;
    onSubmit: (carrier: string, trackingNumber: string) => void;
    onClose: () => void;
    mode?: 'elsewhere' | 'self';
    recipient?: RecipientInfo | null;
}) {
    const { t, isThai } = useTranslation();
    const [carrier, setCarrier] = React.useState('');
    const [trackingNumber, setTrackingNumber] = React.useState('');
    const [copied, setCopied] = React.useState(false);
    const needsNumber = mode === 'self' && !isByHand(carrier);
    const canSubmit = carrier.trim().length > 0 && (!needsNumber || trackingNumber.trim().length > 0) && !busy;
    const copyRecipient = async () => {
        const text = [recipient?.name, recipient?.phone, recipient?.address].filter(Boolean).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard blocked (http, old WebView): the details are on screen anyway.
        }
    };
    const inputClass =
        'w-full h-11 rounded-xl bg-black/30 border border-white/10 px-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-brand-cyan/50';

    return (
        <BodyPortal>
        <div
            className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 bg-brand-darker/90 backdrop-blur-sm"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))', paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
            onClick={busy ? undefined : onClose}
        >
            <form
                className="w-full max-w-sm max-h-full overflow-y-auto glass rounded-3xl p-6 border border-white/10 relative bg-slate-900 space-y-4"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                    e.preventDefault();
                    if (canSubmit) onSubmit(carrier.trim(), trackingNumber.trim());
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="shipped-elsewhere-title"
            >
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-green to-brand-cyan"></div>
                <div className="flex justify-between items-start gap-3">
                    <h3 id="shipped-elsewhere-title" className="text-lg font-black text-white leading-tight">
                        {t(mode === 'self' ? 'parcel.shipSelfTitle' : 'parcel.shippedElsewhereTitle')}
                    </h3>
                    <button type="button" onClick={onClose} disabled={busy} aria-label={t('orderActions.cancel')} className="w-8 h-8 flex-shrink-0 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <i className="fa-solid fa-xmark text-slate-400"></i>
                    </button>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed">
                    {t(mode === 'self' ? 'parcel.shipSelfIntro' : 'parcel.shippedElsewhereIntro')}
                </p>

                {mode === 'self' && recipient && (recipient.name || recipient.phone || recipient.address) && (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('parcel.recipientLabel')}</p>
                            <button type="button" onClick={copyRecipient} className="text-brand-cyan text-xs font-bold hover:text-white transition-colors">
                                {copied ? t('parcel.copied') : t('parcel.copyAddress')}
                            </button>
                        </div>
                        {recipient.name && <p className="text-sm text-white font-bold">{recipient.name}</p>}
                        {recipient.phone && <p className="text-sm text-slate-200 font-mono">{recipient.phone}</p>}
                        {recipient.address && <p className="text-sm text-slate-300 leading-relaxed">{recipient.address}</p>}
                    </div>
                )}

                <div className="space-y-2">
                    <label htmlFor="handoff-carrier" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {t('parcel.carrierLabel')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {CARRIERS.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setCarrier(c.name)}
                                className={`h-8 px-3 rounded-full border text-xs font-bold transition-colors ${
                                    carrier === c.name
                                        ? 'bg-brand-cyan/20 border-brand-cyan/40 text-brand-cyan'
                                        : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                                }`}
                            >
                                {isThai ? c.nameTh : c.name}
                            </button>
                        ))}
                    </div>
                    <input
                        id="handoff-carrier"
                        value={carrier}
                        onChange={(e) => setCarrier(e.target.value)}
                        maxLength={HANDOFF_FIELD_MAX}
                        placeholder={t('parcel.carrierPlaceholder')}
                        className={inputClass}
                        autoComplete="off"
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor="handoff-tracking" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {t(needsNumber ? 'parcel.trackingLabelRequired' : 'parcel.handoffTrackingLabel')}
                    </label>
                    <input
                        id="handoff-tracking"
                        value={trackingNumber}
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        maxLength={HANDOFF_FIELD_MAX}
                        placeholder={t('parcel.handoffTrackingPlaceholder')}
                        className={`${inputClass} font-mono`}
                        autoComplete="off"
                        required={needsNumber}
                    />
                </div>

                <button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-full h-11 rounded-xl bg-brand-cyan text-black font-bold text-sm hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {busy ? t('parcel.shippedElsewhereBusy') : t(mode === 'self' ? 'parcel.shipSelfConfirm' : 'parcel.shippedElsewhereConfirm')}
                </button>
            </form>
        </div>
        </BodyPortal>
    );
}

/**
 * What the seller told us about a parcel that left outside our waybill:
 * "Shipped via Kerry Express · KEX123". Renders nothing for a Flash parcel.
 */
export function HandoffSummary({ label, className }: { label: HandoffFields | null | undefined; className?: string }) {
    const { t } = useTranslation();
    const handoff = handoffOf(label);
    if (!handoff) return null;
    return (
        <p className={`text-xs text-slate-300 flex gap-2 items-start ${className || ''}`}>
            <i className="fa-solid fa-truck-fast mt-0.5 opacity-70"></i>
            <span>
                {t('parcel.shippedVia').replace('{carrier}', handoff.carrier || t('parcel.anotherCarrier'))}
                {handoff.trackingNumber && (
                    <> · <span className="font-mono text-white">{handoff.trackingNumber}</span></>
                )}
            </span>
        </p>
    );
}
