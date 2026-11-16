'use client';

import React from 'react';
import BodyPortal from './BodyPortal';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { handoffOf, pickupBookedAt, isPickupCancelled, PICKUP_REBOOK_AFTER_MS, type HandoffFields } from '@/lib/orderGroups';
import { CARRIERS, isByHand } from '@/lib/carriers';

/**
 * How a seller's parcel leaves, for both shells (mobile Pending Shipments in
 * components/Profile.tsx, desktop "To ship" in
 * components/desktop/DesktopOrders.tsx).
 *
 * One question, two answers (2026-11-16). A Flash courier picks it up: the
 * label is minted and the courier booked in one tap (CourierSheet). Or the
 * seller sends it themselves from any counter and enters the number
 * (SendMyselfSheet). There used to be a third: print our Flash label and take
 * it to a branch. Counters refused those labels (Flash Home shops, phone-screen
 * QR codes, branches that could not scan them): of 17 such parcels since
 * 2026-10-01 five arrived, four were cancelled and eight sat unscanned, while
 * 20 of 21 parcels with a booked courier moved. A counter that makes its own
 * label always takes the parcel, so "send it yourself" replaces it.
 *
 * "Send it yourself" works before a label exists (lib/parcels shipSelf) and
 * after one was made and never used (handOffParcel: a cancelled courier, a
 * legacy drop-off label); the seller sees one action either way, always with
 * the buyer's details, and HandoffSummary shows what they told us.
 */

export interface PickupInfo {
    /** One line from the seller's profile (lib/parcels formatPickupAddress). */
    address: string | null;
    phone: string | null;
}

/** The buyer's details a seller copies onto the counter's form. */
export interface RecipientInfo {
    name: string | null;
    phone: string | null;
    address: string | null;
}

/**
 * The two answers on a parcel waiting to ship, as tiles with a line each, so
 * the choice reads without opening anything. Mobile card only; desktop puts
 * the same two actions in its row buttons.
 */
export function ShipChoices({ busy, onCourier, onSendMyself }: {
    busy: boolean;
    onCourier: () => void;
    onSendMyself: () => void;
}) {
    const { t } = useTranslation();
    const tile = 'w-full text-left rounded-xl border p-3 flex gap-3 items-start transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    return (
        <div className="space-y-2">
            <p className="text-[11px] font-bold text-slate-400">{t('parcel.chooseHeading')}</p>
            <button
                onClick={onCourier}
                disabled={busy}
                className={`${tile} border-brand-green/30 bg-brand-green/10 hover:bg-brand-green/20`}
            >
                <i className="fa-solid fa-truck text-brand-green mt-0.5 w-4 text-center"></i>
                <span className="min-w-0">
                    <span className="block text-sm font-bold text-brand-green">
                        {busy ? t('parcel.creating') : t('parcel.courierChoice')}
                    </span>
                    <span className="block text-xs text-slate-300 leading-relaxed mt-0.5">{t('parcel.courierChoiceBody')}</span>
                </span>
            </button>
            <button
                onClick={onSendMyself}
                disabled={busy}
                className={`${tile} border-white/10 bg-white/5 hover:bg-white/10`}
            >
                <i className="fa-solid fa-store text-slate-300 mt-0.5 w-4 text-center"></i>
                <span className="min-w-0">
                    <span className="block text-sm font-bold text-white">{t('parcel.sendMyself')}</span>
                    <span className="block text-xs text-slate-400 leading-relaxed mt-0.5">{t('parcel.sendMyselfBody')}</span>
                </span>
            </button>
        </div>
    );
}

/**
 * Booking a Flash courier: for a new parcel ('create': the label is minted and
 * the courier booked in one request) or for a parcel that already has its
 * label ('pickup': book again after a cancelled or missed courier). It shows
 * the address the courier goes to and needs its own confirm, because it sends
 * a person to the seller's door. `onSendMyself` is the way out for a seller
 * with no printer, or who will not be home.
 */
