'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, UserCollectionItem, CardCondition, CustomCollection, UserProfile, CartItem } from '@/types';
import { MOCK_CARDS, MOCK_MARKET_LISTINGS, MOCK_REVIEWS, EXCHANGE_RATES } from '@/constants';
// import Home from '@/components/Home'; // Retired
import CurrencySwitcher from '@/components/CurrencySwitcher';
import Explore from '@/components/Explore';
import Marketplace from '@/components/Marketplace';
import AddCard from '@/components/AddCard';
import Vault from '@/components/Vault';
import Profile from '@/components/Profile';
import CardDetails from '@/components/CardDetails';
import CartDrawer from '@/components/CartDrawer';
import ScanCandidateModal from '@/components/ScanCandidateModal';
import PaymentModal from '@/components/PaymentModal';
import ListingDetails from '@/components/ListingDetails';
import { geminiService } from '@/services/geminiService';
import { pokemonService } from '@/services/pokemonService';

import { createClient } from '@/lib/supabase/client';

import PartnerPortal from '@/components/PartnerPortal';
import PartnerRequest from '@/components/PartnerRequest';
import SellerProfile from '@/components/SellerProfile';

export default function HomePage() {
    const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'marketplace' | 'add' | 'vault' | 'profile' | 'partner' | 'seller_profile'>('marketplace');
    const [marketGameFilter, setMarketGameFilter] = useState('all');
    const [selectedCard, setSelectedCard] = useState<Card | null>(null);
    const [selectedListing, setSelectedListing] = useState<any | null>(null);
    const [viewingSeller, setViewingSeller] = useState<UserProfile | null>(null);
    const [scanCandidates, setScanCandidates] = useState<Card[]>([]);
    const [wishlist, setWishlist] = useState<Card[]>([]);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [currency, setCurrency] = useState<string>('THB');
    const [language, setLanguage] = useState<'TH' | 'EN'>('TH');

    // Cart State
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    // Search Request State (Object with timestamp to force updates even for same query)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [searchRequest, setSearchRequest] = useState<{ term: string, timestamp: number } | null>(null);


    const [customCollections, setCustomCollections] = useState<CustomCollection[]>(() => {
        // Hydrate from localStorage or default
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('cardstreet-data-v1');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.customCollections?.length > 0) return parsed.customCollections;
            }
        }

        // Seed Dummy Data if empty
        const dummyItems: UserCollectionItem[] = MOCK_CARDS.slice(0, 3).map((card, i) => ({
            id: `seed-item-${i}`,
            cardId: card.id,
            card: card,
            quantity: 1,
            condition: i === 0 ? CardCondition.NM : i === 1 ? CardCondition.LP : CardCondition.NM,
            purchasePrice: card.marketPrice,
            addedAt: new Date().toISOString(),
            isListing: true,
            listingPrice: i === 0 ? 5500 : i === 1 ? 1200 : 15000,
            isGraded: i === 2,
            gradingCompany: i === 2 ? 'PSA' : undefined,
            grade: i === 2 ? 10 : undefined
        }));

        return [{
            id: 'default',
            name: 'Main Vault',
            items: dummyItems,
            includeInPortfolio: true,
            createdAt: new Date().toISOString()
        }];
    });
    const [isAiLoading, setIsAiLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Supabase Auth and Persistence
    useEffect(() => {
        const supabase = createClient();

        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser({
                    id: session.user.id,
                    name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || 'User',
                    email: session.user.email || '',
                    avatar: session.user.user_metadata.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + session.user.id,
                    provider: session.user.app_metadata.provider as any || 'email'
                });
            }
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                setUser({
                    id: session.user.id,
                    name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || 'User',
                    email: session.user.email || '',
                    avatar: session.user.user_metadata.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + session.user.id,
                    provider: session.user.app_metadata.provider as any || 'email'
                });
            } else {
                setUser(null);
            }
        });

        // Load other local preferences
        const saved = localStorage.getItem('cardstreet-data-v1');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.wishlist) setWishlist(parsed.wishlist);
            if (parsed.customCollections) setCustomCollections(parsed.customCollections);
            if (parsed.currency) setCurrency(parsed.currency);
            if (parsed.language) setLanguage(parsed.language);
            if (parsed.cart) setCart(parsed.cart);
        }

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        // Persist everything EXCEPT user (now handled by Supabase)
        localStorage.setItem('cardstreet-data-v1', JSON.stringify({
            wishlist,
            customCollections,
            currency,
            language,
            cart
        }));
    }, [wishlist, customCollections, currency, language, cart]);

    // Currency Converter
    const exchangeRate = EXCHANGE_RATES[currency] || 1;
    const currencySymbol = currency === 'THB' ? '฿' : currency;

    // Dynamic Portfolio Value Calculation (Base THB)
    const totalValueTHB = useMemo(() => {
        return customCollections
            .filter(c => c.includeInPortfolio)
            .reduce((acc, col) => {
                return acc + col.items.reduce((sum, item) => sum + (item.purchasePrice * item.quantity), 0);
            }, 0);
    }, [customCollections]);

    const displayValue = totalValueTHB * (currency === 'THB' ? 1 : exchangeRate); // Rough valid assumption, assuming mock prices are THB

    const handleToggleWishlist = (card: Card) => {
        setWishlist(prev => {
            const exists = prev.find(c => c.id === card.id);
            if (exists) return prev.filter(c => c.id !== card.id);
            return [...prev, card];
        });
    };

    const handleAddToCollection = (card: Card, collectionId: string = 'default') => {
        const newItem: UserCollectionItem = {
            id: Math.random().toString(36).substr(2, 9),
            cardId: card.id,
            card: card, // Persist card data
            quantity: 1,
            condition: CardCondition.NM,
            purchasePrice: card.marketPrice,
            addedAt: new Date().toISOString()
        };

        setCustomCollections(prev => prev.map(col => {
            if (col.id === collectionId) {
                return { ...col, items: [...col.items, newItem] };
            }
            return col;
        }));

        // Auto-remove from wishlist if present
        setWishlist(prev => prev.filter(c => c.id !== card.id));

        setActiveTab('vault');
    };

    const handleAddToCart = (item: CartItem) => {
        setCart(prev => {
            if (prev.find(i => i.id === item.id)) return prev; // No duplicates
            return [...prev, item];
        });
        setIsCartOpen(true);
    };

    const handleRemoveFromCart = (id: string) => {
        setCart(prev => prev.filter(item => item.id !== id));
    };

    const handleCheckout = () => {
        setIsCartOpen(false);
        setIsPaymentModalOpen(true);
    };

    const handlePaymentSuccess = () => {
        setIsPaymentModalOpen(false);
        setCart([]);
        alert(`Payment Successful! Thank you for your purchase.`);
    };

    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsAiLoading(true);
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64String = (reader.result as string).split(',')[1];
            const scanData = await geminiService.identifyCardFromImage(base64String);
            if (scanData) {
                const matches = await pokemonService.findCardByMetadata(scanData.primary.name, scanData.primary.set, scanData.primary.number);
                if (matches.length === 1) setSelectedCard(matches[0]);
                else if (matches.length > 0) setScanCandidates(matches);
            }
            setIsAiLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsDataURL(file);
    };

    // Listing State (New)
    const [listingTarget, setListingTarget] = useState<{ colId: string, item: UserCollectionItem, card: Card } | null>(null);

    const handlePublishListing = (listingData: any) => {
        if (!listingTarget) return;

        setCustomCollections(prev => prev.map(col => {
            if (col.id === listingTarget.colId) {
                return {
                    ...col,
                    items: col.items.map(it => it.id === listingTarget.item.id ? {
                        ...it,
                        isListing: true,
                        listingPrice: listingData.price,
                        condition: listingData.condition,
                        isGraded: listingData.is_graded,
                        gradingCompany: listingData.grading_company,
                        grade: listingData.grade
                    } : it)
                };
            }
            return col;
        }));
        setListingTarget(null);
    };


    // Compute active listings from local/guest state to pass to Home
    const activeListings = useMemo(() => {
        const localList: any[] = [];
        customCollections.forEach(col => {
            col.items.forEach(item => {
                if (item.isListing) {
                    localList.push({
                        id: item.id,
                        price: item.listingPrice || 0,
                        condition: item.condition,
                        card_data: item.card || MOCK_CARDS.find(c => c.id === item.cardId),
                        seller: user || { display_name: 'Guest', avatar_url: '' }, // Use current user as seller
                        created_at: new Date().toISOString()
                    });
                }
            });
        });

        // Merge with global mock listings from constants
        const globalList = MOCK_MARKET_LISTINGS.map(l => ({
            ...l,
            seller: {
                display_name: l.seller.name,
                avatar_url: l.seller.avatar
            }
        }));

        return [...localList, ...globalList];
    }, [customCollections, user]);

    return (
        <div className="bg-brand-darker min-h-screen flex justify-center selection:bg-brand-cyan/30 overflow-hidden text-slate-200 font-sans">
            <div className="w-full max-w-[480px] bg-brand-darker h-screen flex flex-col relative border-x border-white/5 shadow-2xl overflow-hidden">

                {/* Background Gradients for depth */}
                <div className="absolute top-[-10%] left-[-20%] w-[200px] h-[200px] bg-brand-cyan/10 rounded-full blur-[80px] pointer-events-none"></div>
                <div className="absolute bottom-[-10%] right-[-20%] w-[200px] h-[200px] bg-brand-red/10 rounded-full blur-[80px] pointer-events-none"></div>

                <main className="flex-1 overflow-y-auto scrollbar-hide flex flex-col z-10">
                    {/* Header */}
                    <header className="w-full px-6 py-6 flex justify-between items-center z-30 shrink-0">
                        <div className="flex items-center">
                            {/* CardStreet Icon Only */}
                            <div className="relative w-14 h-14 flex-shrink-0">
                                {/* Halftone/Glow behind */}
                                <div className="absolute -inset-4 bg-brand-cyan/20 blur-xl rounded-full opacity-50"></div>

                                {/* Shield Background */}
                                <div className="absolute inset-0 bg-black border-[3px] border-white rounded-xl transform skew-x-[-5deg] scale-[0.9] z-0 shadow-2xl"></div>

                                {/* Green Card (Back Right) */}
                                <div className="absolute top-2 right-1.5 w-6 h-8 bg-brand-green rounded-md border-2 border-white transform rotate-[15deg] shadow-md z-10"></div>

                                {/* Red Card (Middle) */}
                                <div className="absolute top-1 left-4 w-6 h-8 bg-brand-red rounded-md border-2 border-white transform -rotate-[5deg] shadow-md z-20"></div>

                                {/* Blue Card (Front Left) */}
                                <div className="absolute top-2 left-1.5 w-6 h-8 bg-brand-cyan rounded-md border-2 border-white transform -rotate-[20deg] shadow-lg z-30 overflow-hidden">
                                    {/* The Road Stripe */}
                                    <div className="absolute left-1/2 -translate-x-1/2 top-0 h-full w-2 bg-white skew-x-[15deg] opacity-90"></div>
                                    {/* Road Markings */}
                                    <div className="absolute left-1/2 -translate-x-1/2 top-0 h-full w-2 flex flex-col justify-between py-[2px] skew-x-[15deg]">
                                        <div className="w-full h-[20%] bg-brand-cyan"></div>
                                        <div className="w-full h-[20%] bg-brand-cyan"></div>
                                        <div className="w-full h-[20%] bg-brand-cyan"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsCartOpen(true)}
                                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 relative transition-all"
                            >
                                <i className="fa-solid fa-cart-shopping text-slate-400"></i>
                                {cart.length > 0 && (
                                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-red text-white text-[9px] font-black rounded-full flex items-center justify-center border border-brand-darker">
                                        {cart.length}
                                    </span>
                                )}
                            </button>

                            <CurrencySwitcher currentCurrency={currency} onCurrencyChange={setCurrency} />
                        </div>
                    </header>

                    <div className="flex-1 px-6 pb-40">
                        {/* Home Tab Removed - Default is Marketplace */}
                        {activeTab === 'explore' && (
                            <Explore
                                onSelectCard={setSelectedCard}
                                searchRequest={searchRequest}
                                localListings={activeListings}
                            />
                        )}
                        {activeTab === 'marketplace' && (
                            <Marketplace
                                initialGame={marketGameFilter}
                                onSelectCard={setSelectedCard}
                                onSelectListing={setSelectedListing}
                                onSellerClick={(seller) => {
                                    setViewingSeller({
                                        id: seller.id || 'mock-id',
                                        name: seller.display_name,
                                        email: 'seller@example.com',
                                        avatar: seller.avatar_url,
                                        provider: 'google',
                                        rating: parseFloat(seller.rating) || 4.8,
                                        badges: ['Verified Pro', 'Fast Shipper']
                                    });
                                    setActiveTab('seller_profile');
                                }}
                                onAddToCart={handleAddToCart}
                                listings={activeListings}
                                currency={currency}
                                exchangeRate={exchangeRate}
                            />
                        )}
                        {activeTab === 'seller_profile' && viewingSeller && (
                            <SellerProfile
                                seller={viewingSeller}
                                listings={activeListings.slice(0, 4)} // Mock: just give them some listings
                                reviews={MOCK_REVIEWS}
                                onBack={() => setActiveTab('marketplace')}
                                onSelectCard={setSelectedCard}
                            />
                        )}
                        {activeTab === 'add' && <AddCard onScanClick={() => fileInputRef.current?.click()} onSelectCard={setSelectedCard} />}
                        {activeTab === 'vault' && (
                            <Vault
                                customCollections={customCollections}
                                wishlist={wishlist}
                                onUpdateCollections={setCustomCollections}
                                onToggleWishlist={handleToggleWishlist}
                                onAddToCollection={handleAddToCollection}
                                onListCard={(colId, item, card) => setListingTarget({ colId, item, card })}
                                listingTarget={listingTarget}
                                onCancelListing={() => setListingTarget(null)}
                                onPublishListing={handlePublishListing}
                                activeListings={activeListings}
                                totalValue={displayValue}
                                currencySymbol={currencySymbol}
                            />
                        )}
                        {activeTab === 'profile' && (
                            <Profile
                                user={user}
                                onNavigatePartner={() => setActiveTab('partner')}
                                onGuestLogin={() => {
                                    setUser({
                                        id: 'guest',
                                        name: 'Guest Director',
                                        email: 'guest@cardstreet.app',
                                        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=guest',
                                        provider: 'guest'
                                    });
                                }}
                            />
                        )}
                        {activeTab === 'partner' && (
                            user?.isPartner ? (
                                <PartnerPortal user={user} />
                            ) : (
                                <PartnerRequest onApply={() => {
                                    if (user) {
                                        setUser({
                                            ...user,
                                            isPartner: true,
                                            partnerStats: {
                                                totalSignups: 324,
                                                level: 2,
                                                currentFee: 4.5,
                                                totalEarnings: 15400,
                                                referralCode: `CS-${user.name.toUpperCase().slice(0, 3)}`
                                            }
                                        });
                                    } else {
                                        alert("Please sign in to apply.");
                                        setActiveTab('profile');
                                    }
                                }} />
                            )
                        )}
                    </div>
                </main>

                <nav className="absolute bottom-0 left-0 w-full bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 px-6 pt-2 pb-8 flex justify-between items-end z-40 animate-slideUp">
                    {/* 1. SHOP (Marketplace) */}
                    <button onClick={() => setActiveTab('marketplace')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'marketplace' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-shop text-xl transition-colors ${activeTab === 'marketplace' ? 'text-brand-purple drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'marketplace' ? 'opacity-100 text-white' : 'opacity-0'}`}>Shop</span>
                    </button>

                    {/* 2. EXPLORE */}
                    <button onClick={() => setActiveTab('explore')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'explore' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-magnifying-glass text-xl transition-colors ${activeTab === 'explore' ? 'text-brand-red drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'explore' ? 'opacity-100 text-white' : 'opacity-0'}`}>Explore</span>
                    </button>

                    {/* 3. SCAN (Center) */}
                    <div className="relative -top-6">
                        <button onClick={() => setActiveTab('add')} className="flex items-center justify-center bg-white text-brand-darker w-16 h-16 rounded-full border-[6px] border-brand-darker z-50 active:scale-95 transition-all shadow-xl shadow-white/10 group">
                            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-brand-cyan via-brand-red to-brand-green opacity-20 group-hover:opacity-100 transition-opacity"></div>
                            {isAiLoading ? (
                                <div className="animate-spin h-6 w-6 border-3 border-brand-darker/20 border-t-brand-darker rounded-full relative z-10"></div>
                            ) : (
                                <i className="fa-solid fa-camera text-2xl relative z-10"></i>
                            )}
                        </button>
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-full text-center">
                            <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'add' ? 'opacity-100 text-white' : 'opacity-0'}`}>Scan</span>
                        </div>
                    </div>

                    {/* 4. VAULT */}
                    <button onClick={() => setActiveTab('vault')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'vault' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-vault text-xl transition-colors ${activeTab === 'vault' ? 'text-brand-green drop-shadow-[0_0_10px_rgba(132,204,22,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'vault' ? 'opacity-100 text-white' : 'opacity-0'}`}>Vault</span>
                    </button>

                    {/* 5. PROFILE */}
                    <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'profile' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-user-astronaut text-xl transition-colors ${activeTab === 'profile' ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'profile' ? 'opacity-100 text-white' : 'opacity-0'}`}>Profile</span>
                    </button>
                </nav>

                {scanCandidates.length > 0 && <ScanCandidateModal candidates={scanCandidates} onSelect={(card) => { setSelectedCard(card); setScanCandidates([]); }} onCancel={() => setScanCandidates([])} />}
                {selectedCard && (
                    <CardDetails
                        card={selectedCard}
                        isWishlisted={!!wishlist.find(c => c.id === selectedCard.id)}
                        onClose={() => setSelectedCard(null)}
                        onToggleWishlist={handleToggleWishlist}
                        onAddToCollection={(card) => { handleAddToCollection(card); setSelectedCard(null); }}
                        onShopNow={() => {
                            setActiveTab('marketplace');
                            setSearchRequest({ term: selectedCard.name, timestamp: Date.now() });
                            setSelectedCard(null);
                        }}
                        onAddToCart={(item) => handleAddToCart(item)}
                        currency={currency}
                        exchangeRate={exchangeRate}
                    />
                )}

                {selectedListing && (
                    <ListingDetails
                        listing={selectedListing}
                        onClose={() => setSelectedListing(null)}
                        onBuyNow={() => {
                            setCart([{
                                id: selectedListing.id,
                                card: selectedListing.card_data,
                                price: selectedListing.price, // Store base price for now
                                sellerName: selectedListing.seller?.display_name || 'Unknown',
                                condition: selectedListing.condition
                            }]);
                            setSelectedListing(null);
                            setIsPaymentModalOpen(true);
                        }}
                        onAddToCart={() => {
                            handleAddToCart({
                                id: selectedListing.id,
                                card: selectedListing.card_data,
                                price: selectedListing.price,
                                sellerName: selectedListing.seller?.display_name || 'Unknown',
                                condition: selectedListing.condition
                            });
                            setSelectedListing(null);
                        }}
                        onSellerClick={(seller) => {
                            setViewingSeller({
                                id: seller.id || 'mock-id',
                                name: seller.display_name,
                                email: 'seller@example.com',
                                avatar: seller.avatar_url,
                                provider: 'google',
                                rating: parseFloat(seller.rating) || 4.8,
                                badges: ['Verified Pro', 'Fast Shipper']
                            });
                            setSelectedListing(null); // Close modal
                            setActiveTab('seller_profile');
                        }}
                        currency={currency}
                        exchangeRate={exchangeRate}
                    />
                )}

                <CartDrawer
                    isOpen={isCartOpen}
                    onClose={() => setIsCartOpen(false)}
                    cart={cart}
                    onRemoveItem={handleRemoveFromCart}
                    onCheckout={handleCheckout}
                    currencySymbol={currencySymbol}
                />

                <PaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    amount={cart.reduce((s, i) => s + i.price, 0) * (currency === 'THB' ? 1 : exchangeRate)}
                    currency={currency}
                    items={cart}
                    onPaymentSuccess={handlePaymentSuccess}
                    onPaymentFailed={(err) => alert("Payment Failed: " + err)}
                />
            </div>
        </div>
    );
}
