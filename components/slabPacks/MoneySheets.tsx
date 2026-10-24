'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, Coins, CreditCard, Landmark, MapPin, ShieldCheck, Tag, Truck, UserCheck, Wallet } from 'lucide-react';
import {
    CASHOUT_BUSINESS_DAYS, CASHOUT_HOLD_DAYS, CASHOUT_MIN_THB, CASHOUT_MONTHLY_CAP_THB, CASHOUT_REQUIRES,
    COINS_PER_THB, MARKET_FEE_RATE, PULL_MARKET_FEE_RATE, SHIP_DAYS,
    cashoutFeeThb, cashoutNetThb, listingPayoutThb, missingVerification, thbForCoins,
    type VerificationKind,
} from '@/lib/slabPacks/policy';
import { getSlab } from '@/lib/slabPacks/pool';
import {
    cashedOutThisMonthThb, previewActions, shippingQuote, withdrawableThb,
    type CashoutBlock, type LedgerKind, type PreviewState,
} from '@/lib/slabPacks/previewStore';
import { sfx } from '@/lib/slabPacks/sfx';
import { TIERS } from '@/lib/slabPacks/tiers';
import type { Pull, ShipTo } from '@/lib/slabPacks/types';
import { Sheet, SheetHeader, pct } from './Sheets';
import SlabCard from './SlabCard';
import { baht, useSp } from './ui';

/**
 * The sheets that move money: the wallet and its cash-out, the mock identity
 * checks, listing a pull on the marketplace, and shipping a slab out of the
 * vault. Every rule they show comes from lib/slabPacks/policy.ts; every
 * action goes through the preview store, which stands in for the ledger,
 * the KYC vendor, the listing table and fulfilment.
 */

const VERIFY_ICON: Record<VerificationKind, React.ReactNode> = {
    identity: <UserCheck size={16} />,
    address: <MapPin size={16} />,
    bank: <Landmark size={16} />,
};

/** One line of a requirements checklist: done, or a button to go and do it. */
function Requirement({ kind, done, onVerify }: { kind: VerificationKind; done: boolean; onVerify: (kind: VerificationKind) => void }) {
    const { t } = useSp();
    return (
        <div className="flex items-center gap-3 px-3.5 py-3">
            <span className={done ? 'text-emerald-400' : 'text-white/60'}>{VERIFY_ICON[kind]}</span>
            <span className="min-w-0 flex-1 text-[13px] font-bold">{t(`verify.${kind}`)}</span>
            {done ? (
                <span className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">
                    <Check size={13} strokeWidth={3} />
                    {t('verify.verified')}
                </span>
            ) : (
                <button
                    className="sp-btn sp-btn-primary h-[34px] px-3 text-[12px]"
                    onClick={() => {
                        sfx.tap();
                        onVerify(kind);
                    }}
                >
                    {t('verify.cta')}
                </button>
            )}
        </div>
    );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
            <span className="text-white/55">{label}</span>
            <span className={`sp-num ${strong ? 'text-[16px] text-white' : 'text-white/85'}`}>{value}</span>
        </div>
    );
}

function Field({
    id, label, value, onChange, placeholder, type = 'text', multiline,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
    multiline?: boolean;
}) {
    const cls = 'mt-1.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white outline-none placeholder:text-white/30 focus:border-white/30';
    return (
        <label className="block" htmlFor={id}>
            <span className="sp-label">{label}</span>
            {multiline ? (
                <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={cls} />
            ) : (
                <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} autoComplete="off" />
            )}
        </label>
    );
}

