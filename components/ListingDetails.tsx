import React, { useState } from 'react';
import Image from 'next/image';
import { Card } from '../types';
import ReportModal from './ReportModal';
import { CURRENCY_SYMBOLS } from '@/constants';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
interface ListingDetailsProps {
    listing: {
        id: string;
        price: number;
        condition: string;
        seller: any;
        card_data: Card;
        image_front_url?: string;
        image_back_url?: string;
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
    const { isThai } = useTranslation();
    const card = listing.card_data;
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [activeSlide, setActiveSlide] = useState(0);
    
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const scrollLeft = e.currentTarget.scrollLeft;
        const width = e.currentTarget.offsetWidth;
        const newIndex = Math.round(scrollLeft / width);
        setActiveSlide(newIndex);
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-brand-darker animate-slideUp">
            {/* Header */}
            <div className="px-6 pb-6 flex justify-between items-center sticky top-0 z-10 bg-brand-darker/80 backdrop-blur-lg border-b border-white/5" style={{ paddingTop: 'calc(1.5rem + var(--sat))' }}>
                <button
                    onClick={onClose}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 active:bg-brand-cyan active:text-brand-darker transition-all border border-white/5"
                >
                    <i className="fa-solid fa-chevron-left text-sm"></i>
                </button>
                <div className="text-center">
                    <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-green block">{isThai ? 'รายละเอียดสินค้า' : 'Listing Details'}</span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{card.number}</span>
                </div>
                <button 
                    onClick={() => setIsReportModalOpen(true)}
                    title="Report Listing"
                    className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/5 hover:text-brand-red text-slate-500 transition-all border border-transparent hover:border-white/5"
                >
                    <i className="fa-solid fa-flag text-sm"></i>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-40 scrollbar-hide">
                {/* Swipeable Image Gallery */}
                <div className="relative w-full">
                    <div className="absolute inset-0 bg-gradient-to-b from-brand-green/5 to-transparent pointer-events-none z-0"></div>
                    
                    <div 
                        className="flex w-full overflow-x-auto snap-x snap-mandatory scrollbar-hide relative z-10"
                        onScroll={handleScroll}
                    >
                        {/* Slide 1: Digital Image */}
                        <div className="flex-none w-full snap-center flex justify-center p-8 items-center min-h-[400px]">
                            <Image
                                src={card.imageUrl || ""}
                                alt={card.name}
                                width={280}
                                height={392}
                                className="w-full max-w-[280px] drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)]"
                            />
                        </div>

                        {/* Slide 2: Real Front Photo */}
                        {listing.image_front_url && (
                            <div className="flex-none w-full snap-center flex justify-center p-8 items-center min-h-[400px]">
                                <TransformWrapper initialScale={1} minScale={1} maxScale={4} centerOnInit>
                                    <TransformComponent wrapperClass="w-full max-w-[280px] rounded-xl overflow-hidden drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] border border-white/10" contentClass="w-full h-full">
                                        <Image src={listing.image_front_url} alt="Front condition" width={280} height={392} className="w-full object-contain bg-black/50" />
                                    </TransformComponent>
                                </TransformWrapper>
                            </div>
                        )}

                        {/* Slide 3: Real Back Photo */}
                        {listing.image_back_url && (
                            <div className="flex-none w-full snap-center flex justify-center p-8 items-center min-h-[400px]">
                                <TransformWrapper initialScale={1} minScale={1} maxScale={4} centerOnInit>
                                    <TransformComponent wrapperClass="w-full max-w-[280px] rounded-xl overflow-hidden drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] border border-white/10" contentClass="w-full h-full">
                                        <Image src={listing.image_back_url} alt="Back condition" width={280} height={392} className="w-full object-contain bg-black/50" />
                                    </TransformComponent>
                                </TransformWrapper>
                            </div>
                        )}
                    </div>
                    
                    {/* Pagination Dots */}
                    {(listing.image_front_url || listing.image_back_url) && (
                        <div className="flex justify-center gap-2 pb-4">
                            <div className={`w-2 h-2 rounded-full transition-all ${activeSlide === 0 ? 'bg-brand-cyan w-4' : 'bg-white/20'}`} />
                            {listing.image_front_url && (
                                <div className={`w-2 h-2 rounded-full transition-all ${activeSlide === 1 ? 'bg-brand-cyan w-4' : 'bg-white/20'}`} />
                            )}
                            {listing.image_back_url && (
                                <div className={`w-2 h-2 rounded-full transition-all ${activeSlide === 2 ? 'bg-brand-cyan w-4' : 'bg-white/20'}`} />
                            )}
                        </div>
                    )}
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
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">{isThai ? 'ราคาขาย' : 'Asking Price'}</p>
                                <p className="text-4xl font-black text-brand-cyan">
                                    {CURRENCY_SYMBOLS[currency] || currency}{' '}
                                    {(listing.price * exchangeRate) < 1 ? (listing.price * exchangeRate).toFixed(2) : Math.round(listing.price * exchangeRate).toLocaleString()}
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
                                <Image src={listing.seller.avatar_url || "https://api.dicebear.com/7.x/avataaars/svg?seed=seller"} alt="Seller Avatar" width={48} height={48} className="w-full h-full object-cover" />
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest group-hover:text-brand-cyan transition-colors">{isThai ? 'ผู้ขาย' : 'Seller'}</p>
                                <p className="text-white font-bold group-hover:text-brand-cyan transition-colors">{listing.seller.display_name}</p>
                                <div className="flex items-center gap-1 text-[10px]">
                                    <i className="fa-solid fa-star text-yellow-500"></i>
                                    <span className="text-slate-500 font-bold">{parseFloat(listing.seller.rating) || 0}</span>
                                </div>
                            </div>
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
                    {isThai ? 'เพิ่มลงรถเข็น' : 'Add to Cart'}
                </button>
                <button
                    onClick={onBuyNow}
                    className="flex-[2] h-14 bg-brand-green text-brand-darker font-black text-[10px] tracking-[0.2em] rounded-xl shadow-lg shadow-brand-green/20 active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
                >
                    {isThai ? 'ซื้อเลย' : 'Buy Now'}
                    <i className="fa-solid fa-arrow-right"></i>
                </button>
            </div>

            <ReportModal 
                isOpen={isReportModalOpen} 
                onClose={() => setIsReportModalOpen(false)} 
                entityType="listing" 
                entityId={listing.id} 
                entityName={`${card.name} (${listing.condition})`} 
            />
        </div>
    );
};

export default ListingDetails;
