import React, { useMemo } from 'react';
import { CartItem } from '../types';

interface CartDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    cart: CartItem[];
    onRemoveItem: (id: string) => void;
    onCheckout: () => void;
    currencySymbol: string;
}

const CartDrawer: React.FC<CartDrawerProps> = ({
    isOpen,
    onClose,
    cart,
    onRemoveItem,
    onCheckout,
    currencySymbol
}) => {
    const total = useMemo(() => cart.reduce((sum, item) => sum + item.price, 0), [cart]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn"
                onClick={onClose}
            ></div>

            {/* Drawer */}
            <div className="relative w-full max-w-sm bg-[#0f172a] h-full shadow-2xl border-l border-white/10 flex flex-col animate-slideLeft">
                {/* Header */}
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-brand-darker/50">
                    <h2 className="text-xl font-black italic skew-x-[-10deg] text-white uppercase tracking-tight">
                        Your Cart <span className="text-brand-cyan text-sm not-italic ml-2">({cart.length})</span>
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
                            <p className="text-xs font-black uppercase tracking-widest">Cart is Empty</p>
                        </div>
                    ) : (
                        cart.map((item) => (
                            <div key={item.id} className="bg-white/5 p-3 rounded-xl flex gap-3 border border-white/5 relative group">
                                <div className="w-16 h-20 bg-brand-darker rounded-lg overflow-hidden flex-shrink-0 border border-white/5">
                                    <img src={item.card.imageUrl} className="w-full h-full object-contain" alt={item.card.name} />
                                </div>
                                <div className="flex-1 min-w-0 py-1">
                                    <h4 className="text-white text-sm font-bold truncate pr-6">{item.card.name}</h4>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">{item.condition} • {item.sellerName}</p>
                                    <p className="text-brand-cyan font-black">{currencySymbol}{item.price.toLocaleString()}</p>
                                </div>
                                <button
                                    onClick={() => onRemoveItem(item.id)}
                                    className="absolute top-2 right-2 text-slate-600 hover:text-brand-red transition-colors p-1"
                                >
                                    <i className="fa-solid fa-trash-can text-xs"></i>
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 bg-brand-darker/80 border-t border-white/5 backdrop-blur-xl">
                    <div className="flex justify-between items-end mb-4">
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">Total</span>
                        <span className="text-2xl font-black text-white">{currencySymbol}{total.toLocaleString()}</span>
                    </div>
                    <button
                        onClick={onCheckout}
                        disabled={cart.length === 0}
                        className="w-full h-14 bg-brand-green text-brand-darker font-black uppercase tracking-[0.2em] rounded-xl shadow-lg shadow-brand-green/20 hover:bg-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        Checkout <i className="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CartDrawer;
