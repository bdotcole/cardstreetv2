import React, { useMemo, useState, useEffect } from 'react';
import { CartItem } from '../types';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useConditionTranslation } from '@/lib/hooks/useCardTranslations';
import { getThumbnailUrl } from '@/lib/imageUtils';

interface CartDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    cart: CartItem[];
    onRemoveItem: (id: string) => void;
    /** `sellerId` narrows checkout to one seller's items — a TH PaymentIntent
     *  belongs to a single connected account, so a mixed cart cannot go through
     *  in one charge. Omitted for a single-seller cart. */
    onCheckout: (shippingFee: number, sellerId?: string) => void;
    currencySymbol: string;
    exchangeRate?: number;
}

const CartDrawer: React.FC<CartDrawerProps> = ({
    isOpen,
    onClose,
    cart,
    onRemoveItem,
    onCheckout,
    currencySymbol,
    exchangeRate = 1
}) => {
    const { t } = useTranslation();
    const translateCondition = useConditionTranslation();
    const total = useMemo(() => cart.reduce((sum, item) => sum + item.price, 0), [cart]);

    // Identical copies (same card, price, condition — sibling listings, see
    // lib/listingSiblings.ts) read as one line with a count. Each still holds
    // its own listing id underneath, so removing "one" drops a single id.
    const groupLines = (items: CartItem[]) => {
        const lines = new Map<string, { item: CartItem; ids: string[] }>();
        for (const item of items) {
            const key = `${item.cardId}|${item.price}|${item.condition}`;
            const line = lines.get(key);
            if (line) line.ids.push(item.id);
            else lines.set(key, { item, ids: [item.id] });
        }
        return [...lines.values()];
    };

    // Seller groups, in first-added order so the list does not reshuffle as
    // items come and go.
    const bySeller = useMemo(() => {
        const groups = new Map<string, { sellerId: string; sellerName: string; items: typeof cart }>();
        for (const item of cart) {
            const id = item.sellerId || 'unknown';
            if (!groups.has(id)) groups.set(id, { sellerId: id, sellerName: item.sellerName || '', items: [] });
            groups.get(id)!.items.push(item);
        }
        return [...groups.values()];
    }, [cart]);

    // Prices and shipping quotes are THB; convert for display only — checkout
    // still receives the raw THB shipping fee.
    const formatDisplayPrice = (thb: number) => {
        const v = (thb || 0) * exchangeRate;
        return `${currencySymbol}${v < 1 && v > 0 ? v.toFixed(2) : Math.round(v).toLocaleString()}`;
    };
    
    const [shippingFee, setShippingFee] = useState<number>(0);
    const [isCalculatingShipping, setIsCalculatingShipping] = useState<boolean>(false);
    // Whether the fee above is a real quote. /api/shipping/calculate needs a
    // signed-in buyer WITH a saved postcode, and most buyers reach the cart
    // before either is true (401 / 400 "Buyer address incomplete"). That
    // failure used to be swallowed to the console, leaving shippingFee at its
    // 0 initial value — so the drawer advertised "Shipping 0" and a total that
    // omitted 40-90 baht of real freight, which the buyer then met for the
    // first time in the payment modal. Say "calculated at checkout" instead.
    const [shippingKnown, setShippingKnown] = useState<boolean>(false);

    useEffect(() => {
        const fetchShipping = async () => {
            if (!isOpen || cart.length === 0) {
                setShippingFee(0);
                setShippingKnown(false);
                return;
            }
            setIsCalculatingShipping(true);
            try {
                const res = await fetch('/api/shipping/calculate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: cart })
                });
                const data = await res.json();
                if (data.success) {
                    setShippingFee(data.totalShippingFee || 0);
                    setShippingKnown(true);
                } else {
                    // Expected for a signed-out or address-less buyer, so this
                    // is not an error — we simply cannot quote the route yet.
                    setShippingFee(0);
                    setShippingKnown(false);
                }
            } catch (err) {
                console.error('Shipping calc error:', err);
                setShippingFee(0);
                setShippingKnown(false);
            } finally {
                setIsCalculatingShipping(false);
            }
        };

        fetchShipping();
    }, [isOpen, cart]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn"
                onClick={onClose}
            ></div>

            {/* Drawer */}
            <div className="relative w-full max-w-sm bg-slate-900 h-full shadow-2xl border-l border-white/10 flex flex-col animate-slideLeft">
                {/* Header */}
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-brand-darker/50">
                    <h2 className="text-xl font-black italic skew-x-[-10deg] text-white uppercase tracking-tight">
                        {t('cart.title')} <span className="text-brand-cyan text-sm not-italic ml-2">({cart.length})</span>
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
                        <i className="fa-solid fa-xmark text-slate-400"></i>
                    </button>
                </div>

                {/* Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50">
                            <i className="fa-solid fa-cart-shopping text-4xl mb-4"></i>
                            <p className="text-xs font-black uppercase tracking-widest">{t('cart.empty')}</p>
                        </div>
                    ) : (
                        bySeller.map(({ sellerId, sellerName, items }) => (
                        <div key={sellerId} className="space-y-3">
                            {/* Grouped by seller because the CHARGE is grouped by
                                seller: shipping is billed once per seller_id, and
                                a TH cart can only check out one seller at a time
                                (a direct-charge PaymentIntent belongs to exactly
                                one connected account). That constraint used to
                                surface as a 400 at checkout; here it is just how
                                the cart reads. */}
                            {bySeller.length > 1 && (
                                <div className="flex items-center justify-between gap-2 px-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">
                                        {sellerName || t('cart.title')}
                                    </p>
                                    <span className="text-[10px] font-bold text-slate-600 shrink-0">{items.length}</span>
                                </div>
                            )}
                            {/* The incentive, stated where it can act on the
                                decision: one more card from THIS seller adds no
                                shipping at all. */}
                            <p className="text-[10px] text-brand-green font-bold px-1">
                                {t('shipping.sameSellerFree')}
                                {shippingKnown ? ' ' + formatDisplayPrice(shippingFee / Math.max(1, bySeller.length)) : ''}
                            </p>
                            {groupLines(items).map(({ item, ids }) => (
                            <div key={ids[0]} className="bg-white/5 p-3 rounded-xl flex gap-3 border border-white/5 relative group">
                                <div className="w-16 h-20 bg-brand-darker rounded-lg overflow-hidden flex-shrink-0 border border-white/5">
                                    <img src={getThumbnailUrl(item.card.images?.small || item.card.imageUrl)} loading="lazy" decoding="async" className="w-full h-full object-contain" alt={item.card.name} />
                                </div>
                                <div className="flex-1 min-w-0 py-1">
                                    <h4 className="text-white text-sm font-bold truncate pr-6">{item.card.name}</h4>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">{translateCondition(item.condition)} • {item.sellerName}</p>
                                    {ids.length > 1 ? (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-brand-cyan font-black">{formatDisplayPrice(item.price * ids.length)}</p>
                                            <p className="text-[10px] text-slate-500 font-bold">{formatDisplayPrice(item.price)} × {ids.length}</p>
                                            <button
                                                onClick={() => onRemoveItem(ids[ids.length - 1])}
                                                aria-label={t('cart.removeOne')}
                                                title={t('cart.removeOne')}
                                                className="w-6 h-6 rounded-md bg-white/5 border border-white/10 text-slate-300 text-xs font-black active:scale-95 transition-all"
                                            >
                                                −
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="text-brand-cyan font-black">{formatDisplayPrice(item.price)}</p>
                                    )}
                                </div>
                                <button
                                    onClick={() => ids.forEach((id) => onRemoveItem(id))}
                                    className="absolute top-2 right-2 text-slate-600 hover:text-brand-red transition-colors p-1"
                                >
                                    <i className="fa-solid fa-trash-can text-xs"></i>
                                </button>
                            </div>
                            ))}
                            {bySeller.length > 1 && (
                                <button
                                    onClick={() => onCheckout(shippingFee, sellerId)}
                                    disabled={isCalculatingShipping}
                                    className="w-full h-11 rounded-xl bg-white/5 border border-brand-green/30 text-brand-green font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
                                >
                                    {t('shipping.checkoutSeller')} {sellerName}
                                </button>
                            )}
                        </div>
                        ))
                    )}
                    {bySeller.length > 1 && (
                        <p className="text-[10px] text-amber-300/80 font-bold px-1 pt-2">
                            {t('shipping.oneSellerAtATime')}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 bg-brand-darker/80 border-t border-white/5 backdrop-blur-xl">
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">Subtotal</span>
                        <span className="text-sm font-black text-white">{formatDisplayPrice(total)}</span>
                    </div>
                    <div className="flex justify-between items-end mb-4">
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">Shipping</span>
                        <span className={'font-black text-brand-cyan ' + (shippingKnown ? 'text-sm' : 'text-[11px]')}>
                            {isCalculatingShipping
                                ? '...'
                                : shippingKnown
                                    ? formatDisplayPrice(shippingFee)
                                    : t('shipping.unknownShort')}
                        </span>
                    </div>
                    <div className="flex justify-between items-end mb-1 pt-2 border-t border-white/10">
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">{t('cart.price')}</span>
                        <span className="text-2xl font-black text-white">
                            {formatDisplayPrice(total + (shippingKnown ? shippingFee : 0))}
                            {!shippingKnown && !isCalculatingShipping && (
                                <span className="text-[11px] font-bold text-slate-500 ml-1">{t('shipping.plusShipping')}</span>
                            )}
                        </span>
                    </div>
                    {!shippingKnown && !isCalculatingShipping && (
                        <p className="text-[10px] text-slate-500 leading-snug text-right mb-3">{t('shipping.unknownNote')}</p>
                    )}
                    <div className={shippingKnown || isCalculatingShipping ? 'mt-3' : ''}>
                        {/* A mixed cart cannot go through as one charge (a TH
                            direct-charge PaymentIntent belongs to exactly one
                            connected account). The per-seller buttons above are
                            the way through; this one used to stay enabled and
                            submit the whole cart, so the buyer only learned
                            that from a 400 AFTER entering payment details. */}
                        <button
                            onClick={() => onCheckout(shippingFee)}
                            disabled={cart.length === 0 || isCalculatingShipping || bySeller.length > 1}
                            className="w-full h-14 bg-brand-green text-brand-darker font-black uppercase tracking-[0.2em] rounded-xl shadow-lg shadow-brand-green/20 hover:bg-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {bySeller.length > 1 ? (
                                <span className="text-[10px] tracking-widest">{t('cart.chooseSeller')}</span>
                            ) : (
                                <>{t('cart.checkout')} <i className="fa-solid fa-arrow-right"></i></>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CartDrawer;
