import React from 'react';
import { Card } from '../types';
import { CURRENCY_SYMBOLS } from '@/constants';

interface ListingDetailsProps {
    listing: {
        id: string;
        price: number;
        condition: string;
        seller: any;
        card_data: Card;
    };
    onClose: () => void;
    onBuyNow: () => void;
    onAddToCart: () => void;
    onSellerClick: (seller: any) => void;
    currency?: string;
    exchangeRate?: number;
}

const ListingDetails: React.FC<ListingDetailsProps> = ({
    listing,
    onClose,
    onBuyNow,
    onAddToCart,
    onSellerClick,
    currency = 'THB',
    exchangeRate = 1
}) => {
    const card = listing.card_data;

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-brand-darker animate-slideUp">
            {/* Header */}
            <div className="px-6 py-6 flex justify-between items-center sticky top-0 z-10 bg-brand-darker/80 backdrop-blur-lg border-b border-white/5">
                <button
                    onClick={onClose}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 active:bg-brand-cyan active:text-brand-darker transition-all border border-white/5"
                >
                    <i className="fa-solid fa-chevron-left text-sm"></i>
                </button>
                <div className="text-center">
                    <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-green block">Listing Details</span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{card.number}</span>
                </div>
                <div className="w-10"></div> {/* Spacer */}
            </div>

            <div className="flex-1 overflow-y-auto pb-40 scrollbar-hide">
                <div className="p-8 flex justify-center relative">
                    <div className="absolute inset-0 bg-gradient-to-b from-brand-green/5 to-transparent pointer-events-none"></div>
                    <img
                        src={card.imageUrl}
                        alt={card.name}
                        className="w-full max-w-[280px] drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] z-10"
                    />
                </div>

                <div className="px-6 space-y-6">
                    <div className="text-center">
                        <h1 className="text-2xl font-black text-white leading-none tracking-tight mb-2">{card.name}</h1>
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">{card.set} • {card.rarity}</p>
                    </div>

                    {/* Listing Specifics */}
                    <div className="glass p-6 rounded-3xl border border-brand-green/20 space-y-4">
                        <div className="flex justify-between items-center border-b border-white/5 pb-4">
                            <div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Asking Price</p>
                                <p className="text-4xl font-black text-brand-cyan">
                                    {CURRENCY_SYMBOLS[currency] || currency}{' '}
                                    {Math.round(listing.price * exchangeRate).toLocaleString()}
                                </p>
                            </div>
                            <div className="text-right">
                                <span className="bg-brand-green/20 text-brand-green px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border border-brand-green/20">
                                    {listing.condition}
                                </span>
                            </div>
                        </div>

                        <div
                            className="flex items-center gap-4 pt-2 cursor-pointer group"
                            onClick={() => onSellerClick(listing.seller)}
                        >
                            <div className="w-12 h-12 rounded-2xl bg-slate-800 overflow-hidden border border-white/10 group-hover:border-brand-cyan transition-colors relative z-10">
                                <img src={listing.seller.avatar_url || "https://api.dicebear.com/7.x/avataaars/svg?seed=seller"} className="w-full h-full object-cover" />
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest group-hover:text-brand-cyan transition-colors">Seller</p>
                                <p className="text-white font-bold group-hover:text-brand-cyan transition-colors">{listing.seller.display_name}</p>
                                <div className="flex text-[10px] text-yellow-500 gap-0.5">
                                    <i className="fa-solid fa-star"></i>
                                    <i className="fa-solid fa-star"></i>
                                    <i className="fa-solid fa-star"></i>
                                    <i className="fa-solid fa-star"></i>
                                    <i className="fa-solid fa-star-half-stroke"></i>
                                    <span className="text-slate-500 ml-1">(4.8)</span>
                                </div>
                            </div>
                        </div>

                        {/* Seller Note Mock */}
                        <div className="bg-white/5 p-3 rounded-xl">
                            <p className="text-xs text-slate-400 italic">"Pack fresh, immediately sleeved. Will ship in top loader."</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="fixed bottom-0 left-0 w-full p-6 bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 flex gap-3 z-50">
                <button
                    onClick={onAddToCart}
                    className="flex-1 h-14 bg-white/5 border border-white/10 text-white hover:bg-white/10 font-black text-[10px] tracking-[0.2em] rounded-xl active:scale-95 transition-all uppercase flex items-center justify-center gap-2 group"
                >
                    <i className="fa-solid fa-cart-plus text-brand-cyan group-hover:scale-110 transition-transform text-lg"></i>
                    ADD TO CART
                </button>
                <button
                    onClick={onBuyNow}
                    className="flex-[2] h-14 bg-brand-green text-brand-darker font-black text-[10px] tracking-[0.2em] rounded-xl shadow-lg shadow-brand-green/20 active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
                >
                    BUY NOW
                    <i className="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        </div>
    );
};

export default ListingDetails;