export function CourierSheet({ mode, pickup, onConfirm, onClose, onEditAddress, onSendMyself }: {
    mode: 'create' | 'pickup';
    pickup: PickupInfo | null;
    onConfirm: () => void;
    onClose: () => void;
    onEditAddress?: () => void;
    onSendMyself?: () => void;
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
                className="w-full max-w-sm max-h-full overflow-y-auto glass rounded-3xl p-6 border border-white/10 relative bg-slate-900 space-y-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="courier-sheet-title"
            >
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-green to-brand-cyan"></div>
                <div className="flex justify-between items-start gap-3">
                    <h3 id="courier-sheet-title" className="text-lg font-black text-white leading-tight">
                        {mode === 'create' ? t('parcel.courierTitle') : t('parcel.bookPickup')}
                    </h3>
                    <button onClick={onClose} aria-label={t('orderActions.cancel')} className="w-8 h-8 flex-shrink-0 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <i className="fa-solid fa-xmark text-slate-400"></i>
                    </button>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed">{t('parcel.pickupBody')}</p>

                <div className="rounded-xl bg-black/30 border border-white/5 px-3 py-2.5 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('parcel.pickupAddress')}</p>
                    <p className="text-white text-sm leading-relaxed break-words">{address || t('parcel.noPickupAddress')}</p>
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
                    onClick={onConfirm}
                    disabled={!address}
                    className="w-full h-11 rounded-xl bg-brand-cyan text-black font-bold text-sm hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {t('parcel.bookPickupConfirm')}
                </button>

                {onSendMyself && (
                    <button
                        onClick={onSendMyself}
                        className="w-full text-center text-slate-400 hover:text-white text-xs font-bold underline underline-offset-2"
                    >
                        {t('parcel.courierSendMyselfInstead')}
                    </button>
                )}
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
 * The note under a labelled parcel Flash has not scanned yet: whether a
 * courier is coming, and the two ways forward. A pickup Flash cancelled
 * (found by the reconcile-pickups cron, pickup_status 'cancelled') says so
 * plainly and offers Book again at once; while a booking still reads
 * 'scheduled', the seller may book again after PICKUP_REBOOK_AFTER_MS
 * (lib/parcels bookPickup enforces the same window). A label with no courier
 * (the drop-off labels made before 2026-11-16) gets the same two choices.
 */
export function ParcelHandoffNote({ labels, busy, onBookPickup, onSendMyself }: {
    labels: (HandoffLabel | null | undefined)[];
    busy: boolean;
    onBookPickup: () => void;
    /** The seller sends it from a counter instead (or already did). */
    onSendMyself?: () => void;
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
        text = t('parcel.noCourierYet');
    }

    const showBook = !requesting && (bookedAt === null || canRebook);
    const icon = cancelled ? 'fa-triangle-exclamation' : bookedAt !== null ? 'fa-truck' : 'fa-box';

    return (
        <div className={`rounded-xl border p-3 space-y-2 ${alert ? 'border-amber-500/20 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}>
            <p className={`text-xs leading-relaxed flex gap-2 ${alert ? 'text-amber-200' : 'text-slate-300'}`}>
                <i className={`fa-solid ${icon} mt-0.5 opacity-70`}></i>
                <span>{text}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
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
                {onSendMyself && (
                    <button
                        onClick={onSendMyself}
                        className="h-9 px-3 rounded-lg bg-white/5 text-slate-200 border border-white/10 font-bold text-xs hover:bg-white/10 transition-colors"
                    >
                        {t('parcel.sendMyself')}
                    </button>
                )}
            </div>
        </div>
    );
}

export const HANDOFF_FIELD_MAX = 60;

/**
 * Send it yourself: the seller takes the parcel to any counter, pays there
 * and enters the number from the receipt. Shows the buyer's name, phone and
 * address with a Copy button for the counter's form. The number is required
 * unless the cards were handed over in person. Carrier chips come from
 * lib/carriers so the same names reach 17TRACK; free text covers the rest.
 * `labelled`: the parcel already has an unused Flash label, which the counter
 * does not need (the caller posts to /api/orders/label/handoff instead of
 * /self-ship).
 */
export function SendMyselfSheet({ busy, onSubmit, onClose, recipient = null, labelled = false }: {
    busy: boolean;
    onSubmit: (carrier: string, trackingNumber: string) => void;
    onClose: () => void;
    recipient?: RecipientInfo | null;
    labelled?: boolean;
}) {
    const { t, isThai } = useTranslation();
    const [carrier, setCarrier] = React.useState('');
    const [trackingNumber, setTrackingNumber] = React.useState('');
    const [copied, setCopied] = React.useState(false);
    const needsNumber = !isByHand(carrier);
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
    const hasRecipient = !!recipient && !!(recipient.name || recipient.phone || recipient.address);

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
                aria-labelledby="send-myself-title"
            >
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-green to-brand-cyan"></div>
                <div className="flex justify-between items-start gap-3">
                    <h3 id="send-myself-title" className="text-lg font-black text-white leading-tight">
                        {t('parcel.sendMyselfTitle')}
                    </h3>
                    <button type="button" onClick={onClose} disabled={busy} aria-label={t('orderActions.cancel')} className="w-8 h-8 flex-shrink-0 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <i className="fa-solid fa-xmark text-slate-400"></i>
                    </button>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed">{t('parcel.sendMyselfIntro')}</p>
                {labelled && (
                    <p className="text-slate-400 text-xs leading-relaxed">{t('parcel.sendMyselfLabelled')}</p>
                )}

                {hasRecipient && (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('parcel.recipientLabel')}</p>
                            <button type="button" onClick={copyRecipient} className="text-brand-cyan text-xs font-bold hover:text-white transition-colors">
                                {copied ? t('parcel.copied') : t('parcel.copyAddress')}
                            </button>
                        </div>
                        {recipient?.name && <p className="text-sm text-white font-bold">{recipient.name}</p>}
                        {recipient?.phone && <p className="text-sm text-slate-200 font-mono">{recipient.phone}</p>}
                        {recipient?.address && <p className="text-sm text-slate-300 leading-relaxed">{recipient.address}</p>}
                    </div>
                )}

                <div className="space-y-2">
                    <label htmlFor="send-myself-carrier" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
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
                        id="send-myself-carrier"
                        value={carrier}
                        onChange={(e) => setCarrier(e.target.value)}
                        maxLength={HANDOFF_FIELD_MAX}
                        placeholder={t('parcel.carrierPlaceholder')}
                        className={inputClass}
                        autoComplete="off"
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor="send-myself-tracking" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {t(needsNumber ? 'parcel.trackingLabelRequired' : 'parcel.handoffTrackingLabel')}
                    </label>
                    <input
                        id="send-myself-tracking"
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
                    {busy ? t('parcel.sendMyselfBusy') : t('parcel.sendMyselfConfirm')}
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
