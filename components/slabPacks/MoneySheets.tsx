'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, Check, Coins, CreditCard, Landmark, MapPin, ShieldCheck, Tag, Truck, UserCheck, Wallet } from 'lucide-react';
import {
    CASHOUT_BUSINESS_DAYS, CASHOUT_HOLD_DAYS, CASHOUT_MIN_THB, CASHOUT_MONTHLY_CAP_THB, CASHOUT_REQUIRES,
    COINS_PER_THB, MARKET_FEE_RATE, PULL_MARKET_FEE_RATE, SHIP_DAYS, SHIP_FEE_THB, SHIP_REQUIRES,
    cashoutFeeThb, cashoutNetThb, listingPayoutThb, missingVerification, thbForCoins,
    type VerificationKind,
} from '@/lib/slabPacks/policy';
import { getSlab } from '@/lib/slabPacks/pool';
import {
    cashedOutThisMonthThb, previewActions, withdrawableThb,
    type CashoutBlock, type LedgerKind, type PreviewState,
} from '@/lib/slabPacks/previewStore';
import { sfx } from '@/lib/slabPacks/sfx';
import { TIERS } from '@/lib/slabPacks/tiers';
import type { Pull } from '@/lib/slabPacks/types';
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

// ── Ship a slab out of the vault ────────────────────────────────────────────

export function ShipSheet({
    pull, onClose, state, onVerify,
}: {
    pull: Pull | null;
    onClose: () => void;
    state: PreviewState;
    onVerify: (kind: VerificationKind) => void;
}) {
    const { t, isThai } = useSp();
    const [shown, setShown] = useState<Pull | null>(pull);
    useEffect(() => {
        if (pull) setShown(pull);
    }, [pull]);

    const p = shown;
    const slab = p ? getSlab(p.slabKey) : undefined;
    const missing = missingVerification(state.verification, SHIP_REQUIRES);
    const walletCovers = state.walletThb >= SHIP_FEE_THB;
    const method = walletCovers ? 'wallet' : 'card';
    const now = useMemo(() => Date.now(), [pull]); // eslint-disable-line react-hooks/exhaustive-deps
    const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(isThai ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });

    return (
        <Sheet open={!!pull} onClose={onClose}>
            {p && slab && (
                <>
                    <SheetHeader title={t('ship.title')} sub={t('ship.sub')} onClose={onClose} />
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
                            </div>
                        </div>

                        <div className="sp-card mt-4 rounded-[22px] p-4">
                            <Row label={t('ship.fee')} value={baht(SHIP_FEE_THB)} strong />
                            <Row label={t('ship.window')} value={t('ship.days', { d1: SHIP_DAYS[0], d2: SHIP_DAYS[1] })} />
                            <Row label={t('ship.arrives')} value={`${fmtDate(now + SHIP_DAYS[0] * 86_400_000)} – ${fmtDate(now + SHIP_DAYS[1] * 86_400_000)}`} />
                            <Row label={t('ship.payWith')} value={method === 'wallet' ? t('ship.payWallet') : t('ship.payCard')} />
                        </div>
                        <p className="mt-2.5 text-[11.5px] leading-snug text-white/50">{t('ship.note')}</p>

                        <div className="sp-label mt-5">{t('ship.requires')}</div>
                        <div className="mt-2 overflow-hidden rounded-[20px] border border-white/10">
                            {SHIP_REQUIRES.map((k, n) => (
                                <div key={k} className={n ? 'border-t border-white/10' : ''}>
                                    <Requirement kind={k} done={state.verification[k]} onVerify={onVerify} />
                                </div>
                            ))}
                        </div>

                        <button
                            className="sp-btn sp-btn-primary mt-4 h-[54px] w-full text-[16px]"
                            disabled={missing.length > 0}
                            onClick={() => {
                                if (previewActions.requestShipping(p.id, method)) {
                                    sfx.keep();
                                    onClose();
                                } else {
                                    sfx.deny();
                                }
                            }}
                        >
                            <Truck size={17} />
                            {missing.length > 0 ? t('ship.blocked') : t('ship.submit', { fee: baht(SHIP_FEE_THB) })}
                        </button>
                        <p className="mt-2 text-center text-[11px] text-white/40">{t('ship.noCancel')}</p>
                    </div>
                </>
            )}
        </Sheet>
    );
}
