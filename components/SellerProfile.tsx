import React, { useState } from 'react';
import { UserProfile, Review, Card } from '@/types';
import RatingStars from './RatingStars';
import ReviewList from './ReviewList';

interface SellerProfileProps {
    seller: UserProfile;
    listings: any[]; // Using existing listing structure
    reviews: Review[];
    onBack: () => void;
    onSelectCard: (card: Card) => void;
}

const SellerProfile: React.FC<SellerProfileProps> = ({ seller, listings, reviews, onBack, onSelectCard }) => {
    const [activeTab, setActiveTab] = useState<'shop' | 'reviews' | 'about'>('shop');

    // Stats
    const totalSales = 142; // Mock
    const rating = seller.rating || 4.9;
    const reviewCount = seller.reviewCount || 84;

    return (
        <div className="bg-brand-darker min-h-screen pb-32 animate-fadeIn relative">
            {/* Background */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-purple/10 rounded-full blur-[80px] pointer-events-none"></div>

            {/* Navbar */}
            <div className="pt-6 px-4 flex items-center gap-4 relative z-10">
                <button onClick={onBack} className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                    <i className="fa-solid fa-arrow-left"></i>
                </button>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Seller Profile</span>
            </div>

            {/* Profile Header */}
            <div className="px-6 mt-6 text-center space-y-4 relative z-10">
                <div className="relative mx-auto w-24 h-24">
                    <div className="w-24 h-24 rounded-full p-1 bg-gradient-to-br from-brand-cyan via-brand-purple to-brand-red animate-pulse-slow">
                        <img src={seller.avatar} className="w-full h-full rounded-full object-cover border-4 border-brand-darker" alt={seller.name} />
                    </div>
                    {/* Verification Badge */}
                    <div className="absolute bottom-0 right-0 w-8 h-8 bg-brand-darker rounded-full flex items-center justify-center border border-brand-cyan/30 shadow-lg">
                        <i className="fa-solid fa-certificate text-brand-cyan text-lg"></i>
                    </div>
                </div>

                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-5deg] mb-1">{seller.name}</h1>
                    <div className="flex items-center justify-center gap-2 mb-3">
                        {seller.badges?.map(badge => (
                            <span key={badge} className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                {badge}
                            </span>
                        )) || <span className="px-2 py-0.5 rounded bg-brand-purple/10 border border-brand-purple/20 text-[9px] font-bold text-brand-purple uppercase tracking-wider">Verified Pro</span>}
                    </div>

                    <div className="flex justify-center items-center gap-6">
                        <div className="text-center">
                            <p className="text-lg font-black text-white">{rating}</p>
                            <RatingStars rating={rating} />
                        </div>
                        <div className="w-[1px] h-8 bg-white/10"></div>
                        <div className="text-center">
                            <p className="text-lg font-black text-white">{totalSales}</p>
                            <p className="text-[8px] font-bold text-slate-500 uppercase">Sales</p>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 justify-center">
                    <button className="h-10 px-6 bg-white text-brand-darker font-black text-xs uppercase tracking-widest rounded-xl hover:scale-105 transition-transform">
                        Follow
                    </button>
                    <button className="h-10 w-10 glass rounded-xl flex items-center justify-center text-brand-cyan hover:bg-brand-cyan/10 transition-colors">
                        <i className="fa-regular fa-comment-dots"></i>
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
                        {tab}
                        {activeTab === tab && <div className="absolute bottom-0 left-0 w-full h-[2px] bg-brand-cyan"></div>}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="p-6 min-h-[300px]">
                {activeTab === 'shop' && (
                    <div className="grid grid-cols-2 gap-3">
                        {listings.map(listing => (
                            <div key={listing.id} className="glass rounded-xl p-2 border border-white/5 group relative active:scale-95 transition-all">
                                <div className="aspect-[3/4] bg-brand-darker rounded-lg mb-2 relative overflow-hidden">
                                    <img src={listing.card_data.images?.small || listing.card_data.imageUrl} className="w-full h-full object-cover" />
                                    <span className="absolute top-1 right-1 bg-black/60 backdrop-blur text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                        {listing.condition}
                                    </span>
                                </div>
                                <h4 className="text-[10px] font-bold text-white truncate">{listing.card_data.name}</h4>
                                <p className="text-brand-green font-black text-xs">฿{listing.price.toLocaleString()}</p>
                                <button
                                    onClick={() => onSelectCard(listing.card_data)}
                                    className="absolute inset-0 w-full h-full opacity-0"
                                ></button>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'reviews' && (
                    <ReviewList reviews={reviews} />
                )}

                {activeTab === 'about' && (
                    <div className="glass p-6 rounded-2xl border border-white/5 space-y-4 text-center">
                        <i className="fa-solid fa-quote-left text-brand-cyan text-2xl opacity-50"></i>
                        <p className="text-sm text-slate-300 italic leading-relaxed">
                            {seller.bio || "Professional collector based in Bangkok. Specializing in Mint condition Japanese FA and SAR charts. Fast shipping and bomb-proof packaging guaranteed!"}
                        </p>
                        <div className="pt-4 border-t border-white/5 flex flex-col gap-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 font-bold uppercase">Member Since</span>
                                <span className="text-white font-mono">{seller.joinedAt || "Nov 2023"}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 font-bold uppercase">Avg Ship Time</span>
                                <span className="text-brand-green font-mono">1.2 Days</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SellerProfile;
