'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, UserCollectionItem, CardCondition, CustomCollection, UserProfile, CartItem } from '@/types';
import { EXCHANGE_RATES } from '@/constants';
import CurrencySwitcher from '@/components/CurrencySwitcher';
import LanguagePicker from '@/components/LanguagePicker';
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
import { marketplaceService, MarketplaceListing } from '@/services/marketplaceService';

import { createClient } from '@/lib/supabase/client';
import { useUserCollections } from '@/lib/hooks/useUserCollections';
import { useWishlist } from '@/lib/hooks/useWishlist';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';

import PartnerPortal from '@/components/PartnerPortal';
import PartnerRequest from '@/components/PartnerRequest';
import SellerProfile from '@/components/SellerProfile';
import BuylistRequest from '@/components/BuylistRequest';

export default function HomePage() {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'marketplace' | 'add' | 'vault' | 'profile' | 'partner' | 'seller_profile'>('marketplace');
    const [marketGameFilter, setMarketGameFilter] = useState('all');
    const [selectedCard, setSelectedCard] = useState<Card | null>(null);
    const [selectedListing, setSelectedListing] = useState<any | null>(null);
    const [viewingSeller, setViewingSeller] = useState<UserProfile | null>(null);
    const [scanCandidates, setScanCandidates] = useState<Card[]>([]);
    const [user, setUser] = useState<UserProfile | null>(null);

    // Supabase hooks for data management
    const {
        collections: customCollections,
        isLoading: collectionsLoading,
        addCollection,
        deleteCollection,
        updateCollection,
        addCardToCollection,
        removeCardFromCollection,
        updateCollectionItem,
        refreshCollections
    } = useUserCollections();

    const {
        wishlist,
        isLoading: wishlistLoading,
        addToWishlist,
        removeFromWishlist,
        isInWishlist
    } = useWishlist();

    const {
        settings,
        updateCurrency,
        updateLanguage
    } = useUserSettings();

    // Derive currency and language from settings
    const currency = settings.currency;
    const language = settings.language;

    // Cart State (still using localStorage for now)
    const [cart, setCart] = useState<CartItem[]>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('cardstreet-cart');
            if (saved) return JSON.parse(saved);
        }
        return [];
    });
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    // Buylist State
    const [buylistCard, setBuylistCard] = useState<Card | null>(null);

    // Search Request State (Object with timestamp to force updates even for same query)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [searchRequest, setSearchRequest] = useState<{ term: string, timestamp: number } | null>(null);
    const [isAiLoading, setIsAiLoading] = useState(false);

    const [safeArea, setSafeArea] = useState({ top: 0, bottom: 0 });

    // Detect Capacitor native platform and set safe area paddings
    // Android WebView often fails to populate env(safe-area-inset-*) correctly
    useEffect(() => {
        const detectPlatform = async () => {
            try {
                const { Capacitor } = await import('@capacitor/core');
                if (Capacitor.isNativePlatform()) {
                    const platform = Capacitor.getPlatform();

                    try {
                        const { StatusBar, Style } = await import('@capacitor/status-bar');
                        await StatusBar.setOverlaysWebView({ overlay: true });
                        await StatusBar.setStyle({ style: Style.Dark });
                    } catch (e) {
                        console.warn('StatusBar plugin not available', e);
                    }

                    if (platform === 'android') {
                        // Track both top and bottom safe areas now that webview overlays the status bar
                        setSafeArea({ top: 44, bottom: 24 });
                        document.documentElement.style.setProperty('--sab', '24px');
                        document.documentElement.style.setProperty('--sat', '44px');
                    }
                }
            } catch {
                // Ignore web
            }
        };
        detectPlatform();
    }, []);

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

        return () => subscription.unsubscribe();
    }, []);

    // Persist cart to localStorage
    useEffect(() => {
        if (cart.length > 0) {
            localStorage.setItem('cardstreet-cart', JSON.stringify(cart));
        }
    }, [cart]);

    // Currency Converter
    const exchangeRate = EXCHANGE_RATES[currency] || 1;
    const currencySymbol = currency === 'THB' ? '฿' : currency;

    // Dynamic Portfolio Value Calculation (Base THB)
    const totalValueTHB = useMemo(() => {
        return customCollections
            .filter(c => c.includeInPortfolio)
            .reduce((acc, col) => {
                return acc + col.items.reduce((sum, item) => {
                    const marketPrice = item.card?.marketPrice ?? item.cardData?.marketPrice ?? (import('@/constants').then(c => c.MOCK_CARDS.find(mc => mc.id === item.cardId)?.marketPrice)) as unknown as number ?? 0;
                    return sum + (marketPrice * item.quantity);
                }, 0);
            }, 0);
    }, [customCollections]);

    const displayValue = totalValueTHB * (currency === 'THB' ? 1 : exchangeRate); // Rough valid assumption, assuming mock prices are THB

    // Helper function to check authentication
    const requireAuth = (actionName: string): boolean => {
        if (!user) {
            showToast(`Please sign in to ${actionName}`, 'error');
            setActiveTab('profile');
            return false;
        }
        return true;
    };

    const handleToggleWishlist = async (card: Card) => {
        if (!requireAuth('manage your wishlist')) return;

        try {
            if (isInWishlist(card.id)) {
                await removeFromWishlist(card.id);
            } else {
                await addToWishlist(card);
            }
        } catch (error: any) {
            console.error('Failed to update wishlist:', error);
            const errorMessage = error?.message || 'Unknown error';
            showToast(`Failed to update wishlist: ${errorMessage}`, 'error');
        }
    };

    const handleAddToCollection = async (card: Card, collectionId: string = 'default') => {
        if (!requireAuth('add cards to your vault')) return;

        try {
            // Use the first collection (Main Vault created on signup)
            // If somehow no collections exist, create one
            let targetId = collectionId;
            if (customCollections.length === 0) {
                const newCollectionId = await addCollection('Main Vault', true);
                targetId = newCollectionId;
            } else if (collectionId === 'default') {
                targetId = customCollections[0].id;
            }

            await addCardToCollection(targetId, card, {
                quantity: 1,
                condition: CardCondition.NM,
                purchasePrice: card.marketPrice
            });

            // Auto-remove from wishlist if present
            if (isInWishlist(card.id)) {
                await removeFromWishlist(card.id);
            }

            setActiveTab('vault');
        } catch (error: any) {
            console.error('Failed to add card to collection:', error);
            // Show more detailed error for debugging
            const errorMessage = error?.message || 'Unknown error';
            showToast(`Failed to add card to collection: ${errorMessage}`, 'error');
        }
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

    const handlePaymentSuccess = async (paymentMethod = 'card', paymentId = 'simulated_success') => {
        if (!user) return;

        try {
            const res = await fetch('/api/orders/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: cart,
                    paymentMethod,
                    paymentId,
                    buyerId: user.id
                })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            setIsPaymentModalOpen(false);
            setCart([]);

            // Refresh local state aggressively to hide sold items and show new vault items
            fetchGlobalListings();
            refreshCollections();

            showToast(`Payment Successful! Thank you for your purchase.`, 'success');
        } catch (err: any) {
            console.error('Checkout failed:', err);
            alert(`Payment succeeded but checkout failed: ${err.message}`);
        }
    };

    const handleScanCard = async () => {
        setIsAiLoading(true);
        try {
            // Dynamically import Capacitor Camera to avoid SSR issues
            const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
            const { Capacitor } = await import('@capacitor/core');

            let base64String: string;

            if (Capacitor.isNativePlatform()) {
                // Native: use Capacitor Camera plugin with permission handling
                const photo = await Camera.getPhoto({
                    quality: 90,
                    allowEditing: false,
                    resultType: CameraResultType.Base64,
                    source: CameraSource.Camera,
                    width: 1200,
                    height: 1600,
                    correctOrientation: true,
                });
                base64String = photo.base64String || '';
            } else {
                // Web fallback: use file input
                base64String = await new Promise<string>((resolve, reject) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.capture = 'environment';
                    input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) { reject('No file selected'); return; }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            resolve((reader.result as string).split(',')[1]);
                        };
                        reader.readAsDataURL(file);
                    };
                    input.click();
                });
            }

            if (!base64String) {
                console.warn('[Scan] Empty base64 string from camera');
                return;
            }

            // Step 1: Send image to Gemini AI for identification
            console.log('[Scan] Sending image to Gemini AI...');
            const scanData = await geminiService.identifyCardFromImage(base64String);
            console.log('[Scan] Gemini response:', scanData);

            if (!scanData || !scanData.primary?.name) {
                showToast('Could not identify the card. Please try again with better lighting or angle.', 'error');
                return;
            }

            // Step 2: Search database for matches
            // Use setHint (Set Code) if available as it's more accurate than Set Name
            const setIdentifier = scanData.primary.setHint || scanData.primary.set;
            const detectedLanguage = scanData.primary.language;

            console.log(`[Scan] Searching DB for: ${scanData.primary.name} / ${setIdentifier} / #${scanData.primary.number}`);
            if (detectedLanguage) console.log(`[Scan] Detected Language: ${detectedLanguage}`);

            let matches = await pokemonService.findCardByMetadata(
                scanData.primary.name,
                setIdentifier,
                scanData.primary.number
            );
            console.log(`[Scan] Metadata search returned ${matches.length} matches`);

            // Step 3: If no exact matches, try a broader name-only search
            if (matches.length === 0) {
                console.log('[Scan] No metadata match, trying name-only search...');
                matches = await pokemonService.searchCards(
                    scanData.primary.name,
                    false, // useAiResolution
                    detectedLanguage as 'en' | 'jp' | 'th' // Pass language hint to search
                );
                console.log(`[Scan] Name search returned ${matches.length} matches`);
            }

            // Step 4: Handle results
            if (matches.length === 1) {
                setSelectedCard(matches[0]);
            } else if (matches.length > 1) {
                setScanCandidates(matches);
            } else {
                showToast(`AI identified: "${scanData.primary.name}" from set "${scanData.primary.set}", but no matching card was found in the database.`, 'error');
            }
        } catch (error: any) {
            // Check for user cancellation (Capacitor camera cancel or file input cancel)
            const msg = error?.message || String(error) || '';
            if (msg.includes('cancel') || msg.includes('Cancel') || msg.includes('dismissed') || error === 'No file selected') {
                // User cancelled — silently ignore
                console.log('[Scan] User cancelled camera');
            } else {
                console.error('[Scan] Error:', error);
                showToast(`Scan failed: ${msg || 'Unknown error'}. Please try again.`, 'error');
            }
        } finally {
            setIsAiLoading(false);
        }
    };

    // Listing State (New)
    const [listingTarget, setListingTarget] = useState<{ colId: string, item: UserCollectionItem, card: Card } | null>(null);

    // Global Active Listings state powered by Supabase
    const [activeListings, setActiveListings] = useState<MarketplaceListing[]>([]);

    const fetchGlobalListings = async () => {
        try {
            const listings = await marketplaceService.getActiveListings();
            setActiveListings(listings);
        } catch (error) {
            console.error('Failed to fetch global listings:', error);
        }
    };

    useEffect(() => {
        fetchGlobalListings();
    }, []);

    const handlePublishListing = async (listingData: any) => {
        if (!listingTarget) return;

        try {
            // 1. Create true database listing
            await marketplaceService.createListing({
                cardId: listingTarget.card.id,
                cardData: listingTarget.card,
                price: listingData.price,
                condition: listingData.condition,
                isGraded: listingData.is_graded,
                gradingCompany: listingData.grading_company,
                grade: listingData.grade
            });

            // 2. Refresh global marketplace listings
            await fetchGlobalListings();

            // 3. Update local collection item to reflect it is listed
            await updateCollectionItem(listingTarget.colId, listingTarget.item.id, {
                isListing: true,
                listingPrice: listingData.price,
                // condition: listingData.condition, (avoid overwriting base item stats if we only want the listing to hold them)
                // isGraded: listingData.is_graded,
            });

            setListingTarget(null);
            showToast('Listing successfully published to the market!', 'success');
        } catch (error) {
            console.error('Failed to publish listing:', error);
            alert('Failed to publish listing. Please try again.');
        }
    };

    // Global Back Button Handling
    // State Refs for Back Button Listener (Prevents stale closures)
    const stateRef = useRef({
        isPaymentModalOpen,
        isCartOpen,
        selectedCard,
        selectedListing,
        buylistCard,
        activeTab
    });

    // Update refs whenever state changes
    useEffect(() => {
        stateRef.current = {
            isPaymentModalOpen,
            isCartOpen,
            selectedCard,
            selectedListing,
            buylistCard,
            activeTab
        };
    }, [isPaymentModalOpen, isCartOpen, selectedCard, selectedListing, buylistCard, activeTab]);

    // Global Back Button Handling & Deep Links
    useEffect(() => {
        let backListener: any;
        let appUrlListener: any;

        const setupListeners = async () => {
            const { App } = await import('@capacitor/app');

            // 1. Back Button
            backListener = await App.addListener('backButton', () => {
                const state = stateRef.current;

                // Layer 1: Modals & Overlays
                if (state.isPaymentModalOpen) {
                    setIsPaymentModalOpen(false);
                    return;
                }
                if (state.isCartOpen) {
                    setIsCartOpen(false);
                    return;
                }
                if (state.selectedCard) {
                    setSelectedCard(null);
                    return;
                }
                if (state.selectedListing) {
                    setSelectedListing(null);
                    return;
                }
                if (state.buylistCard) {
                    setBuylistCard(null);
                    return;
                }

                // Layer 2: Vault Internal Navigation
                if (state.activeTab === 'vault') {
                    return;
                }

                // Layer 3: Navigation History / Root
                if (state.activeTab !== 'explore') {
                    setActiveTab('explore');
                } else {
                    App.minimizeApp();
                }
            });

            // 2. Deep Links (Custom Scheme Auth)
            appUrlListener = await App.addListener('appUrlOpen', async (data) => {
                console.log('[DeepLink] App opened with URL:', data.url);

                try {
                    const { Browser } = await import('@capacitor/browser');
                    await Browser.close();
                } catch (e) {
                    console.error('Browser close ignored or failed', e);
                }

                // Handle native HTTP App Links and Custom Schemes
                if (data.url.includes('cardstreet://') || data.url.includes('/mobile-redirect')) {
                    // Parse URL parameters
                    // Capacitor URL might look like: cardstreet://login-callback#access_token=...&refresh_token=... (Implicit)
                    // Or if using PKCE flow with redirect: cardstreet://login-callback?code=...

                    try {
                        const url = new URL(data.url);
                        const code = url.searchParams.get('code');
                        const error = url.searchParams.get('error');
                        const errorDescription = url.searchParams.get('error_description');

                        if (error) {
                            console.error('[DeepLink] Auth Error:', error, errorDescription);
                            showToast(`Authentication Failed: ${errorDescription || error}`, 'error');
                            return;
                        }

                        if (code) {
                            console.log('[DeepLink] Auth Code found, exchanging...');
                            const supabase = createClient();
                            const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

                            if (sessionError) {
                                console.error('[DeepLink] Exchange Failed:', sessionError);
                                showToast(`Login Failed: ${sessionError.message}`, 'error');
                            } else {
                                console.log('[DeepLink] Exchange Success!', sessionData);
                                // Session is set, UI will update via onAuthStateChange
                                showToast('Successfully signed in!', 'success');
                                // Force reload if needed or just let state update
                            }
                        } else {
                            // Check for hash fragments (Implicit flow fallback)
                            if (data.url.includes('#')) {
                                const hash = data.url.split('#')[1];
                                const params = new URLSearchParams(hash);
                                const accessToken = params.get('access_token');
                                if (accessToken) {
                                    console.log('[DeepLink] Access Token found in hash (Implicit Flow)');
                                    const supabase = createClient();
                                    const { error: setSessionError } = await supabase.auth.setSession({
                                        access_token: accessToken,
                                        refresh_token: params.get('refresh_token') || '',
                                    });
                                    if (setSessionError) {
                                        console.error('[DeepLink] SetSession Failed:', setSessionError);
                                        showToast('Login Failed: ' + setSessionError.message, 'error');
                                    } else {
                                        showToast('Successfully signed in!', 'success');
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[DeepLink] Error parsing URL:', err);
                    }
                }
            });
        };
        setupListeners();

        // Check for Auth Errors (Web Redirect Fallback)
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error === 'auth_failed') {
            const details = params.get('details');
            console.error("Auth Failed Redirect Detected:", details);
            showToast(`Authentication failed: ${details || 'Unknown error'}`, 'error');

            // Clean up URL
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: newUrl }, '', newUrl);
        }

        return () => {
            if (backListener) backListener.remove();
            if (appUrlListener) appUrlListener.remove();
        };
    }, []); // Empty dependency array - relies on refs!

    return (
        <div className="bg-brand-darker h-[100dvh] w-full flex justify-center selection:bg-brand-cyan/30 overflow-hidden text-slate-200 font-sans"
            style={{
                paddingTop: safeArea.top ? `${safeArea.top}px` : 'env(safe-area-inset-top, 0px)',
                paddingBottom: safeArea.bottom ? `${safeArea.bottom}px` : 'env(safe-area-inset-bottom, 0px)',
                paddingLeft: 'env(safe-area-inset-left, 0px)',
                paddingRight: 'env(safe-area-inset-right, 0px)'
            }}>
            <div className="w-full max-w-[480px] bg-brand-darker h-full flex flex-col relative border-x border-white/5 shadow-2xl overflow-hidden">

                {/* Background Gradients for depth (Now safely pushed below status bar) */}
                <div className="absolute top-[-10%] left-[-20%] w-[200px] h-[200px] bg-brand-cyan/10 rounded-full blur-[80px] pointer-events-none"></div>
                <div className="absolute bottom-[-10%] right-[-20%] w-[200px] h-[200px] bg-brand-red/10 rounded-full blur-[80px] pointer-events-none"></div>

                <main className="flex-1 flex flex-col z-10 w-full h-full relative overflow-hidden">
                    {/* Header */}
                    <header
                        className="w-full px-6 py-3 flex justify-between items-center z-50 shrink-0 bg-brand-darker border-b border-white/5"
                    >
                        <div className="flex items-center">
                            {/* CardStreet Logo */}
                            <button
                                onClick={() => setActiveTab('marketplace')}
                                className="relative w-[54px] h-[54px] flex-shrink-0 hover:scale-105 transition-transform"
                            >
                                <img
                                    src="/logo.png"
                                    alt="CardStreet"
                                    className="w-full h-full object-contain"
                                />
                            </button>
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

                            <LanguagePicker currentLanguage={language} onLanguageChange={(newLang) => updateLanguage(newLang)} />
                            <CurrencySwitcher currentCurrency={currency} onCurrencyChange={(newCurrency) => updateCurrency(newCurrency)} />
                        </div>
                    </header>

                    <div className={`flex-1 w-full ${activeTab === 'marketplace' || activeTab === 'explore' ? 'overflow-hidden flex flex-col px-6 pb-24' : 'overflow-y-auto scrollbar-hide px-6 pb-40'}`}>
                        {/* Home Tab Removed - Default is Marketplace */}
                        {activeTab === 'explore' && (
                            <Explore
                                onSelectCard={setSelectedCard}
                                searchRequest={searchRequest}
                                localListings={activeListings}
                                currency={currency}
                                exchangeRate={exchangeRate}
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
                                        email: seller.email || 'seller@example.com',
                                        avatar: seller.avatar_url,
                                        provider: 'google',
                                        rating: parseFloat(seller.rating) || 0,
                                        badges: seller.badges || []
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
                                listings={activeListings.slice(0, 4)}
                                reviews={[]}
                                onBack={() => setActiveTab('marketplace')}
                                onSelectCard={setSelectedCard}
                                currency={currency}
                                exchangeRate={exchangeRate}
                            />
                        )}
                        {activeTab === 'add' && <AddCard onScanClick={handleScanCard} onSelectCard={setSelectedCard} isScanning={isAiLoading} />}
                        {activeTab === 'vault' && (
                            <Vault
                                customCollections={customCollections}
                                wishlist={wishlist}
                                onUpdateCollections={(updatedCollections) => {
                                    // This is a legacy prop - Vault uses it for direct collection manipulation
                                    // For now, we'll handle updates through the hook methods instead
                                    console.warn('onUpdateCollections called - consider refactoring Vault to use hook methods directly');
                                }}
                                onRemoveFromCollection={removeCardFromCollection}
                                onToggleWishlist={handleToggleWishlist}
                                onAddToCollection={handleAddToCollection}
                                onListCard={(colId, item, card) => setListingTarget({ colId, item, card })}
                                listingTarget={listingTarget}
                                onCancelListing={() => setListingTarget(null)}
                                onPublishListing={handlePublishListing}
                                activeListings={activeListings}
                                totalValue={displayValue}
                                currencySymbol={currencySymbol}
                                currency={currency}
                                exchangeRate={exchangeRate}
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
                                        showToast("Please sign in to apply.", 'info');
                                        setActiveTab('profile');
                                    }
                                }} />
                            )
                        )}
                    </div>
                </main>

                <nav className="absolute bottom-0 left-0 w-full bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 px-6 pt-2 flex justify-between items-end z-40 animate-slideUp" style={{ paddingBottom: 'calc(var(--nav-bar-height, 0px) + 8px)' }}>
                    {/* 1. SHOP (Marketplace) */}
                    <button onClick={() => setActiveTab('marketplace')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'marketplace' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-shop text-xl transition-colors ${activeTab === 'marketplace' ? 'text-brand-purple drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'marketplace' ? 'opacity-100 text-white' : 'opacity-0'}`}>{t('nav.shop')}</span>
                    </button>

                    {/* 2. EXPLORE */}
                    <button onClick={() => setActiveTab('explore')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'explore' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-magnifying-glass text-xl transition-colors ${activeTab === 'explore' ? 'text-brand-red drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'explore' ? 'opacity-100 text-white' : 'opacity-0'}`}>{t('nav.explore')}</span>
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
                            <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'add' ? 'opacity-100 text-white' : 'opacity-0'}`}>{t('nav.scan')}</span>
                        </div>
                    </div>

                    {/* 4. VAULT */}
                    <button onClick={() => setActiveTab('vault')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'vault' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-vault text-xl transition-colors ${activeTab === 'vault' ? 'text-brand-green drop-shadow-[0_0_10px_rgba(132,204,22,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'vault' ? 'opacity-100 text-white' : 'opacity-0'}`}>{t('nav.vault')}</span>
                    </button>

                    {/* 5. PROFILE */}
                    <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1.5 flex-1 transition-all group p-2 ${activeTab === 'profile' ? '-translate-y-2' : ''}`}>
                        <i className={`fa-solid fa-user-astronaut text-xl transition-colors ${activeTab === 'profile' ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' : 'text-slate-600 group-hover:text-slate-400'}`}></i>
                        <span className={`text-[9px] font-black uppercase tracking-widest transition-opacity ${activeTab === 'profile' ? 'opacity-100 text-white' : 'opacity-0'}`}>{t('nav.profile')}</span>
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
                        onAddToBuylist={() => {
                            setBuylistCard(selectedCard);
                            setSelectedCard(null);
                        }}
                        listings={activeListings}
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
                                cardId: selectedListing.card_id,
                                card: selectedListing.card_data,
                                price: selectedListing.price, // Store base price for now
                                sellerId: selectedListing.seller_id,
                                sellerName: selectedListing.seller?.display_name || 'Unknown',
                                condition: selectedListing.condition
                            }]);
                            setSelectedListing(null);
                            setIsPaymentModalOpen(true);
                        }}
                        onAddToCart={() => {
                            handleAddToCart({
                                id: selectedListing.id,
                                cardId: selectedListing.card_id,
                                card: selectedListing.card_data,
                                price: selectedListing.price,
                                sellerId: selectedListing.seller_id,
                                sellerName: selectedListing.seller?.display_name || 'Unknown',
                                condition: selectedListing.condition
                            });
                            setSelectedListing(null);
                        }}
                        onSellerClick={(seller) => {
                            setViewingSeller({
                                id: seller.id || 'mock-id',
                                name: seller.display_name,
                                email: seller.email || 'seller@example.com',
                                avatar: seller.avatar_url,
                                provider: 'google',
                                rating: parseFloat(seller.rating) || 0,
                                badges: seller.badges || []
                            });
                            setSelectedListing(null); // Close modal
                            setActiveTab('seller_profile');
                        }}
                        currency={currency}
                        exchangeRate={exchangeRate}
                    />
                )}

                {buylistCard && (
                    <BuylistRequest
                        card={buylistCard}
                        onClose={() => setBuylistCard(null)}
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