function Checkbox({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
    return (
        <button
            role="checkbox"
            aria-checked={checked}
            onClick={() => {
                sfx.tap();
                onChange(!checked);
            }}
            className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
        >
            <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors"
                style={{ background: checked ? '#34D399' : 'transparent', borderColor: checked ? '#34D399' : 'rgba(255,255,255,0.3)' }}
            >
                {checked && <Check size={13} strokeWidth={3.5} className="text-black" />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold">{label}</span>
                {sub && <span className="block text-[11.5px] leading-snug text-white/50">{sub}</span>}
            </span>
        </button>
    );
}

// ── Wallet + cash-out ───────────────────────────────────────────────────────

export function WalletSheet({
    open, onClose, state, onVerify,
}: {
    open: boolean;
    onClose: () => void;
    state: PreviewState;
    onVerify: (kind: VerificationKind) => void;
}) {
    const { t, isThai } = useSp();
    const [view, setView] = useState<'wallet' | 'cashout'>('wallet');
    const [amount, setAmount] = useState('');
    const [result, setResult] = useState<{ block: CashoutBlock | null; net?: number } | null>(null);
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (open) {
            setNow(Date.now());
            setView('wallet');
            setResult(null);
        }
    }, [open]);

    const withdrawable = withdrawableThb(state, now);
    const monthUsed = cashedOutThisMonthThb(state, now);
    const missing = missingVerification(state.verification, CASHOUT_REQUIRES);
    const amountThb = Math.max(0, Math.floor(Number(amount) || 0));
    const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(isThai ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
    const pending = state.cashouts.filter((c) => c.status === 'pending');

    const startCashout = () => {
        sfx.tap();
        setAmount(String(withdrawable));
        setResult(null);
        setView('cashout');
    };

    const submit = () => {
        const block = previewActions.requestCashout(amountThb);
        if (block) {
            sfx.deny();
            setResult({ block });
            return;
        }
        sfx.coins();
        setResult({ block: null, net: cashoutNetThb(amountThb) });
    };

    return (
        <Sheet open={open} onClose={onClose}>
            <SheetHeader
                title={view === 'wallet' ? t('wallet.title') : t('cashout.title')}
                sub={view === 'wallet' ? t('wallet.sub') : t('cashout.sub')}
                onClose={view === 'wallet' ? onClose : () => setView('wallet')}
            />
            <div className="sp-scroll min-h-0 flex-1 px-5 pb-6">
                {view === 'wallet' ? (
                    <>
                        <div className="sp-card rounded-[22px] p-4">
                            <div className="flex items-center gap-2 text-white/60">
                                <Wallet size={15} />
                                <span className="sp-label">{t('wallet.balance')}</span>
                            </div>
                            <div className="sp-num mt-1.5 text-[38px] leading-none">{baht(state.walletThb)}</div>
                            <div className="mt-1.5 text-[11.5px] text-white/50">{t('wallet.fromSellbacks')}</div>
                            <div className="mt-3 flex items-center justify-between text-[12px]">
                                <span className="text-white/55">{t('wallet.withdrawable')}</span>
                                <span className="sp-num">{baht(withdrawable)}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-white/40">{t('wallet.hold', { d: CASHOUT_HOLD_DAYS })}</div>
                            <button className="sp-btn sp-btn-ghost mt-3 h-[46px] w-full text-[14px]" onClick={startCashout}>
                                <ArrowDownToLine size={16} />
                                {t('wallet.cashOut')}
                            </button>
                        </div>

                        <div className="sp-card mt-3 flex items-center gap-3 rounded-[22px] p-4">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-300/15 text-amber-300">
                                <Coins size={18} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="sp-label">{t('wallet.coins')}</div>
                                <div className="sp-num mt-0.5 text-[20px] leading-none">{state.coins.toLocaleString('en-US')}</div>
                                <div className="mt-1 text-[11px] text-white/50">
                                    {t('wallet.coinsWorth', { amount: baht(thbForCoins(state.coins)), per: COINS_PER_THB })}
                                </div>
                            </div>
                        </div>

                        {pending.length > 0 && (
                            <>
                                <div className="sp-label mt-5">{t('wallet.pending')}</div>
                                <div className="mt-2 overflow-hidden rounded-[20px] border border-white/10">
                                    {pending.map((c, n) => (
                                        <div key={c.id} className={`flex items-center gap-3 px-3.5 py-3 text-[12.5px] ${n ? 'border-t border-white/10' : ''}`}>
                                            <Landmark size={15} className="shrink-0 text-white/55" />
                                            <span className="min-w-0 flex-1 text-white/70">
                                                {t('wallet.pendingRow', { net: baht(c.netThb), date: fmtDate(c.expectedAt) })}
                                            </span>
                                            <span className="sp-num shrink-0">-{baht(c.amountThb)}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        <div className="sp-label mt-5">{t('wallet.ledgerTitle')}</div>
                        {state.ledger.length === 0 ? (
                            <p className="mt-2 text-[12px] text-white/45">{t('wallet.empty')}</p>
                        ) : (
                            <div className="mt-2 overflow-hidden rounded-[20px] border border-white/10">
                                {state.ledger.slice(0, 8).map((e, n) => (
                                    <LedgerRow key={e.id} kind={e.kind} thb={e.thb} label={e.ref ? getSlab(state.pulls.find((p) => p.id === e.ref)?.slabKey ?? '')?.name : undefined} first={n === 0} date={fmtDate(e.at)} />
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        {/* Verification first: nothing below is usable without it. */}
                        <div className="overflow-hidden rounded-[20px] border border-white/10">
                            {CASHOUT_REQUIRES.map((k, n) => (
                                <div key={k} className={n ? 'border-t border-white/10' : ''}>
                                    <Requirement kind={k} done={state.verification[k]} onVerify={onVerify} />
                                </div>
                            ))}
                        </div>

                        <div className="sp-card mt-3 rounded-[22px] p-4">
                            <label className="sp-label" htmlFor="sp-cashout-amount">{t('cashout.amount')}</label>
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className="sp-num text-[24px] text-white/60">฿</span>
                                <input
                                    id="sp-cashout-amount"
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    value={amount}
                                    onChange={(e) => {
                                        setAmount(e.target.value);
                                        setResult(null);
                                    }}
                                    className="sp-num min-w-0 flex-1 bg-transparent text-[30px] leading-none text-white outline-none"
                                />
                                <button
                                    className="sp-mini rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-extrabold"
                                    onClick={() => setAmount(String(withdrawable))}
                                >
                                    {t('cashout.max')}
                                </button>
                            </div>
                            <div className="mt-3 border-t border-white/10 pt-2">
                                <Row label={t('cashout.withdrawable')} value={baht(withdrawable)} />
                                <Row label={t('cashout.fee', { rate: pct(0.03) })} value={`-${baht(amountThb ? cashoutFeeThb(amountThb) : 0)}`} />
                                <Row label={t('cashout.net')} value={baht(amountThb ? cashoutNetThb(amountThb) : 0)} strong />
                                <Row label={t('cashout.timing')} value={t('cashout.days', { d1: CASHOUT_BUSINESS_DAYS[0], d2: CASHOUT_BUSINESS_DAYS[1] })} />
                            </div>
                        </div>
                        <p className="mt-2.5 text-[11px] leading-snug text-white/45">
                            {t('cashout.rules', { min: baht(CASHOUT_MIN_THB), hold: CASHOUT_HOLD_DAYS, cap: baht(CASHOUT_MONTHLY_CAP_THB), used: baht(monthUsed) })}
                        </p>

                        {result?.block && (
                            <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3.5 text-[12.5px] text-rose-100">
                                {t(`cashout.blocked.${result.block}`, { min: baht(CASHOUT_MIN_THB), hold: CASHOUT_HOLD_DAYS, cap: baht(CASHOUT_MONTHLY_CAP_THB), avail: baht(withdrawable) })}
                            </div>
                        )}
                        {result && !result.block && (
                            <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3.5 text-[12.5px] text-emerald-100">
                                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                                {t('cashout.done', { net: baht(result.net ?? 0), d1: CASHOUT_BUSINESS_DAYS[0], d2: CASHOUT_BUSINESS_DAYS[1] })}
                            </div>
                        )}

                        <button
                            className="sp-btn sp-btn-primary mt-4 h-[54px] w-full text-[16px]"
                            disabled={missing.length > 0 || amountThb <= 0 || (!!result && !result.block)}
                            onClick={submit}
                        >
                            <Landmark size={17} />
                            {missing.length > 0 ? t('cashout.needs') : t('cashout.submit', { net: baht(amountThb ? cashoutNetThb(amountThb) : 0) })}
                        </button>
                    </>
                )}
            </div>
        </Sheet>
    );
}

const LEDGER_ICON: Record<LedgerKind, React.ReactNode> = {
    sellback: <Coins size={15} />,
    pack: <CreditCard size={15} />,
    ship_fee: <Truck size={15} />,
    cashout: <Landmark size={15} />,
};

function LedgerRow({ kind, thb, label, first, date }: { kind: LedgerKind; thb: number; label?: string; first: boolean; date: string }) {
    const { t } = useSp();
    return (
        <div className={`flex items-center gap-3 px-3.5 py-2.5 text-[12.5px] ${first ? '' : 'border-t border-white/10'}`}>
            <span className="shrink-0 text-white/55">{LEDGER_ICON[kind]}</span>
            <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{t(`wallet.kinds.${kind}`)}</span>
                <span className="block truncate text-[10.5px] text-white/45">{label ? `${label} · ${date}` : date}</span>
            </span>
            <span className={`sp-num shrink-0 ${thb >= 0 ? 'text-emerald-400' : 'text-white/85'}`}>
                {thb >= 0 ? '+' : '-'}{baht(Math.abs(thb))}
            </span>
        </div>
    );
}

// ── Mock identity checks ────────────────────────────────────────────────────

export function VerifySheet({ kind, onClose }: { kind: VerificationKind | null; onClose: () => void }) {
    const { t } = useSp();
    const [shown, setShown] = useState<VerificationKind | null>(kind);
    const [stage, setStage] = useState<'form' | 'reviewing' | 'done'>('form');
    useEffect(() => {
        if (kind) {
            setShown(kind);
            setStage('form');
        }
    }, [kind]);
    // The real vendor review takes minutes to days; the mock takes a moment,
    // long enough to read as a review and not a toggle.
    useEffect(() => {
        if (stage !== 'reviewing' || !shown) return;
        const id = setTimeout(() => {
            previewActions.verify(shown);
            sfx.keep();
            setStage('done');
        }, 1600);
        return () => clearTimeout(id);
    }, [stage, shown]);

    const k = shown;
    return (
        <Sheet open={!!kind} onClose={onClose}>
            {k && (
                <>
                    <SheetHeader title={t(`verify.${k}Title`)} sub={t(`verify.${k}Body`)} onClose={onClose} />
                    <div className="sp-scroll min-h-0 flex-1 px-5 pb-6">
                        <ol className="overflow-hidden rounded-[20px] border border-white/10">
                            {([1, 2, 3] as const).map((n) => (
                                <li key={n} className={`flex items-center gap-3 px-3.5 py-3 text-[13px] ${n > 1 ? 'border-t border-white/10' : ''}`}>
                                    <span className="sp-num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">{n}</span>
                                    <span className="text-white/80">{t(`verify.${k}${n}`)}</span>
                                </li>
                            ))}
                        </ol>
                        <p className="mt-3 text-[11.5px] leading-snug text-white/45">{t('verify.note')}</p>
                        {stage === 'done' ? (
                            <button className="sp-btn sp-btn-primary mt-5 h-[54px] w-full text-[16px]" onClick={onClose}>
                                <Check size={18} strokeWidth={3} />
                                {t('verify.done')}
                            </button>
                        ) : (
                            <button
                                className="sp-btn sp-btn-primary mt-5 h-[54px] w-full text-[16px]"
                                disabled={stage === 'reviewing'}
                                onClick={() => {
                                    sfx.tap();
                                    setStage('reviewing');
                                }}
                            >
                                {stage === 'reviewing' ? (
                                    <span className="sp-breathe">{t('verify.reviewing')}</span>
                                ) : (
                                    <>
                                        <ShieldCheck size={18} />
                                        {t('verify.submit')}
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </>
            )}
        </Sheet>
    );
}

// ── List on the marketplace ─────────────────────────────────────────────────

export function ListSheet({ pull, onClose }: { pull: Pull | null; onClose: () => void }) {
    const { t } = useSp();
    const [shown, setShown] = useState<Pull | null>(pull);
    const [price, setPrice] = useState('');
    useEffect(() => {
        if (pull) {
            setShown(pull);
            setPrice(String(getSlab(pull.slabKey)?.valueThb ?? 0));
        }
    }, [pull]);

    const p = shown;
    const slab = p ? getSlab(p.slabKey) : undefined;
    const priceThb = Math.max(0, Math.floor(Number(price) || 0));
    const payout = listingPayoutThb(priceThb);

    return (
        <Sheet open={!!pull} onClose={onClose}>
            {p && slab && (
                <>
                    <SheetHeader title={t('list.title')} sub={t('list.sub')} onClose={onClose} />
                    <div className="sp-scroll min-h-0 flex-1 px-5 pb-6">
                        <div className="flex items-center gap-3.5">
                            <div className="w-[64px] shrink-0">
                                <SlabCard slab={slab} tier={TIERS[p.tier]} art="small" flat foil={0.2} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-[15px] font-extrabold">{slab.name}</div>
                                <div className="truncate text-[12px] text-white/55">
                                    {slab.setName} · PSA {slab.grade}
                                </div>
                                <div className="mt-1 text-[12px] text-white/55">{t('list.market', { amount: baht(slab.valueThb) })}</div>
                            </div>
                        </div>

                        <div className="sp-card mt-4 rounded-[22px] p-4">
                            <label className="sp-label" htmlFor="sp-list-price">{t('list.price')}</label>
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className="sp-num text-[24px] text-white/60">฿</span>
                                <input
                                    id="sp-list-price"
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    className="sp-num min-w-0 flex-1 bg-transparent text-[30px] leading-none text-white outline-none"
                                />
                            </div>
                            <div className="mt-3 border-t border-white/10 pt-2">
                                <Row label={t('list.feeRow', { fee: pct(PULL_MARKET_FEE_RATE), std: pct(MARKET_FEE_RATE) })} value={`-${baht(priceThb - payout)}`} />
                                <Row label={t('list.payout')} value={baht(payout)} strong />
                            </div>
                        </div>
                        <p className="mt-2.5 text-[11.5px] leading-snug text-white/50">{t('list.shipNote')}</p>

                        <button
                            className="sp-btn sp-btn-primary mt-4 h-[54px] w-full text-[16px]"
                            disabled={priceThb < 1}
                            onClick={() => {
                                previewActions.list(p.id, priceThb);
                                sfx.keep();
                                onClose();
                            }}
                        >
                            <Tag size={17} strokeWidth={2.4} />
                            {t('list.submit', { price: baht(priceThb) })}
                        </button>
                    </div>
                </>
            )}
        </Sheet>
    );
}

// ── Ship a slab out of the vault: address, quote, checkout ──────────────────

type ShipStep = 'address' | 'quote' | 'checkout' | 'done';
const STEPS: ShipStep[] = ['address', 'quote', 'checkout'];

const EMPTY_SHIP_TO: ShipTo = { name: '', phone: '', address: '' };

export function ShipSheet({ pull, onClose, state }: { pull: Pull | null; onClose: () => void; state: PreviewState }) {
    const { t, isThai } = useSp();
    const [shown, setShown] = useState<Pull | null>(pull);
    const [step, setStep] = useState<ShipStep>('address');
    // Never prefilled: the collector types in where this slab goes.
    const [to, setTo] = useState<ShipTo>(EMPTY_SHIP_TO);
    const [calculating, setCalculating] = useState(false);
    const [insure, setInsure] = useState(false);
    const [terms, setTerms] = useState(false);
    const [bookedAt, setBookedAt] = useState(0);

    useEffect(() => {
        if (pull) {
            setShown(pull);
            setStep('address');
            setTo(EMPTY_SHIP_TO);
            setInsure(false);
            setTerms(false);
            setCalculating(false);
        }
    }, [pull]);

    // The quote "calculates": a beat long enough to read as a real lookup.
    useEffect(() => {
        if (step !== 'quote') return;
        setCalculating(true);
        const id = setTimeout(() => setCalculating(false), 1300);
        return () => clearTimeout(id);
    }, [step]);

    const p = shown;
    const slab = p ? getSlab(p.slabKey) : undefined;
    const quote = p ? shippingQuote(p, insure) : { feeThb: 0, insuranceThb: 0, totalThb: 0 };
    const insuranceIfChosen = p ? shippingQuote(p, true).insuranceThb : 0;
    const walletCovers = state.walletThb >= quote.totalThb;
    const method: 'wallet' | 'card' = walletCovers ? 'wallet' : 'card';
    const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(isThai ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
    const now = bookedAt || Date.now();
    const window = [now + SHIP_DAYS[0] * 86_400_000, now + SHIP_DAYS[1] * 86_400_000];
    const phoneOk = /^\+?[0-9][0-9 -]{7,}$/.test(to.phone.trim());
    const addressOk = to.name.trim().length >= 2 && phoneOk && to.address.trim().length >= 10;

    const stepIndex = STEPS.indexOf(step);
    const back = () => {
        sfx.tap();
        if (step === 'quote') setStep('address');
        else if (step === 'checkout') setStep('quote');
    };

    const pay = () => {
        if (!p) return;
        if (previewActions.requestShipping(p.id, { method, shipTo: { name: to.name.trim(), phone: to.phone.trim(), address: to.address.trim() }, insure })) {
            sfx.keep();
            setBookedAt(Date.now());
            setStep('done');
        } else {
            sfx.deny();
        }
    };

    return (
        <Sheet open={!!pull} onClose={onClose}>
            {p && slab && (
                <>
                    <SheetHeader
                        title={t(`ship.${step}Title`)}
                        sub={step === 'done' ? undefined : t('ship.stepOf', { n: stepIndex + 1, total: STEPS.length })}
                        onClose={step === 'address' || step === 'done' ? onClose : back}
                    />
                    <div className="sp-scroll min-h-0 flex-1 px-5 pb-6">
                        {step !== 'done' && (
                            <div className="mb-4 flex gap-1.5">
                                {STEPS.map((s, i) => (
                                    <span key={s} className="h-1 flex-1 rounded-full" style={{ background: i <= stepIndex ? 'var(--sp-glow, #fff)' : 'rgba(255,255,255,0.12)' }} />
                                ))}
                            </div>
                        )}

                        <div className="flex items-center gap-3.5">
                            <div className="w-[56px] shrink-0">
                                <SlabCard slab={slab} tier={TIERS[p.tier]} art="small" flat foil={0.2} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-[14px] font-extrabold">{slab.name}</div>
                                <div className="truncate text-[12px] text-white/55">
                                    {slab.setName} · PSA {slab.grade} · {baht(slab.valueThb)}
                                </div>
                            </div>
                        </div>

                        {step === 'address' && (
                            <>
                                <p className="mt-4 text-[12.5px] leading-relaxed text-white/60">{t('ship.addressBody')}</p>
                                <div className="mt-3 grid gap-3">
                                    <Field id="sp-ship-name" label={t('ship.name')} value={to.name} onChange={(v) => setTo({ ...to, name: v })} placeholder={t('ship.namePh')} />
                                    <Field id="sp-ship-phone" label={t('ship.phone')} value={to.phone} onChange={(v) => setTo({ ...to, phone: v })} placeholder="08x xxx xxxx" type="tel" />
                                    <Field id="sp-ship-address" label={t('ship.address')} value={to.address} onChange={(v) => setTo({ ...to, address: v })} placeholder={t('ship.addressPh')} multiline />
                                </div>
                                <button
                                    className="sp-btn sp-btn-primary mt-5 h-[54px] w-full text-[16px]"
                                    disabled={!addressOk}
                                    onClick={() => {
                                        sfx.tap();
                                        setStep('quote');
                                    }}
                                >
                                    {t('ship.continue')}
                                </button>
                            </>
                        )}

                        {step === 'quote' && (
                            calculating ? (
                                <div className="flex flex-col items-center py-14 text-center">
                                    <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                                    <div className="sp-display mt-5 text-[18px]">{t('ship.calculating')}</div>
                                    <div className="mt-1 text-[12px] text-white/50">{t('ship.calculatingSub')}</div>
                                </div>
                            ) : (
                                <>
                                    <div className="sp-card mt-4 rounded-[22px] p-4">
                                        <Row label={t('ship.fee')} value={baht(quote.feeThb)} strong />
                                        <Row label={t('ship.window')} value={t('ship.days', { d1: SHIP_DAYS[0], d2: SHIP_DAYS[1] })} />
                                        <Row label={t('ship.arrives')} value={`${fmtDate(window[0])} – ${fmtDate(window[1])}`} />
                                        <Row label={t('ship.to')} value={to.name.trim()} />
                                    </div>
                                    <div className="mt-3 overflow-hidden rounded-[20px] border border-white/10">
                                        <Checkbox
                                            checked={insure}
                                            onChange={setInsure}
                                            label={t('ship.insure', { fee: baht(insuranceIfChosen) })}
                                            sub={t('ship.insureSub', { value: baht(slab.valueThb) })}
                                        />
                                        <div className="border-t border-white/10">
                                            <Checkbox checked={terms} onChange={setTerms} label={t('ship.terms')} sub={t('ship.termsBody', { d1: SHIP_DAYS[0], d2: SHIP_DAYS[1] })} />
                                        </div>
                                    </div>
                                    <button
                                        className="sp-btn sp-btn-primary mt-5 h-[54px] w-full text-[16px]"
                                        disabled={!terms}
                                        onClick={() => {
                                            sfx.tap();
                                            setStep('checkout');
                                        }}
                                    >
                                        {t('ship.continue')}
                                    </button>
                                </>
                            )
                        )}

                        {step === 'checkout' && (
                            <>
                                <div className="sp-card mt-4 rounded-[22px] p-4">
                                    <Row label={t('ship.fee')} value={baht(quote.feeThb)} />
                                    <Row label={t('ship.insurance')} value={insure ? baht(quote.insuranceThb) : t('ship.noInsurance')} />
                                    <div className="my-1 border-t border-white/10" />
                                    <Row label={t('ship.total')} value={baht(quote.totalThb)} strong />
                                    <Row label={t('ship.payWith')} value={method === 'wallet' ? t('ship.payWallet') : t('ship.payCard')} />
                                </div>
                                <div className="sp-card mt-3 rounded-[20px] p-4 text-[12.5px]">
                                    <div className="sp-label">{t('ship.to')}</div>
                                    <div className="mt-1 font-bold">{to.name.trim()} · {to.phone.trim()}</div>
                                    <div className="mt-0.5 whitespace-pre-line text-white/60">{to.address.trim()}</div>
                                    <div className="mt-1.5 text-white/50">{t('ship.arrivesLine', { from: fmtDate(window[0]), to: fmtDate(window[1]) })}</div>
                                </div>
                                <button className="sp-btn sp-btn-primary mt-5 h-[54px] w-full text-[16px]" onClick={pay}>
                                    {method === 'wallet' ? <Wallet size={17} /> : <CreditCard size={17} />}
                                    {t('ship.pay', { amount: baht(quote.totalThb) })}
                                </button>
                                <p className="mt-2 text-center text-[11px] text-white/40">{t('ship.noCancel')}</p>
                            </>
                        )}

                        {step === 'done' && (
                            <>
                                <div className="mt-5 flex flex-col items-center text-center">
                                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400">
                                        <Truck size={28} />
                                    </span>
                                    <p className="mt-4 text-[13px] leading-relaxed text-white/70">
                                        {t('ship.doneBody', { name: to.name.trim(), from: fmtDate(window[0]), to: fmtDate(window[1]) })}
                                    </p>
                                </div>
                                <button className="sp-btn sp-btn-primary mt-6 h-[54px] w-full text-[16px]" onClick={onClose}>
                                    <Check size={18} strokeWidth={3} />
                                    {t('ship.done')}
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}
        </Sheet>
    );
}
