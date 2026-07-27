import React, { useState } from 'react';
import { UserProfile, Review } from '@/types';
import RatingStars from './RatingStars';
import ReviewList from './ReviewList';
import ReportModal from './ReportModal';
import { CURRENCY_SYMBOLS } from '@/constants';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
import GradedSlabFrame from './GradedSlabFrame';

interface SellerProfileProps {
    seller: UserProfile;
    listings: any[]; // Using existing listing structure
    reviews: Review[];
    onBack: () => void;
    onSelectListing: (listing: any) => void;
    onAddToCart?: (item: any) => void;
    currency?: string;
    exchangeRate?: number;
}

const SellerProfile: React.FC<SellerProfileProps> = ({ seller, listings, reviews, onBack, onSelectListing, onAddToCart, currency = 'THB', exchangeRate = 1 }) => {
    const [activeTab, setActiveTab] = useState<'shop' | 'reviews' | 'about'>('shop');
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const { t } = useTranslation();

    const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

    // Stats
    const totalSales = seller.totalSales || 0;
    const rating = seller.rating || 0;
    const reviewCount = seller.reviewCount || 0;

    return (
        <div className="bg-brand-darker min-h-screen pb-32 animate-fadeIn relative">
            {/* Background */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-purple/10 rounded-full blur-[80px] pointer-events-none"></div>

            {/* Navbar */}
            <div className="pt-6 px-4 flex items-center gap-4 relative z-10">
                <button onClick={onBack} className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                    <i className="fa-solid fa-arrow-left"></i>
                </button>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('seller.profileTitle')}</span>
            </div>

            {/* Profile Header */}
            <div className="px-6 mt-6 text-center space-y-4 relative z-10">
                <div className="relative mx-auto w-24 h-24">
                    <div className="w-24 h-24 rounded-full p-1 bg-gradient-to-br from-brand-cyan via-brand-purple to-brand-red animate-pulse-slow">
                        <img src={seller.avatar} className="w-full h-full rounded-full object-cover border-4 border-brand-darker" alt={seller.name} />
                    </div>
                </div>

                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-5deg] mb-1">{seller.name}</h1>
                    {(seller.isPartner || (seller.badges && seller.badges.length > 0)) && (
                        <div className="flex items-center justify-center gap-2 mb-3">
                            {seller.isPartner && (
                                <span className="px-2.5 py-0.5 rounded-full bg-brand-cyan/10 border border-brand-cyan/30 text-[9px] font-black text-brand-cyan uppercase tracking-wider flex items-center gap-1">
                                    <i className="fa-solid fa-circle-check"></i>
                                    {t('seller.officialPartner')}
                                </span>
                            )}
                            {seller.badges?.map(badge => (
                                <span key={badge} className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                    {badge}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-center items-center gap-6">
                        <div className="text-center">
                            <p className="text-lg font-black text-white">{reviewCount > 0 ? Number(rating).toFixed(1) : '—'}</p>
                            <RatingStars rating={rating} />
                            <p className="text-[8px] font-bold text-slate-500 uppercase mt-1">{reviewCount} {t('seller.reviews')}</p>
                        </div>
                        <div className="w-[1px] h-8 bg-white/10"></div>
                        <div className="text-center">
                            <p className="text-lg font-black text-white">{totalSales}</p>
                            <p className="text-[8px] font-bold text-slate-500 uppercase">{t('seller.sales')}</p>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 justify-center">
                    <button className="h-10 px-6 bg-white text-brand-darker font-black text-xs uppercase tracking-widest rounded-xl hover:scale-105 transition-transform">
                        {t('seller.follow')}
                    </button>
                    <button className="h-10 w-10 glass rounded-xl flex items-center justify-center text-brand-cyan hover:bg-brand-cyan/10 transition-colors">
                        <i className="fa-regular fa-comment-dots"></i>
                    </button>
                    <button 
                        onClick={() => setIsReportModalOpen(true)}
                        title="Report Seller"
                        className="h-10 w-10 glass rounded-xl flex items-center justify-center text-slate-400 hover:text-brand-red hover:bg-brand-red/10 transition-colors">
                        <i className="fa-solid fa-flag"></i>
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="mt-8 border-b border-white/5 px-6 flex gap-6 overflow-x-auto scrollbar-hide">
                {['shop', 'reviews', 'about'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={`pb-3 text-xs font-bold uppercase tracking-widest transition-colors relative ${activeTab === tab ? 'text-white' : 'text-slate-600 hover:text-slate-400'
                            }`}
                    >
                        {t(`seller.${tab}`)}
                        {activeTab === tab && <div className="absolute bottom-0 left-0 w-full h-[2px] bg-brand-cyan"></div>}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="p-6 min-h-[300px]">
                {activeTab === 'shop' && (
                    listings.length === 0 ? (
                        <div className="glass p-6 rounded-2xl border border-white/5 text-center text-sm text-slate-500">
                            {t('seller.noListings')}
                        </div>
                    ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {listings.map(listing => {
                            const slabbed = !!listing.is_graded && !!listing.grading_company;
                            return (
                            <div key={listing.id} className="glass rounded-xl p-2 border border-white/5 group relative active:scale-95 transition-all">
                                <div className="aspect-[3/4] bg-brand-darker rounded-lg mb-2 relative overflow-hidden">
                                    <GradedSlabFrame company={slabbed ? listing.grading_company : null} grade={listing.grade}>
                                        <img src={getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl)} loading="lazy" decoding="async" className={`w-full h-full ${listing.card_data.isSealed ? 'object-contain p-1' : slabbed ? 'object-contain' : 'object-cover'}`} />
                                    </GradedSlabFrame>
                                    {!slabbed && (
                                        <span className="absolute top-1 right-1 bg-black/60 backdrop-blur text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                            {listing.condition}
                                        </span>
                                    )}
                                </div>
                                <h4 className="text-[10px] font-bold text-white truncate">{listing.card_data.name}</h4>
                                <div className="flex items-center justify-between gap-1">
                                    <p className="text-brand-green font-black text-xs truncate">{currencySymbol}{(listing.price * exchangeRate) < 1 ? (listing.price * exchangeRate).toFixed(2) : Math.round(listing.price * exchangeRate).toLocaleString()}</p>
                                    {/* Sits above the full-tile overlay button (relative z-10) so it
                                        stays clickable; the overlay still handles taps elsewhere. */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAddToCart?.({
                                                id: listing.id,
                                                cardId: listing.card_id,
                                                card: listing.card_data,
                                                price: listing.price,
                                                sellerId: listing.seller_id,
                                                sellerName: seller.name || listing.seller?.display_name || 'Unknown',
                                                condition: listing.condition,
                                            });
                                        }}
                                        className="relative z-10 w-8 h-8 flex-shrink-0 rounded-full bg-white/5 hover:bg-brand-green hover:text-brand-darker text-brand-green flex items-center justify-center transition-all active:scale-90"
                                        aria-label={`Add ${listing.card_data.name} to cart`}
                                    >
                                        <i className="fa-solid fa-cart-plus text-xs"></i>
                                    </button>
                                </div>
                                <button
                                    onClick={() => onSelectListing(listing)}
                                    className="absolute inset-0 w-full h-full opacity-0"
                                ></button>
                            </div>
                            );
                        })}
                    </div>
                    )
                )}

                {activeTab === 'reviews' && (
                    reviews.length > 0 ? (
                        <ReviewList reviews={reviews} />
                    ) : (
                        <div className="glass p-6 rounded-2xl border border-white/5 text-center text-sm text-slate-500">
                            {t('seller.noReviews')}
                        </div>
                    )
                )}

                {activeTab === 'about' && (
                    <div className="glass p-6 rounded-2xl border border-white/5 space-y-4 text-center">
                        <i className="fa-solid fa-quote-left text-brand-cyan text-2xl opacity-50"></i>
                        <p className="text-sm text-slate-300 italic leading-relaxed">
                            {seller.bio || t('seller.defaultBio')}
                        </p>
                        <div className="pt-4 border-t border-white/5 flex flex-col gap-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 font-bold uppercase">{t('seller.memberSince')}</span>
                                <span className="text-white font-mono">{seller.joinedAt || t('seller.newMember')}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 font-bold uppercase">{t('seller.avgShipTime')}</span>
                                <span className="text-brand-green font-mono">N/A</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <ReportModal 
                isOpen={isReportModalOpen} 
                onClose={() => setIsReportModalOpen(false)} 
                entityType="seller" 
                entityId={seller.id} 
                entityName={seller.name} 
            />
        </div>
    );
};

export default SellerProfile;
