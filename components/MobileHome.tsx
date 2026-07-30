'use client'

import * as Sentry from '@sentry/nextjs';

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Card, UserCollectionItem, CardCondition, CustomCollection, UserProfile, CartItem, Review, Offer } from '@/types';
import { EXCHANGE_RATES, CURRENCY_SYMBOLS } from '@/constants';
import CurrencySwitcher from '@/components/CurrencySwitcher';
import LanguagePicker from '@/components/LanguagePicker';
import Explore from '@/components/Explore';
import Marketplace from '@/components/Marketplace';
import AddCard from '@/components/AddCard';
import Vault from '@/components/Vault';
import Profile from '@/components/Profile';
import CardDetails from '@/components/CardDetails';
import CartDrawer from '@/components/CartDrawer';
import AuthModal from '@/components/AuthModal';
import AuthLinkErrorNotice from '@/components/AuthLinkErrorNotice';
import PurchaseRegionModal from '@/components/PurchaseRegionModal';
import CheckoutAddressSheet, { EMPTY_CHECKOUT_ADDRESS, type CheckoutAddressValues } from '@/components/CheckoutAddressSheet';
import ScanCandidateModal from '@/components/ScanCandidateModal';
import ListingDetails from '@/components/ListingDetails';
import OfferModal from '@/components/OfferModal';

// Lazy-loaded — these carry heavy deps (Stripe Elements, camera plugin) we
// don't need until the user actually opens checkout or the scanner.
const PaymentModal = dynamic(() => import('@/components/PaymentModal'), { ssr: false });
const WebLiveScanner = dynamic(() => import('@/components/WebLiveScanner'), { ssr: false });
import { geminiService } from '@/services/geminiService';
import { pokemonService } from '@/services/pokemonService';
import { marketplaceService, MarketplaceListing, ProfileIncompleteError } from '@/services/marketplaceService';
import {
    SELLER_REQUIRED_PROFILE_FIELDS,
    checkSellerProfileComplete,
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
} from '@/lib/profileValidation';
import { isValidThaiPhone } from '@/lib/utils/phone';

import { createClient } from '@/lib/supabase/client';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import { sendScanFeedback } from '@/lib/scanFeedback';
import { trackMetaEvent } from '@/lib/metaEvents';
import { captureReferralParam, maybeAttributeReferral } from '@/lib/referralClient';
import { maybeReportInstallReferrer } from '@/lib/installReferrer';
import { useUserCollections } from '@/lib/hooks/useUserCollections';
import { useWishlist } from '@/lib/hooks/useWishlist';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { usePurchaseRegion, ensurePurchaseRegion } from '@/lib/hooks/usePurchaseRegion';

import PartnerPortal from '@/components/PartnerPortal';
import PartnerRequest from '@/components/PartnerRequest';
import PartnerFinishSetup from '@/components/PartnerFinishSetup';
import SellerProfile from '@/components/SellerProfile';
import BuylistRequest from '@/components/BuylistRequest';

// Tabs that are safe to land on directly (via /?tab=<name> or a same-session
// restore). 'seller_profile' needs a seller loaded in state and 'home' no
// longer renders, so neither is a valid landing target.
const LANDING_TABS = ['explore', 'marketplace', 'add', 'vault', 'profile', 'partner'] as const;
type LandingTab = (typeof LANDING_TABS)[number];
const isLandingTab = (v: string | null): v is LandingTab =>
    !!v && (LANDING_TABS as readonly string[]).includes(v);
const ACTIVE_TAB_STORAGE_KEY = 'cs_active_tab';
const USER_SNAPSHOT_STORAGE_KEY = 'cs_user_snapshot';

// An auth-gated action the user attempted while signed out. Remembered when
// the sign-in modal opens and re-dispatched once a real session arrives, so
// the tap that hit the gate completes instead of dying in a toast. In-memory
// only by design: native OAuth keeps the webview alive and email sign-in
// never leaves the page; a web OAuth redirect loses the whole shell state
// anyway, so there is nothing meaningful to resume there.
type PendingAuthAction =
    | { type: 'wishlist'; card: Card }
    | { type: 'vault'; card: Card; collectionId?: string }
    | { type: 'checkout'; items: CartItem[] }
    | { type: 'buyNow'; listing?: MarketplaceListing };

// A purchase tap that hit the shipping-profile gate. The CheckoutAddressSheet
// collects the missing address/phone inline and this records which entry point
// to re-dispatch on save, so the purchase resumes instead of dead-ending in
// the Profile tab. buyNow carries the resolved listing so the resume works
// even after the ListingDetails modal behind the sheet is gone.
type AddressGateResume =
    | { type: 'checkout' }
    | { type: 'buyNow'; listing: MarketplaceListing }
    | { type: 'payOffer'; offer: Offer };

// Layout effect that is safe to reference from SSR'd client components —
// effects never run on the server, this alias only silences the
// "useLayoutEffect does nothing on the server" warning.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// The shell fully remounts when the user comes back from the standalone
// routes (/premium, /grade, /trade, /insights, Stripe redirects). Auth then
// re-resolves asynchronously, which used to paint the signed-out "Join
// CardStreet" profile for a few frames before the session came back. This
// snapshot lets the remount paint signed-in immediately; onAuthStateChange
// stays the source of truth and clears it when the session is really gone.
// Guests are in-memory only and intentionally not snapshotted.
function readUserSnapshot(): UserProfile | null {
    try {
        const raw = sessionStorage.getItem(USER_SNAPSHOT_STORAGE_KEY);
        if (!raw) return null;
        const u = JSON.parse(raw);
        if (!u || typeof u.id !== 'string' || u.provider === 'guest') return null;
        return u as UserProfile;
    } catch {
        return null;
    }
}

export default function HomePage() {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'marketplace' | 'add' | 'vault' | 'profile' | 'partner' | 'seller_profile'>('marketplace');

    // Deep-link handling for Stripe Connect onboarding redirects.
    // Stripe returns the user to /?stripe_connect=complete (or =refresh) and
    // the Profile component handles the rest — but the user needs to actually
    // be on the Profile tab for that to mount. Switch them there on arrival.
    //
    // Ref-guarded: StrictMode re-runs this effect after the ?tab= branch has
    // already stripped the URL, and the second pass would fall into the
    // sessionStorage-restore branch (whose value is still stale in the same
    // cycle) and undo the landing choice.
    //
    // Before paint, not after: a passive effect let the marketplace default
    // paint for a frame before the tab switch landed.
    const landingHandledRef = useRef(false);
    useBeforePaint(() => {
        if (typeof window === 'undefined') return;
        if (landingHandledRef.current) return;
        landingHandledRef.current = true;
        const params = new URLSearchParams(window.location.search);
        const cn = params.get('stripe_connect');
        if (cn === 'complete' || cn === 'refresh') {
            setActiveTab('profile');
            return;
        }

        // /?view=offers lands in the profile's Offers panel — the offer-email
        // CTA deep-links here. Flag it for Profile (which opens the panel on
        // mount, like cs_open_payouts) and strip the param so a refresh doesn't
        // re-apply it.
        if (params.get('view') === 'offers') {
            try { sessionStorage.setItem('cs_open_offers', '1'); } catch { /* opens Profile root instead */ }
            setActiveTab('profile');
            params.delete('view');
            const rest = params.toString();
            window.history.replaceState(
                null,
                '',
                `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
            );
            return;
        }

        // /?tab=<name> lands on an explicit tab — the Pro hub's back button
        // returns via /?tab=profile. Strip the param (keeping everything
        // else) so a refresh doesn't re-apply it.
        const tab = params.get('tab');
        if (isLandingTab(tab)) {
            setActiveTab(tab);
            params.delete('tab');
            const rest = params.toString();
            window.history.replaceState(
                null,
                '',
                `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
            );
            return;
        }

        // Re-mounting within the same session (back from /premium, /grade,
        // /trade, /insights, OAuth round-trips) would otherwise reset to the
        // marketplace default — restore the tab the user was on.
        try {
            const saved = sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
            if (isLandingTab(saved)) setActiveTab(saved);
        } catch { /* storage unavailable (private mode) */ }
    }, []);

    // Remember the current tab so navigations away from the shell (Pro pages,
    // Stripe redirects) come back to it instead of the marketplace default.
    useEffect(() => {
        if (!isLandingTab(activeTab)) return;
        try { sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab); } catch { /* storage unavailable */ }
    }, [activeTab]);
    const [marketGameFilter, setMarketGameFilter] = useState('all');
    const [selectedCard, setSelectedCard] = useState<Card | null>(null);

    // Meta ViewContent: fires once whenever a card detail opens, regardless of
    // which path set selectedCard (marketplace tap, scan match, deep link, etc.).
    useEffect(() => {
        if (selectedCard) {
            trackMetaEvent('ViewContent', {
                content_ids: [selectedCard.id].filter(Boolean),
                content_type: 'product',
            });
        }
    }, [selectedCard]);
    const [selectedListing, setSelectedListing] = useState<any | null>(null);
    // OBO: listing whose "Make an offer" modal is open (from a grid tile). Null
    // when closed. Distinct from selectedListing so the offer modal can open
    // without also opening the full ListingDetails view.
    const [offerListing, setOfferListing] = useState<MarketplaceListing | null>(null);
    const [viewingSeller, setViewingSeller] = useState<UserProfile | null>(null);
    const [viewingSellerReviews, setViewingSellerReviews] = useState<Review[]>([]);
    const [viewingSellerListings, setViewingSellerListings] = useState<MarketplaceListing[]>([]);
    const [scanCandidates, setScanCandidates] = useState<Card[]>([]);
    // Last scan's server event id + the candidate ids it returned. Confirm/reject
    // feedback (candidate pick, add-to-vault, bail to search) references this so the
    // learned-phash index only ever ingests user-verified matches.
    const lastScanRef = useRef<{ scanId: string; cardIds: string[]; at: number } | null>(null);

    // Load a seller's reviews and shop listings when their profile is opened.
    useEffect(() => {
        const sellerId = viewingSeller?.id;
        if (!sellerId || sellerId === 'mock-id') {
            setViewingSellerReviews([]);
            setViewingSellerListings([]);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/reviews?seller_id=${encodeURIComponent(sellerId)}`, { credentials: 'include' });
                const data = await res.json().catch(() => ({}));
                if (!cancelled) setViewingSellerReviews(res.ok ? (data.reviews || []) : []);
            } catch {
                if (!cancelled) setViewingSellerReviews([]);
            }
        })();
        (async () => {
            const listings = await marketplaceService.getSellerListings(sellerId);
            if (!cancelled) setViewingSellerListings(listings);
        })();
        // The seller object built from listing joins carries no bio; fetch it
        // separately and fail soft so the About tab just shows the default.
        (async () => {
            try {
                const supabase = createClient();
                // Cross-user read → public_profiles view (base table is locked to
                // own-row SELECT). bio is a public column exposed by the view.
                const { data } = await supabase.from('public_profiles').select('bio').eq('id', sellerId).maybeSingle();
                if (!cancelled && data?.bio) {
                    setViewingSeller(prev => (prev && prev.id === sellerId) ? { ...prev, bio: data.bio } : prev);
                }
            } catch { /* column may not exist yet; default bio is fine */ }
        })();
        return () => { cancelled = true; };
    }, [viewingSeller?.id]);
    const [user, setUser] = useState<UserProfile | null>(null);

    // Re-hydrate the last known signed-in user before first paint so a shell
    // remount doesn't flash the signed-out profile (see readUserSnapshot).
    useBeforePaint(() => {
        const snapshot = readUserSnapshot();
        if (snapshot) setUser(prev => prev ?? snapshot);
    }, []);

    // Keep the snapshot in step with auth: written on sign-in / profile
    // hydration, removed on sign-out (also when INITIAL_SESSION reports the
    // restored snapshot's session expired).
    useEffect(() => {
        try {
            if (user && user.provider !== 'guest') {
                sessionStorage.setItem(USER_SNAPSHOT_STORAGE_KEY, JSON.stringify({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    avatar: user.avatar,
                    provider: user.provider,
                    isPartner: user.isPartner,
                }));
            } else if (!user) {
                sessionStorage.removeItem(USER_SNAPSHOT_STORAGE_KEY);
            }
        } catch { /* storage unavailable (private mode) */ }
    }, [user]);
    // Provisioned partner accounts must finish setup (real email/phone/password)
    // on first login before they can use the app.
    const [partnerSetup, setPartnerSetup] = useState<{ shopName: string } | null>(null);

    // Stalled payout-onboarding nudge: a seller who created a Stripe connected
    // account but never finished the hosted form gets a slim banner steering
    // them back to the payouts panel. Reads the cached DB flags via
    // /api/stripe/connect/status (no Stripe round-trip). Re-checked whenever
    // the user leaves the profile tab, so completing setup clears it without
    // a reload. Session-dismissible.
    const [payoutSetupStalled, setPayoutSetupStalled] = useState(false);
    // Fetch once per login, plus every time the user navigates AWAY from the
    // profile tab (where payout setup lives) so completing setup clears the
    // banner without a reload — not on every tab switch.
    const payoutCheckedForRef = useRef<string | null>(null);
    const prevTabForPayoutRef = useRef(activeTab);
    useEffect(() => {
        const leftProfile = prevTabForPayoutRef.current === 'profile' && activeTab !== 'profile';
        prevTabForPayoutRef.current = activeTab;
        if (!user || user.provider === 'guest') {
            payoutCheckedForRef.current = null;
            setPayoutSetupStalled(false);
            return;
        }
        if (activeTab === 'profile') return; // hidden there; re-check on leave
        if (payoutCheckedForRef.current === user.id && !leftProfile) return;
        try {
            if (sessionStorage.getItem('cs_payout_nudge_dismissed') === '1') return;
        } catch { /* storage unavailable (private mode) */ }
        payoutCheckedForRef.current = user.id;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/stripe/connect/status');
                if (!res.ok) return; // banner is best-effort — fail quiet
                const s = await res.json();
                if (!cancelled) {
                    setPayoutSetupStalled(
                        !!s.connected && s.detailsSubmitted !== true && s.chargesEnabled !== true
                    );
                }
            } catch { /* fail quiet */ }
        })();
        return () => { cancelled = true; };
    }, [user, activeTab]);

    const openPayoutSetup = () => {
        // Profile reads this flag on mount and lands on the payouts panel.
        try { sessionStorage.setItem('cs_open_payouts', '1'); } catch { /* opens Profile root instead */ }
        setActiveTab('profile');
    };

    const dismissPayoutNudge = () => {
        setPayoutSetupStalled(false);
        try { sessionStorage.setItem('cs_payout_nudge_dismissed', '1'); } catch { /* re-shows next session */ }
    };

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

    // Cart State — persisted to localStorage under a USER-SCOPED key so two
    // accounts on the same device never see each other's items. The cart is
    // hydrated by an effect once the auth listener resolves the current user
    // (the previous global `cardstreet-cart` key leaked between accounts).
    const [cart, setCart] = useState<CartItem[]>([]);
    // Tracks which user the in-memory cart belongs to. Used by the persist
    // effect to guarantee writes only go to the active user's key, even if
    // cart and user.id change in the same render cycle.
    const cartOwnerRef = useRef<string | null>(null);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    // OBO: when a buyer pays an accepted offer, this holds the offer id so the
    // PaymentModal forwards it to /api/orders/checkout (server reads the
    // discounted price from the offer authoritatively). Null for normal buys.
    const [acceptedOfferId, setAcceptedOfferId] = useState<string | null>(null);
    // Purchases are Thailand-only for now (shipping isn't configured elsewhere).
    // Warm the geo lookup on mount so the checkout gate is instant; the popup
    // below explains the restriction when a non-TH buyer tries to check out.
    usePurchaseRegion();
    const [isRegionBlockOpen, setIsRegionBlockOpen] = useState(false);
    // In-checkout shipping-details gate (see AddressGateResume above).
    const [addressGate, setAddressGate] = useState<{
        initial: CheckoutAddressValues;
        resume: AddressGateResume;
    } | null>(null);

    // Buylist State
    const [buylistCard, setBuylistCard] = useState<Card | null>(null);

    // Search Request State (Object with timestamp to force updates even for same query)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [searchRequest, setSearchRequest] = useState<{ term: string, timestamp: number } | null>(null);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isWebScannerOpen, setIsWebScannerOpen] = useState(false);

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
                        const { StatusBar } = await import('@capacitor/status-bar');
                        await StatusBar.setOverlaysWebView({ overlay: true });
                        // Icon style is set by the theme-sync effect below.
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

    // Status bar icons follow the app theme: light icons over the dark UI,
    // dark icons over the light UI. Native shell only; no-op on web.
    useEffect(() => {
        const syncStatusBarStyle = async () => {
            try {
                const { Capacitor } = await import('@capacitor/core');
                if (!Capacitor.isNativePlatform()) return;
                const { StatusBar, Style } = await import('@capacitor/status-bar');
                await StatusBar.setStyle({ style: settings.theme === 'light' ? Style.Light : Style.Dark });
            } catch {
                // StatusBar plugin not available
            }
        };
        syncStatusBarStyle();
    }, [settings.theme]);

    // Supabase Auth and Persistence
    useEffect(() => {
        const supabase = createClient();

        // Partner referral: stash any ?ref=<slug> before auth resolves, so a
        // signup this session can be attributed even if the cs_ref cookie
        // from /join/<slug> didn't survive.
        captureReferralParam();

        // Android native shell only: report the Play install referrer once so
        // the referring partner gets download credit (iOS earns it at QR-scan
        // time in /join). No-op everywhere else.
        //
        // The report seeds the attribution slug into localStorage, but it can
        // resolve AFTER the session-restore below has already run attribution
        // slug-less (the install->signup race). So once it hands back a slug,
        // re-attempt attribution for whoever is signed in now — closing the
        // Android install->signup stitch within the same session instead of
        // leaving it to a later cold open that may fall outside the window.
        void (async () => {
            const seededSlug = await maybeReportInstallReferrer();
            if (!seededSlug) return;
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) void maybeAttributeReferral(session.user.id);
        })();

        // Applies a live session to user state. Keeps the flags hydrated
        // outside this effect (isPartner via /api/profile, or the pre-paint
        // snapshot restore) when the same user is being refreshed — a token
        // refresh must not visibly drop the partner menu until the next
        // profile fetch.
        const applySessionUser = (sessionUser: SupabaseAuthUser) => {
            Sentry.setUser({ id: sessionUser.id, email: sessionUser.email });
            void maybeAttributeReferral(sessionUser.id);
            setUser(prev => ({
                id: sessionUser.id,
                name: sessionUser.user_metadata.full_name || sessionUser.email?.split('@')[0] || 'User',
                email: sessionUser.email || '',
                avatar: sessionUser.user_metadata.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + sessionUser.id,
                provider: sessionUser.app_metadata.provider as any || 'email',
                ...(prev && prev.id === sessionUser.id
                    ? { isPartner: prev.isPartner, partnerStats: prev.partnerStats }
                    : {}),
            }));
        };

        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) applySessionUser(session.user);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                applySessionUser(session.user);
            } else {
                Sentry.setUser(null);
                setUser(null);
                // The cart-load effect (keyed on user?.id) handles resetting
                // the in-memory cart to [] when the user becomes null. We do
                // NOT remove `cardstreet-cart-${prevUserId}` here — we keep
                // each user's cart so they get it back on next sign-in.
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    // Hydrate partner status from the profile. Partner status is keyed off
    // partner_joined_at (independent of `role`, so an admin can also be a
    // partner); `role === 'partner'` is kept for legacy partner rows.
    useEffect(() => {
        if (!user?.id || user.id === 'guest') return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/profile');
                if (!res.ok) return;
                const { profile } = await res.json();
                const isPartner = profile?.role === 'partner' || !!profile?.partner_joined_at;
                if (cancelled || !isPartner) return;
                setUser(prev => (prev && !prev.isPartner ? { ...prev, isPartner: true } : prev));
                // Provisioned partners (created by an admin with a temp password)
                // must complete setup before using the app.
                if (profile?.partner_joined_at && profile?.partner_onboarding_complete === false) {
                    setPartnerSetup({ shopName: profile.display_name || 'Partner' });
                }
            } catch {
                // Non-fatal: partner dashboard simply stays gated if the fetch fails.
            }
        })();
        return () => { cancelled = true; };
    }, [user?.id]);

    // ONE-TIME OFFLINE DATA MIGRATION (CAPICATOR -> SUPABASE)
    useEffect(() => {
        if (!user) return;
        const hasMigrated = localStorage.getItem(`cardstreet-migrated-${user.id}`);
        if (hasMigrated === 'true') return;

        const migrateOfflineData = async () => {
            let migratedAnything = false;
            const supabase = createClient();
            console.log('[Migration] Checking for stranded Capacitor data...');

            try {
                // 1. Migrate Wishlist
                const wlKeys = ['cardstreet-wishlist', 'wishlist'];
                for (const key of wlKeys) {
                    const data = localStorage.getItem(key);
                    if (data) {
                        const parsed = JSON.parse(data);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            const inserts = parsed.map((c: any) => ({
                                user_id: user.id,
                                card_id: c.id || c,
                                added_at: new Date().toISOString()
                            }));
                            const { error } = await supabase.from('wishlists').upsert(inserts, { onConflict: 'user_id,card_id' });
                            if (!error) {
                                console.log(`[Migration] Rescued ${parsed.length} wishlist items.`);
                                migratedAnything = true;
                            }
                        }
                    }
                }

                // 2. Migrate Collections (Vault)
                const colKeys = ['cardstreet-collections', 'cardstreet-collection', 'collections', 'vault'];
                for (const key of colKeys) {
                    const data = localStorage.getItem(key);
                    if (data) {
                        const parsed = JSON.parse(data);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            // Extract all items from all custom collections
                            const allItems: any[] = [];
                            parsed.forEach(col => {
                                if (col.items && Array.isArray(col.items)) {
                                    col.items.forEach((item: any) => {
                                        allItems.push({
                                            user_id: user.id,
                                            card_id: item.cardId || item.id,
                                            collection_name: col.name || 'default',
                                            condition: item.condition || 'NM',
                                            purchase_price: item.purchasePrice || 0,
                                            quantity: item.quantity || 1,
                                            added_at: new Date().toISOString()
                                        });
                                    });
                                }
                            });
                            
                            if (allItems.length > 0) {
                                const { error } = await supabase.from('collections').upsert(allItems, { onConflict: 'user_id,card_id,collection_name' });
                                if (!error) {
                                    console.log(`[Migration] Rescued ${allItems.length} collection items.`);
                                    migratedAnything = true;
                                }
                            }
                        }
                    }
                }

                // Mark flag
                localStorage.setItem(`cardstreet-migrated-${user.id}`, 'true');
                if (migratedAnything) {
                    setTimeout(() => {
                        window.location.reload(); // Force full reload to pull cloud data into view
                    }, 500);
                }
            } catch (e) {
                console.error('[Migration] Critical failure rescuing offline data:', e);
            }
        };

        migrateOfflineData();
    }, [user]);

    // Hydrate the cart from localStorage whenever the active user changes.
    // Empty cart for signed-out state; user-scoped key for signed-in users.
    // Also drops the legacy global `cardstreet-cart` key (one-time cleanup)
    // so it can't be re-hydrated by stale code paths.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const userId = user?.id ?? null;
        if (cartOwnerRef.current === userId) return; // already loaded for this user

        // Legacy cleanup — the un-scoped key is the source of the cross-account leak.
        localStorage.removeItem('cardstreet-cart');

        cartOwnerRef.current = userId;
        if (!userId) {
            setCart([]);
            return;
        }
        const saved = localStorage.getItem(`cardstreet-cart-${userId}`);
        try {
            setCart(saved ? JSON.parse(saved) : []);
        } catch {
            setCart([]);
        }
    }, [user?.id]);

    // Persist cart to the active user's scoped key. Guarded by cartOwnerRef
    // so a stale cart from user A can't be written to user B's key during
    // the brief window where the user change has fired but the load effect
    // hasn't yet reset cart state.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const userId = cartOwnerRef.current;
        if (!userId) return; // no write while signed out
        const key = `cardstreet-cart-${userId}`;
        if (cart.length > 0) {
            localStorage.setItem(key, JSON.stringify(cart));
        } else {
            localStorage.removeItem(key);
        }
    }, [cart]);

    // Currency Converter
    const exchangeRate = EXCHANGE_RATES[currency] || 1;
    // Proper symbol ($, €, ...) — the raw code ("USD") read like part of the amount.
    const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

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

    // Auth gate: a signed-out (or guest — guests have no server session, so
    // every DB write would fail anyway) user tapping a gated action gets the
    // sign-in modal right here, with the attempted action remembered so it
    // resumes after sign-in. Replaces the old toast + jump to the Profile
    // tab, which lost the user's context and buried the sign-in CTA.
    const [authGateMessage, setAuthGateMessage] = useState<string | null>(null);
    const pendingAuthActionRef = useRef<(PendingAuthAction & { at: number }) | null>(null);
    const requireAuth = (message: string, pending?: PendingAuthAction): boolean => {
        if (!user || user.provider === 'guest') {
            pendingAuthActionRef.current = pending ? { ...pending, at: Date.now() } : null;
            setAuthGateMessage(message);
            return false;
        }
        return true;
    };

    const handleToggleWishlist = async (card: Card) => {
        if (!requireAuth(t('authGate.wishlist') || 'Sign in to manage your wishlist', { type: 'wishlist', card })) return;

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
        if (!requireAuth(t('authGate.vault') || 'Sign in to save cards to your vault', { type: 'vault', card, collectionId })) return;

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
                condition: card.isSealed ? CardCondition.Sealed : CardCondition.NM,
                purchasePrice: card.marketPrice
            });

            // Vaulting a just-scanned card is the strongest "the scan was right"
            // signal — feed it to the learned-phash index.
            const lastScan = lastScanRef.current;
            if (lastScan && Date.now() - lastScan.at < 10 * 60_000 && lastScan.cardIds.includes(card.id)) {
                sendScanFeedback(lastScan.scanId, 'confirmed', card.id);
                lastScanRef.current = null;
            }

            // Auto-remove from wishlist if present
            if (isInWishlist(card.id)) {
                await removeFromWishlist(card.id);
            }

            // Keep the user on the Explore set they were browsing — jumping to
            // the vault interrupts a "add several cards from this set" flow.
            // Scan/search flows still jump to vault since those land on a single
            // card and the user typically wants to confirm it landed.
            if (activeTab !== 'explore') {
                setActiveTab('vault');
            }
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
        // Meta AddToCart (value in the user's display currency, matching the
        // PaymentModal/Purchase convention).
        trackMetaEvent('AddToCart', {
            value: item.price * (currency === 'THB' ? 1 : exchangeRate),
            currency,
            content_ids: [item.cardId || item.id].filter(Boolean),
            content_type: 'product',
        });
    };

    const handleRemoveFromCart = (id: string) => {
        setCart(prev => prev.filter(item => item.id !== id));
    };

    // Geo gate shared by every purchase entry point (cart checkout + Buy Now).
    // Purchases are limited to Thailand for now, so a buyer outside TH gets a
    // clear "coming soon to your country" popup instead of the payment modal.
    // The server re-enforces this in /api/orders/checkout; failures fall open
    // (the server has the final say). Returns true when purchasing may proceed.
    const ensureCanPurchase = async (): Promise<boolean> => {
        const region = await ensurePurchaseRegion();
        if (!region.purchaseAllowed) {
            setIsCartOpen(false);
            setSelectedListing(null);
            setIsRegionBlockOpen(true);
            return false;
        }
        return true;
    };

    // Client-side mirror of the /api/orders/checkout buyer-profile gate: the
    // buyer needs a complete shipping address AND a valid phone before we open
    // the payment modal, so they hit a clean "fill your details" UX instead of
    // failing halfway through checkout. Shared by all purchase entry points
    // (cart Checkout + Buy Now + pay-an-offer). With a `resume` payload the
    // missing details are collected inline in CheckoutAddressSheet and the
    // purchase re-dispatches on save; without one it falls back to the old
    // bounce into the Profile tab. The server-side gate stays authoritative;
    // this fails open (returns true) if the pre-check errors so a lookup hiccup
    // never blocks a legitimate buyer. Assumes the caller already required auth.
    const ensureBuyerProfileComplete = async (resume?: AddressGateResume): Promise<boolean> => {
        if (!user) return false;
        try {
            const supabase = createClient();
            const { data: profile } = await supabase
                .from('profiles')
                .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
                .eq('id', user.id)
                .single<Record<string, string | null>>();
            const completeness = checkBuyerProfileComplete(profile);
            // Phone must be present AND a valid TH number — Flash can't deliver
            // to a junk value that clears the non-empty completeness check.
            if (!completeness.complete || !isValidThaiPhone(profile?.phone_number)) {
                if (resume) {
                    setIsCartOpen(false);
                    setAddressGate({
                        // Prefill whatever the buyer already saved (a junk
                        // phone prefills too, so they see what to fix).
                        initial: {
                            ...EMPTY_CHECKOUT_ADDRESS,
                            ...Object.fromEntries(
                                BUYER_REQUIRED_PROFILE_FIELDS.map((f) => [f, profile?.[f] ?? '']),
                            ),
                        },
                        resume,
                    });
                } else {
                    showToast(t('profile.incompleteBuyer'), 'error');
                    setIsCartOpen(false);
                    setSelectedListing(null);
                    setActiveTab('profile');
                }
                return false;
            }
            return true;
        } catch (err) {
            console.warn('[Checkout] Buyer profile pre-check failed:', err);
            return true;
        }
    };

    const handleCheckout = async () => {
        if (!(await ensureCanPurchase())) return;

        // Buyers must be authenticated — the /api/orders/checkout route requires
        // a real buyer profile id, and the modal would otherwise fail server-side
        // with a generic "missing required fields" message that's hard to debug.
        // The cart items ride along on the pending action because the per-user
        // cart hydration wipes the in-memory signed-out cart at sign-in.
        if (!requireAuth(t('authGate.purchase') || 'Sign in to complete your purchase', { type: 'checkout', items: cart })) return;

        if (!(await ensureBuyerProfileComplete({ type: 'checkout' }))) return;

        setIsCartOpen(false);
        // Meta InitiateCheckout — fired only once the buyer clears the geo/auth/
        // profile gates and the payment modal actually opens.
        trackMetaEvent('InitiateCheckout', {
            value: cart.reduce((s, i) => s + i.price, 0) * (currency === 'THB' ? 1 : exchangeRate),
            currency,
            content_ids: cart.map(i => i.cardId || i.id).filter(Boolean),
            content_type: 'product',
            num_items: cart.length,
        });
        setIsPaymentModalOpen(true);
    };

    // OBO pay-an-accepted-offer. Reuses the exact Buy-Now payment machinery:
    // the same Thailand-only geo gate, a single-item cart for the offer's
    // listing, and the shared PaymentModal — the only difference is that
    // acceptedOfferId is set, so PaymentModal forwards it to
    // /api/orders/checkout, which reads the discounted price from the offer
    // server-side (we never send the offer price from the client).
    const handlePayOffer = async ({ offer }: { offer: Offer }) => {
        if (offer.status !== 'accepted' || offer.viewerRole !== 'buyer') return;
        const listingCard = offer.listing?.card_data;
        if (!listingCard) {
            showToast(t('offer.payUnavailable') || 'This listing is no longer available.', 'error');
            return;
        }
        if (!(await ensureCanPurchase())) return;
        if (!requireAuth(t('authGate.purchase') || 'Sign in to complete your purchase')) return;
        if (!(await ensureBuyerProfileComplete({ type: 'payOffer', offer }))) return;

        setCart([{
            id: offer.listing_id,
            cardId: listingCard.id,
            card: listingCard,
            // Display price only; the server charges offer.amount authoritatively.
            price: offer.amount,
            sellerId: offer.seller_id,
            sellerName: '',
            condition: (listingCard as any).condition || '',
        }]);
        setAcceptedOfferId(offer.id);
        setIsPaymentModalOpen(true);
    };

    // Buy Now skips the cart and opens the payment modal directly, so it runs
    // the same geo, auth, and buyer-profile (address + phone) gates as cart
    // checkout itself. Callable two ways: from a ListingDetails "Buy Now" (no
    // arg — reads selectedListing so the post-sign-in resume can re-invoke it
    // while the listing modal is still open behind the auth gate), or from a
    // marketplace grid tile (listing passed in, so it survives the auth resume
    // even though no ListingDetails modal is open).
    const handleBuyNow = async (listingArg?: MarketplaceListing) => {
        const listing = listingArg ?? selectedListing;
        if (!listing) return;
        if (!(await ensureCanPurchase())) return;
        if (!requireAuth(t('authGate.purchase') || 'Sign in to complete your purchase', { type: 'buyNow', listing: listingArg })) return;
        if (!(await ensureBuyerProfileComplete({ type: 'buyNow', listing }))) return;
        setCart([{
            id: listing.id,
            cardId: listing.card_id,
            card: listing.card_data,
            price: listing.price, // Store base price for now
            sellerId: listing.seller_id,
            sellerName: listing.seller?.display_name || 'Unknown',
            condition: listing.condition
        }]);
        setSelectedListing(null);
        setIsPaymentModalOpen(true);
    };

    // Shipping details saved from the in-checkout sheet — re-dispatch the
    // purchase that hit the gate. The handler re-runs every gate from the top
    // (geo, auth, profile — the profile one now passes) and opens the payment
    // modal with a fresh shipping estimate against the just-saved address.
    const handleAddressGateSaved = () => {
        const gate = addressGate;
        setAddressGate(null);
        if (!gate) return;
        if (gate.resume.type === 'checkout') {
            void handleCheckout();
        } else if (gate.resume.type === 'buyNow') {
            void handleBuyNow(gate.resume.listing);
        } else {
            void handlePayOffer({ offer: gate.resume.offer });
        }
    };

    // OBO "Make an offer" from a marketplace grid tile: open the offer modal for
    // the tapped listing. The grid only surfaces this button to a signed-in
    // buyer who isn't the seller, but guard auth anyway (a guest session slips
    // through the id check). The OfferModal POSTs to /api/offers, which is the
    // server-side authority on the min-floor / anti-abuse rules.
    const handleMakeOfferListing = (listing: MarketplaceListing) => {
        if (!requireAuth(t('authGate.offer') || 'Sign in to make an offer')) return;
        setOfferListing(listing);
    };

    // Resume the action that opened the auth gate once a real session lands.
    // Vault adds additionally wait for the post-sign-in collections load —
    // dispatching into a still-empty collections list would create a duplicate
    // "Main Vault" next to the one the signup trigger just made. The 10-minute
    // cap discards stale intents so a much-later organic sign-in can't replay
    // a forgotten tap.
    useEffect(() => {
        const pending = pendingAuthActionRef.current;
        if (!pending || !user || user.provider === 'guest') return;
        if (Date.now() - pending.at > 10 * 60_000) {
            pendingAuthActionRef.current = null;
            return;
        }
        if (pending.type === 'vault' && (collectionsLoading || customCollections.length === 0)) return;
        pendingAuthActionRef.current = null;
        setAuthGateMessage(null);
        if (pending.type === 'wishlist') {
            void handleToggleWishlist(pending.card);
        } else if (pending.type === 'vault') {
            void handleAddToCollection(pending.card, pending.collectionId);
        } else if (pending.type === 'checkout') {
            // The signed-out cart lived only in memory and the per-user cart
            // hydration effect just replaced it — merge the items back in
            // before re-running the checkout gates.
            setCart(prev => {
                const merged = [...prev];
                for (const item of pending.items) {
                    if (!merged.some(i => i.id === item.id)) merged.push(item);
                }
                return merged;
            });
            void handleCheckout();
        } else if (pending.type === 'buyNow') {
            void handleBuyNow(pending.listing);
        }
        // Handlers are re-created every render and the pending ref is one-shot,
        // so only the wake-up-relevant deps are listed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, collectionsLoading, customCollections]);

    // Open an offer's underlying card in the shared CardDetails overlay. It's a
    // sibling of <main> (z-50) while the Offers panel lives inside <main>'s own
    // stacking context, so the card paints on top and closing it (tap X or the
    // hardware back button) drops the user right back on the Offers list — no
    // panel teardown/rebuild needed. normalizeCard hardens the stored snapshot
    // (and backfills the id from card_id) so the detail view can't crash on a
    // sparse row.
    const handleViewOfferListing = (offer: Offer) => {
        const snapshot = offer.listing?.card_data;
        if (!snapshot) {
            showToast(t('offer.payUnavailable') || 'This listing is no longer available.', 'error');
            return;
        }
        setSelectedCard(normalizeCard(snapshot, offer.listing?.card_id));
    };

    // Post-payment cleanup. The order creation + Stripe charge already happened
    // inside PaymentModal; this just resets UI state and refreshes local data.
    // (Earlier versions of this handler re-POSTed to /api/orders/checkout — that
    // was leftover from before the modal owned that step, and would have
    // created duplicate orders on top of the ones the modal already inserted.)
    const handlePaymentSuccess = async (_details: {
        paymentMethod: string;
        paymentId: string;
        transferGroup?: string;
    }) => {
        if (!user) return;

        setIsPaymentModalOpen(false);
        setCart([]);
        setAcceptedOfferId(null);

        // Refresh local state aggressively to hide sold items and show new vault items
        fetchGlobalListings();
        refreshCollections();

        showToast(`Payment Successful! Thank you for your purchase.`, 'success');
    };

    const handleScanCard = async () => {
        setIsWebScannerOpen(true);
    };

    // Fall back to manual marketplace search when the scan flow can't resolve a
    // single card. Pre-fills the search bar with whatever hint we do have.
    const redirectScanToSearch = (term: string, toastMessage: string) => {
        showToast(toastMessage, 'error');
        setActiveTab('marketplace');
        setSearchRequest({ term, timestamp: Date.now() });
    };

    const handleWebLiveScanMatch = async (scanData: any) => {
        setIsWebScannerOpen(false);
        setIsAiLoading(true);
        try {
            console.log('[Scan] Received match from WebLiveScanner:', scanData);

            if (scanData?.scanId) {
                lastScanRef.current = {
                    scanId: scanData.scanId,
                    cardIds: Array.isArray(scanData?.matches) ? scanData.matches.map((c: Card) => c.id) : [],
                    at: Date.now(),
                };
            }

            // Fast path: the server already resolved pHash matches to full Card[].
            // Skip the metadata search entirely when we have direct hits.
            if (Array.isArray(scanData?.matches) && scanData.matches.length > 0) {
                console.log(`[Scan] pHash path: ${scanData.matches.length} candidates (top distance ${scanData.matchDistance})`);
                const phashMatches: Card[] = scanData.matches;
                if (phashMatches.length === 1 || (scanData.matchDistance ?? 99) <= 4) {
                    setSelectedCard(phashMatches[0]);
                } else {
                    setScanCandidates(phashMatches);
                }
                return;
            }

            if (!scanData || !scanData.primary?.name) {
                sendScanFeedback(scanData?.scanId, 'rejected');
                redirectScanToSearch('', "Couldn't identify the card. Search for it manually instead.");
                return;
            }

            // Step 2: Search database for matches
            // Use setHint (Set Code) if available as it's more accurate than Set Name
            const setIdentifier = scanData.primary.setHint || scanData.primary.set;
            const detectedLanguage = scanData.primary.language;
            // Detected game scopes the fallback DB search to the right catalog slice.
            // Defaults to 'pokemon' so behaviour is unchanged when the game is unknown.
            const detectedGame = scanData.primary.game || 'pokemon';

            console.log(`[Scan] Searching DB for: ${scanData.primary.name} / ${setIdentifier} / #${scanData.primary.number} (game: ${detectedGame})`);
            if (detectedLanguage) console.log(`[Scan] Detected Language: ${detectedLanguage}`);

            let matches = await pokemonService.findCardByMetadata(
                scanData.primary.name,
                setIdentifier,
                scanData.primary.number,
                detectedLanguage,
                detectedGame
            );
            console.log(`[Scan] Metadata search returned ${matches.length} matches`);

            // Step 3: If no exact matches, try a broader name-only search
            if (matches.length === 0) {
                console.log('[Scan] No metadata match, trying name-only search...');
                matches = await pokemonService.searchCards(
                    scanData.primary.name,
                    false, // useAiResolution
                    detectedLanguage as 'en' | 'jp' | 'th', // Pass language hint to search
                    detectedGame // Scope to the detected game
                );
                console.log(`[Scan] Name search returned ${matches.length} matches`);
            }

            // Step 4: Handle results
            if (matches.length === 1) {
                setSelectedCard(matches[0]);
            } else if (matches.length > 1) {
                setScanCandidates(matches);
            } else {
                // AI saw a card but the DB doesn't have it — drop the user into
                // manual search with the detected name pre-filled.
                sendScanFeedback(scanData?.scanId, 'rejected');
                redirectScanToSearch(
                    scanData.primary.name,
                    `AI identified "${scanData.primary.name}" but it isn't in our database. Try refining your search.`
                );
            }
        } catch (error: any) {
            // Check for user cancellation (Capacitor camera cancel or file input cancel)
            const msg = error?.message || String(error) || '';
            if (msg.includes('cancel') || msg.includes('Cancel') || msg.includes('dismissed') || error === 'No file selected') {
                // User cancelled — silently ignore
                console.log('[Scan] User cancelled camera');
            } else {
                console.error('[Scan] Error:', error);
                redirectScanToSearch('', `Scan failed: ${msg || 'Unknown error'}. Search for the card manually instead.`);
            }
        } finally {
            setIsAiLoading(false);
        }
    };

    // Listing State (New)
    const [listingTarget, setListingTarget] = useState<{ colId: string, item: UserCollectionItem, card: Card } | null>(null);

    // Click-time gate on listing creation. We check the seller's shipping
    // fields before opening ListingForm so they don't fill out price /
    // condition / photos only to be rejected at submit. The same check is
    // mirrored in services/marketplaceService.createListing (real write
    // path) and /api/listings POST (defense in depth).
    const handleStartListing = async (colId: string, item: UserCollectionItem, card: Card) => {
        if (!requireAuth(t('authGate.list') || 'Sign in to list cards for sale')) return;
        if (!user) return; // type narrowing — requireAuth guarantees a signed-in user
        try {
            const supabase = createClient();
            const { data: profile, error } = await supabase
                .from('profiles')
                .select(SELLER_REQUIRED_PROFILE_FIELDS.join(','))
                .eq('id', user.id)
                .single<Record<string, string | boolean | null>>();
            if (error) throw error;
            const completeness = checkSellerProfileComplete(profile);
            if (!completeness.complete) {
                showToast(t('profile.incompleteSeller'), 'error');
                setActiveTab('profile');
                return;
            }
        } catch (err) {
            // Don't block listing on a transient profile-read failure —
            // marketplaceService.createListing will re-check on submit.
            console.warn('[Listing gate] Profile completeness check failed, falling through:', err);
        }
        setListingTarget({ colId, item, card });
    };

    // Global Active Listings state powered by Supabase
    const [activeListings, setActiveListings] = useState<MarketplaceListing[]>([]);

    const fetchGlobalListings = async () => {
        try {
            // Limit to 50 — used only for the Explore price overlay.
            // Marketplace manages its own server-side paginated fetch.
            const listings = await marketplaceService.getActiveListings({ limit: 50 });
            setActiveListings(listings);
        } catch (error) {
            console.error('Failed to fetch global listings:', error);
        }
    };

    // Initial fetch + Realtime subscription for live marketplace updates.
    // The realtime channel fires once per listing INSERT/UPDATE/DELETE; with
    // burst activity that's a refetch per row, which thrashes the network and
    // re-renders the whole overlay. Trailing-edge debounce coalesces a burst
    // into one refetch ~1.5s after the last event.
    useEffect(() => {
        fetchGlobalListings();

        const supabase = createClient();
        let refetchTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefetch = () => {
            if (refetchTimer) clearTimeout(refetchTimer);
            refetchTimer = setTimeout(() => {
                refetchTimer = null;
                fetchGlobalListings();
            }, 1500);
        };

        const channel = supabase
            .channel('listings-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'listings' },
                scheduleRefetch,
            )
            .subscribe();

        return () => {
            if (refetchTimer) clearTimeout(refetchTimer);
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Deep link from desktop card URLs: middleware redirects phones hitting
    // /card/<id> to /?card=<id>. Open that card's detail view, then strip the
    // param (preserving any other query params and the hash — OAuth callbacks
    // ride in the hash) so refresh doesn't re-trigger it.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const cardId = params.get('card');
        if (!cardId) return;

        params.delete('card');
        const rest = params.toString();
        window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
        );

        (async () => {
            try {
                const supabase = createClient();
                const { data } = await supabase
                    .from('pokemon_cards')
                    .select('id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, market_avg, currency, last_updated)')
                    .eq('id', cardId)
                    .maybeSingle();
                if (data) setSelectedCard(mapSupabaseCardToInternal(data));
            } catch (err) {
                // A bad/stale link should never break the app — land on the
                // marketplace as before.
                console.warn('[DeepLink] Could not open card', cardId, err);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                grade: listingData.grade,
                image_front_url: listingData.image_front_url,
                image_back_url: listingData.image_back_url,
                acceptsOffers: listingData.accepts_offers
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
            showToast(t('paymentFlow.listingPublished') || 'Listing successfully published to the market!', 'success');
        } catch (error) {
            if (error instanceof ProfileIncompleteError) {
                // Race against the click-time gate: profile became
                // incomplete between click and submit. Close the form,
                // route to Profile.
                setListingTarget(null);
                showToast(t('profile.incompleteSeller'), 'error');
                setActiveTab('profile');
                return;
            }
            console.error('Failed to publish listing:', error);
            showToast(t('paymentFlow.listingFailed') || 'Failed to publish listing. Please try again.', 'error');
        }
    };

    // Quick price edit on an active listing — updates the existing listings
    // row in place (unlike the old "Edit Listing" flow, which re-ran the full
    // form and INSERTed a duplicate listing). Rethrows on failure so the
    // Vault keeps the inline editor open.
    const handleUpdateListingPrice = async (colId: string, item: UserCollectionItem, card: Card, price: number) => {
        try {
            const updated = await marketplaceService.updateListingPriceForCard(card.id, item.condition, price);
            if (!updated) {
                // Listing sold/cancelled while editing — re-derive Vault flags
                // so the stale card drops out of Active Listings.
                await refreshCollections();
                throw new Error('Listing no longer active');
            }

            await fetchGlobalListings();
            // listingPrice is derived from the listings table; merge locally
            // so the Vault reflects the new ask without a full reload.
            await updateCollectionItem(colId, item.id, { listingPrice: price });
            showToast(t('vault.priceUpdated'), 'success');
        } catch (error) {
            console.error('Failed to update listing price:', error);
            showToast(t('vault.priceUpdateFailed'), 'error');
            throw error;
        }
    };

    // Inverse of handlePublishListing. The Vault "Live on Market" flag is
    // derived from the DB `listings` table (see useUserCollections), so the
    // real removal is cancelling that listing — flipping a local flag alone
    // would reappear on the next reload.
    const handleRemoveListing = async (colId: string, item: UserCollectionItem, card: Card) => {
        try {
            // No active listing matched (already removed/sold) still falls
            // through to the refresh below, which reconciles the stale UI.
            await marketplaceService.cancelListingForCard(card.id, item.condition);

            // Refresh global marketplace + re-derive the Vault listing flags
            // from the DB so the removed card drops out of Active Listings.
            await fetchGlobalListings();
            await refreshCollections();

            showToast(t('paymentFlow.listingRemoved') || 'Listing removed from the market.', 'success');
        } catch (error) {
            console.error('Failed to remove listing:', error);
            showToast(t('paymentFlow.listingRemoveFailed') || 'Failed to remove listing. Please try again.', 'error');
        }
    };

    // Global Back Button Handling
    // Tracks whether the Profile tab has a slide-in sub-panel open (Edit
    // Profile, Settings, Track Orders, etc.). A plain ref rather than React
    // state so updating it from Profile doesn't re-render this shell, and so
    // the back-button listener reads the current value without a stale closure.
    const profilePanelOpenRef = useRef(false);

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

                // Layer 1.5: Profile sub-panels. When a slide-in panel is open
                // (Edit Profile, Settings, Track Orders, etc.) close it instead
                // of falling through to the tab-switch fallback below, which
                // would otherwise drop the user on the Explore (card database)
                // screen. Profile listens for this event to close its panel.
                if (profilePanelOpenRef.current) {
                    window.dispatchEvent(new Event('profile-panel-back'));
                    return;
                }

                // Layer 2: Vault internal navigation. Vault owns its sub-view
                // stack (folders → collections/sets → card overlay), so offer
                // it the press as a cancelable event: it preventDefault()s
                // when it stepped back internally, and leaves the event
                // untouched at its root so the tab fallback below runs.
                // (dispatchEvent returns false when the event was canceled.)
                if (state.activeTab === 'vault') {
                    const unconsumed = window.dispatchEvent(new CustomEvent('vault-back', { cancelable: true }));
                    if (!unconsumed) return;
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

                // Email-verification App Link. Android intercepts ALL
                // cardstreet.app URLs, so the /auth/confirm link from the
                // Supabase email templates opens the app instead of a browser
                // tab. A deep-link open IS the user's click (mail scanners
                // fetch URLs but never fire Android intents), so verify
                // immediately rather than showing the web page's button.
                try {
                    const appLink = new URL(data.url);
                    if (appLink.pathname === '/auth/confirm') {
                        const tokenHash = appLink.searchParams.get('token_hash');
                        const otpType = appLink.searchParams.get('type') || 'email';
                        if (tokenHash) {
                            const supabase = createClient();
                            const { error: verifyErr } = await supabase.auth.verifyOtp({
                                type: otpType as 'email' | 'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change',
                                token_hash: tokenHash,
                            });
                            if (verifyErr) {
                                console.error('[DeepLink] Email verification failed:', verifyErr);
                                showToast('That link was already used or expired. Try signing in, or resend the email from the sign-in screen.', 'error');
                            } else if (otpType === 'recovery') {
                                window.location.href = '/reset-password';
                            } else {
                                // Session is set; onAuthStateChange updates the UI.
                                showToast('Email confirmed — you are signed in!', 'success');
                            }
                            return;
                        }
                    }
                } catch { /* not a parseable URL — fall through */ }

                // Offer-email CTA App Link (cardstreet.app/?view=offers). Android
                // intercepts all cardstreet.app URLs, so tapping the email button
                // opens the app here. A deep-link open IS the user's tap, so
                // navigate straight into the Offers panel (same flag Profile reads
                // on mount as the web /?view=offers landing).
                try {
                    const appLink = new URL(data.url);
                    if (appLink.searchParams.get('view') === 'offers') {
                        try { sessionStorage.setItem('cs_open_offers', '1'); } catch { /* opens Profile root instead */ }
                        setActiveTab('profile');
                        return;
                    }
                } catch { /* not a parseable URL — fall through */ }

                // Setup-nudge email CTA App Link (cardstreet.app/?stripe_connect=
                // refresh|complete). Android intercepts all cardstreet.app URLs,
                // so the email tap opens the app HERE — the web landing branch
                // never runs and no StripeConnectSection is mounted to hear an
                // event. Stash the resume intent for Profile (opens the payouts
                // panel) and StripeConnectSection (acts on the resume) to pick
                // up on mount, then switch tabs. https only — the cardstreet://
                // bounce from Stripe's own return flow is handled below.
                try {
                    const appLink = new URL(data.url);
                    const stripeConnect = appLink.searchParams.get('stripe_connect');
                    if (
                        appLink.protocol.startsWith('http') &&
                        (stripeConnect === 'refresh' || stripeConnect === 'complete')
                    ) {
                        try {
                            sessionStorage.setItem('cs_open_payouts', '1');
                            sessionStorage.setItem('cs_stripe_connect_resume', stripeConnect);
                        } catch { /* opens Profile root instead */ }
                        setActiveTab('profile');
                        return;
                    }
                } catch { /* not a parseable URL — fall through */ }

                // Handle native HTTP App Links and Custom Schemes
                if (data.url.includes('cardstreet://') || data.url.includes('/mobile-redirect')) {
                    // Parse URL parameters
                    // Capacitor URL might look like: cardstreet://login-callback#access_token=...&refresh_token=... (Implicit)
                    // Or if using PKCE flow with redirect: cardstreet://login-callback?code=...

                    try {
                        const url = new URL(data.url);

                        // Stripe Connect return bounce: /mobile-redirect →
                        // cardstreet://login-callback?stripe_connect=complete|refresh.
                        // No auth code involved — just notify the seller payouts
                        // panel to refresh its status (or resume an expired
                        // onboarding link). Handled before the auth parsing below.
                        const stripeConnect = url.searchParams.get('stripe_connect');
                        if (stripeConnect) {
                            console.log('[DeepLink] Stripe Connect return:', stripeConnect);
                            // Cold-start safety: if the app process died while
                            // the seller was in Stripe's browser flow, nothing
                            // is mounted to hear the event. Stash the same
                            // mount-time flags the email-CTA branch above uses;
                            // a still-mounted StripeConnectSection handles the
                            // event instead and clears the resume flag.
                            try {
                                sessionStorage.setItem('cs_open_payouts', '1');
                                sessionStorage.setItem('cs_stripe_connect_resume', stripeConnect);
                            } catch { /* event path only */ }
                            setActiveTab('profile');
                            window.dispatchEvent(
                                new CustomEvent('stripe-connect-return', { detail: stripeConnect })
                            );
                            return;
                        }

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
                                console.log('[DeepLink] Exchange Success for user:', sessionData?.user?.id);
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

            {/* Failed email-verification links land here with a #error hash
                that would otherwise be silently ignored. */}
            <AuthLinkErrorNotice />

            {/* Forced partner activation — blocks the app until a provisioned
                partner sets their real email, phone, and password. */}
            {user && partnerSetup && (
                <PartnerFinishSetup
                    shopName={partnerSetup.shopName}
                    onComplete={() => {
                        setPartnerSetup(null);
                        setUser(prev => (prev ? { ...prev, isPartner: true } : prev));
                    }}
                />
            )}

            {isWebScannerOpen && (
                <WebLiveScanner
                    onClose={() => setIsWebScannerOpen(false)}
                    onMatch={handleWebLiveScanMatch}
                    languageHint={settings.language === 'TH' ? 'th' : 'en'}
                    onScanFailed={(reason) => {
                        setIsWebScannerOpen(false);
                        const msg = reason === 'timeout'
                            ? "Scan took too long. Search for the card manually instead."
                            : reason === 'network'
                                ? "Couldn't reach the scanner. Search for the card manually instead."
                                : "Couldn't identify the card. Search for it manually instead.";
                        redirectScanToSearch('', msg);
                    }}
                />
            )}

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
                                <Image
                                    src="/logo.png"
                                    alt="CardStreet"
                                    width={54}
                                    height={54}
                                    priority
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

                    {/* Stalled Stripe onboarding: one tap back into payout setup */}
                    {payoutSetupStalled && activeTab !== 'profile' && (
                        <div className="w-full px-6 py-2.5 bg-amber-400/10 border-b border-amber-400/20 flex items-center gap-2 z-40 shrink-0">
                            <button onClick={openPayoutSetup} className="flex-1 flex items-center gap-2.5 text-left min-w-0">
                                <i className="fa-solid fa-circle-exclamation text-amber-400 text-sm shrink-0"></i>
                                <span className="text-amber-200 text-xs font-bold leading-snug">{t('profile.payoutNudgeBanner')}</span>
                                <i className="fa-solid fa-chevron-right text-amber-400/70 text-[10px] shrink-0 ml-auto"></i>
                            </button>
                            <button
                                onClick={dismissPayoutNudge}
                                aria-label={t('profile.payoutNudgeDismiss')}
                                className="p-1.5 -mr-1.5 text-amber-400/60 hover:text-amber-200 transition-colors shrink-0"
                            >
                                <i className="fa-solid fa-xmark text-sm"></i>
                            </button>
                        </div>
                    )}

                    <div className={`flex-1 w-full ${activeTab === 'marketplace' || activeTab === 'explore' ? 'overflow-hidden flex flex-col px-6 pb-24' : 'overflow-y-auto scrollbar-hide px-6 pb-40'}`}>
                        {/* Home Tab Removed - Default is Marketplace */}
                        {activeTab === 'explore' && (
                            <Explore
                                onSelectCard={setSelectedCard}
                                searchRequest={searchRequest}
                                localListings={activeListings}
                                currency={currency}
                                exchangeRate={exchangeRate}
                                onAddToCollection={handleAddToCollection}
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
                                        reviewCount: seller.review_count || 0,
                                        isPartner: !!(seller.partner_joined_at || seller.role === 'partner'),
                                        badges: seller.badges || []
                                    });
                                    setActiveTab('seller_profile');
                                }}
                                onBuyNow={handleBuyNow}
                                onMakeOffer={handleMakeOfferListing}
                                currentUserId={user && user.provider !== 'guest' ? user.id : null}
                                listings={activeListings}
                                currency={currency}
                                exchangeRate={exchangeRate}
                            />
                        )}
                        {activeTab === 'seller_profile' && viewingSeller && (
                            <SellerProfile
                                seller={viewingSeller}
                                listings={viewingSellerListings}
                                reviews={viewingSellerReviews}
                                onBack={() => setActiveTab('marketplace')}
                                onSelectListing={setSelectedListing}
                                onAddToCart={handleAddToCart}
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
                                onListCard={handleStartListing}
                                onRemoveListing={handleRemoveListing}
                                onUpdateListingPrice={handleUpdateListingPrice}
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
                                onPanelStateChange={(open) => { profilePanelOpenRef.current = open; }}
                                onNavigatePartner={() => setActiveTab('partner')}
                                onPayOffer={handlePayOffer}
                                onViewListing={handleViewOfferListing}
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
                                                totalDownloads: 324,
                                                level: 2,
                                                currentFee: 4.5,
                                                totalEarnings: 15400,
                                                referralCode: `CS-${user.name.toUpperCase().slice(0, 3)}`
                                            }
                                        });
                                    } else {
                                        requireAuth(t('authGate.partner') || 'Sign in to apply as a partner');
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

                {scanCandidates.length > 0 && <ScanCandidateModal candidates={scanCandidates} onSelect={(card) => { sendScanFeedback(lastScanRef.current?.scanId, 'confirmed', card.id); setSelectedCard(card); setScanCandidates([]); }} onCancel={() => { sendScanFeedback(lastScanRef.current?.scanId, 'rejected'); setScanCandidates([]); }} />}
                {selectedCard && (
                    <CardDetails
                        card={selectedCard}
                        isWishlisted={!!wishlist.find(c => c.id === selectedCard.id)}
                        showSignInPrompt={!user || user.provider === 'guest'}
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
                        onBuyNow={handleBuyNow}
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
                                reviewCount: seller.review_count || 0,
                                isPartner: !!(seller.partner_joined_at || seller.role === 'partner'),
                                badges: seller.badges || []
                            });
                            setSelectedListing(null); // Close modal
                            setActiveTab('seller_profile');
                        }}
                        currency={currency}
                        exchangeRate={exchangeRate}
                        currentUserId={user?.id ?? null}
                        onOfferSubmitted={() => showToast(t('offer.submitted') || 'Offer sent to the seller.', 'success')}
                    />
                )}

                {offerListing && (
                    <OfferModal
                        listingId={offerListing.id}
                        listingPrice={offerListing.price}
                        cardName={offerListing.card_data.name}
                        onClose={() => setOfferListing(null)}
                        onSubmitted={() => showToast(t('offer.submitted') || 'Offer sent to the seller.', 'success')}
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
                    exchangeRate={exchangeRate}
                />

                <AuthModal
                    isOpen={authGateMessage !== null}
                    contextMessage={authGateMessage ?? undefined}
                    onClose={() => {
                        setAuthGateMessage(null);
                        // Distinguish cancel from post-sign-in close: the email
                        // flow closes the modal itself right after signing in,
                        // before user state has updated — so only a close with
                        // no session abandons the pending action.
                        void createClient().auth.getSession().then(({ data: { session } }) => {
                            if (!session) pendingAuthActionRef.current = null;
                        });
                    }}
                />

                <PurchaseRegionModal
                    isOpen={isRegionBlockOpen}
                    onClose={() => setIsRegionBlockOpen(false)}
                />

                <CheckoutAddressSheet
                    isOpen={!!addressGate}
                    initialValues={addressGate?.initial ?? EMPTY_CHECKOUT_ADDRESS}
                    onClose={() => setAddressGate(null)}
                    onSaved={handleAddressGateSaved}
                />

                <PaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => { setIsPaymentModalOpen(false); setAcceptedOfferId(null); }}
                    amount={cart.reduce((s, i) => s + i.price, 0)}
                    currency={currency}
                    exchangeRate={exchangeRate}
                    items={cart}
                    apiEndpoint="/api/checkout"
                    extraData={{ buyerId: user?.id }}
                    acceptedOfferId={acceptedOfferId ?? undefined}
                    onPaymentSuccess={handlePaymentSuccess}
                    onPaymentFailed={(err) => showToast(`${t('paymentFlow.paymentFailed') || 'Payment failed'}: ${err}`, 'error')}
                />
            </div>
        </div>
    );
}
