'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Mail, Phone, MapPin, CreditCard, Gift, Shield, Bell,
  Package, History, HelpCircle, FileText, Lock, ChevronRight,
  ChevronLeft, Check, X, Truck, Clock, CheckCircle,
  AlertCircle, Star, Crown, Zap, LogOut, Settings, ShoppingBag,
  Wallet, Loader2, Pencil, Moon, Sun, Store, Tag
} from 'lucide-react';
import { UserProfile, Offer } from '@/types';
import AuthModal from './AuthModal';
import OffersInbox from './OffersInbox';
import SupportTickets from './SupportTickets';
import StripeConnectSection from './StripeConnectSection';
import GooglePlacesAddressInput from './GooglePlacesAddressInput';
import type { ParsedThaiAddress } from '@/lib/utils/parseGoogleAddress';
import { isValidThaiPhone } from '@/lib/utils/phone';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import { getThumbnailUrl } from '@/lib/imageUtils';

interface ProfileProps {
  user: UserProfile | null;
  onNavigatePartner?: () => void;
  onGuestLogin?: () => void;
  // Notifies the parent shell whether a slide-in sub-panel is open, so the
  // Android hardware back button can close the panel instead of falling
  // through to the tab-switch fallback. See the back handler in app/page.tsx.
  onPanelStateChange?: (open: boolean) => void;
  // OBO: opens the shell's payment modal to pay an accepted offer. The shell
  // owns the PaymentModal + acceptedOfferId plumbing, so the Offers inbox just
  // hands the accepted offer up. Undefined when the offers flag is off.
  onPayOffer?: (args: { offer: Offer }) => void;
  // OBO: opens the CardDetails overlay for an offer's listing. The overlay
  // renders above this panel (it's a sibling of <main>), so closing it drops
  // the user right back on the Offers panel. Undefined when offers are off.
  onViewListing?: (offer: Offer) => void;
}

// Slide panel animation variants
const slideVariants = {
  initial: { x: '100%', opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
  exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } }
};

const fadeVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } }
};

// Downscale a user-picked image to a square-friendly avatar (longest side
// capped at `max`) and re-encode as JPEG. Keeps avatar files tiny so they load
// fast in the header and grids — consistent with the app's thumbnail policy.
async function downscaleImage(file: File, max: number): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load image'));
    el.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.85)
  );
}

// Types for profile data
interface UserSettings {
  phone_number: string | null;
  shipping_address: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  two_factor_enabled: boolean;
  notify_price_drops: boolean;
  notify_order_updates: boolean;
  notify_marketing: boolean;
}

interface Rewards {
  points_balance: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  lifetime_points: number;
  tier_progress: number;
}

interface Order {
  id: string;
  status: 'pending' | 'paid' | 'label_generated' | 'processing' | 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'completed' | 'cancelled' | 'disputed';
  created_at: string;
  estimated_delivery: string | null;
  total_amount: number;
  listing: {
    card_data: any;
    condition: string;
  };
  // Tracking lives on shipping_labels (one-to-one with orders). The pre-Flash
  // Order shape had top-level tracking_number/carrier columns; those never
  // existed in the DB, they were always meant to come from the join.
  shipping_labels?: {
    tracking_number?: string | null;
    carrier_name?: string | null;
    label_url?: string | null;
    courier_tracking_url?: string | null;
    estimated_delivery_date?: string | null;
    status?: string | null;
  }[];
}

interface Sale {
  id: string;
  total_amount: number;
  platform_fee: number;
  // Only set once an order is completed; null for paid/shipped/etc. Fall back
  // to created_at when rendering so a null never becomes `new Date(null)` = epoch.
  completed_at: string | null;
  created_at: string;
  listing: {
    card_data: any;
    condition: string;
    price: number;
  };
}

type ActivePanel = 'none' | 'account' | 'rewards' | 'settings' | 'orders' | 'sales' | 'shipments' | 'support' | 'payouts' | 'offers';

const tierConfig = {
  bronze: { color: 'from-amber-700 to-amber-900', icon: Star, next: 'silver', pointsNeeded: 500 },
  silver: { color: 'from-slate-400 to-slate-600', icon: Crown, next: 'gold', pointsNeeded: 2000 },
  gold: { color: 'from-yellow-400 to-amber-500', icon: Crown, next: 'platinum', pointsNeeded: 5000 },
  platinum: { color: 'from-purple-400 to-indigo-600', icon: Zap, next: null, pointsNeeded: null }
};

// Shared delivery-progress view: the five-step timeline plus the carrier
// tracking row. Rendered for both the buyer's Track Orders panel and the
// seller's Track Order modal so each side sees identical status. The real DB
// statuses don't map 1:1 to the timeline steps, so we collapse them:
// paid -> processing, label_generated -> preparing for shipment (the label is
// ready for the seller to print), in_transit -> shipped, completed -> delivered.
// Without this mapping the timeline shows blank for parts of the order's life.
const TIMELINE_STEPS = ['processing', 'preparing_for_shipment', 'shipped', 'out_for_delivery', 'delivered'] as const;

// Bilingual step labels. Kept inline (the component is module-scope and only
// needs the language flag) and matched against the full step key so the EN
// fallback never leaks an underscore like the old `replace('_', ' ')` did.
const TIMELINE_LABELS: Record<string, { en: string; th: string }> = {
  processing: { en: 'Processing', th: 'กำลังดำเนินการ' },
  preparing_for_shipment: { en: 'Preparing Shipment', th: 'กำลังเตรียมจัดส่ง' },
  shipped: { en: 'Shipped', th: 'จัดส่งแล้ว' },
  out_for_delivery: { en: 'Out for Delivery', th: 'กำลังนำจ่าย' },
  delivered: { en: 'Delivered', th: 'จัดส่งสำเร็จ' },
};

const OrderTrackingTimeline: React.FC<{ order: Order; isThai: boolean }> = ({ order, isThai }) => {
  const timelineStatus =
    order.status === 'paid' || order.status === 'processing' || order.status === 'pending'
      ? 'processing'
      : order.status === 'label_generated'
        ? 'preparing_for_shipment'
        : order.status === 'shipped' || order.status === 'in_transit'
          ? 'shipped'
          : order.status === 'out_for_delivery'
            ? 'out_for_delivery'
            : order.status === 'delivered' || order.status === 'completed'
              ? 'delivered'
              : 'processing';
  const currentIdx = TIMELINE_STEPS.indexOf(timelineStatus as typeof TIMELINE_STEPS[number]);
  const label = order.shipping_labels?.[0];
  const stepLabel = (step: string) => {
    const l = TIMELINE_LABELS[step];
    return l ? (isThai ? l.th : l.en) : step.replace(/_/g, ' ');
  };

  return (
    <>
      {/* items-start + a fixed column width keeps the five circles evenly
          spaced and lets the longer "Preparing for Shipment" label wrap
          beneath its node without shoving the row out of alignment; the
          connector's mt-4 pins it to the circles' vertical centre. */}
      <div className="flex items-start">
        {TIMELINE_STEPS.map((step, idx) => {
          const isComplete = idx <= currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center gap-1 w-12 shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isComplete ? 'bg-brand-green' : 'bg-slate-800'} ${isCurrent ? 'ring-2 ring-brand-green ring-offset-2 ring-offset-brand-darker' : ''}`}>
                  {step === 'processing' && <Clock className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                  {step === 'preparing_for_shipment' && <FileText className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                  {step === 'shipped' && <Package className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                  {step === 'out_for_delivery' && <Truck className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                  {step === 'delivered' && <CheckCircle className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                </div>
                <span className={`text-[8px] uppercase tracking-wider text-center leading-tight ${isCurrent ? 'text-brand-green font-bold' : 'text-slate-600'}`}>
                  {stepLabel(step)}
                </span>
              </div>
              {idx < TIMELINE_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mt-4 ${idx < currentIdx ? 'bg-brand-green' : 'bg-slate-800'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Tracking — pulled from the shipping_labels join. MANUAL is the
          sentinel the region-error fallback uses; show a different message
          for those since the parcel can't actually be tracked. */}
      {(() => {
        if (!label?.tracking_number) return null;
        if (label.tracking_number === 'MANUAL') {
          return (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Tracking:</span>
              <span className="text-amber-300 italic">Manual handling — support will be in touch</span>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-slate-500">Tracking:</span>
            <span className="text-white font-mono">{label.tracking_number}</span>
            {label.courier_tracking_url && (
              <a
                href={label.courier_tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-cyan hover:underline text-[10px] uppercase tracking-widest font-bold"
              >
                Track ↗
              </a>
            )}
            {label.carrier_name && (
              <span className="text-slate-600 text-[10px] uppercase tracking-widest">
                via {label.carrier_name}
              </span>
            )}
          </div>
        );
      })()}
    </>
  );
};

const Profile: React.FC<ProfileProps> = ({ user, onNavigatePartner, onGuestLogin, onPanelStateChange, onPayOffer, onViewListing }) => {
  const { t, isThai } = useTranslation();
  const { showToast } = useToast();
  // App-level settings (theme); renamed to avoid clashing with the local
  // user_settings state below.
  const { settings: appSettings, updateTheme } = useUserSettings();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  const supabase = createClient();

  // Profile data state
  const [settings, setSettings] = useState<UserSettings>({
    phone_number: null,
    shipping_address: {},
    two_factor_enabled: false,
    notify_price_drops: true,
    notify_order_updates: true,
    notify_marketing: false
  });
  const [rewards, setRewards] = useState<Rewards>({
    points_balance: 0,
    tier: 'bronze',
    lifetime_points: 0,
    tier_progress: 0
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [shipments, setShipments] = useState<Order[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Edit states
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAddress, setEditAddress] = useState({ address: '', district: '', state: '', province: '', postcode: '' });
  const [profileData, setProfileData] = useState<any>(null);

  // Avatar upload. avatarOverride shows the new photo instantly while the
  // auth USER_UPDATED event propagates the metadata change back to page.tsx.
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);

  // Modal states
  const [reviewModalOrderId, setReviewModalOrderId] = useState<string | null>(null);
  // Seller-side delivery tracking. Holds the order id whose tracking timeline
  // is open in the full-screen tracking modal — reached from a pending
  // shipment card or from the "Track Order" affordance on the label-saved
  // screen. The order is looked up in `shipments` (the seller's list).
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);

  // Shipping-label download modal. On Android (Capacitor) we fetch the PDF
  // ourselves and write it to the device with @capacitor/filesystem, then
  // offer an Open/Print affordance via @capacitor/share — keeping the user
  // inside the app instead of bouncing them to Chrome Custom Tabs.
  // On web we keep the traditional attachment-header download.
  const [labelModal, setLabelModal] = useState<{
    orderId: string | null;
    savedUri: string | null;
    savedFilename: string | null;
    loading: boolean;
    error: string | null;
  }>({ orderId: null, savedUri: null, savedFilename: null, loading: false, error: null });
  const [reviewScore, setReviewScore] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Scroll to top when panel changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [activePanel]);

  // Seller tracking modal: poll Flash once for the viewed shipment so the
  // timeline reflects reality even when the webhook/cron missed an event.
  // Keyed on the modal opening only — the refetch below mutates `shipments`,
  // and depending on it would refire the sweep in a loop.
  useEffect(() => {
    if (!trackingOrderId) return;
    const s = shipments.find((x) => x.id === trackingOrderId);
    const pno = s?.shipping_labels?.[0]?.tracking_number;
    if (!s || !pno || pno === 'MANUAL') return;
    if (!['label_generated', 'shipped', 'in_transit', 'out_for_delivery'].includes(s.status)) return;
    fetch(`/api/orders/track?orderId=${trackingOrderId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const labelMoved = d?.label?.status && d.label.status !== s.shipping_labels?.[0]?.status;
        const orderMoved = d?.order?.status && d.order.status !== s.status;
        if (labelMoved || orderMoved) fetchShipments();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingOrderId]);

  // Keep the parent shell informed about whether a sub-panel is open so the
  // Android hardware back button closes the panel instead of switching tabs.
  useEffect(() => {
    onPanelStateChange?.(activePanel !== 'none');
  }, [activePanel, onPanelStateChange]);

  // The shell dispatches this when the hardware back button is pressed while a
  // sub-panel is open — close the panel rather than letting the shell navigate.
  useEffect(() => {
    const handler = () => setActivePanel('none');
    window.addEventListener('profile-panel-back', handler);
    return () => window.removeEventListener('profile-panel-back', handler);
  }, []);

  // Auto-open the payouts panel when Stripe redirects back from Connect
  // onboarding. The StripeConnectSection's own useEffect strips the query
  // param after handling it (refresh-from-Stripe on 'complete', restart-link
  // on 'refresh'), so this only fires once per redirect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cn = new URLSearchParams(window.location.search).get('stripe_connect');
    if (cn === 'complete' || cn === 'refresh') {
      setActivePanel('payouts');
    }
  }, []);

  // Opened from the shell's stalled-payout banner: the shell sets this flag
  // and switches to the profile tab (remounting us) — land on payouts.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('cs_open_payouts') === '1') {
        sessionStorage.removeItem('cs_open_payouts');
        setActivePanel('payouts');
      }
    } catch { /* storage unavailable (private mode) */ }
  }, []);

  // Opened from an offer-email CTA (/?view=offers): the shell sets this flag
  // and switches to the profile tab (remounting us) — land on the Offers panel.
  // The panel itself is already gated on the offers feature flag, so this is
  // inert when offers are off.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('cs_open_offers') === '1') {
        sessionStorage.removeItem('cs_open_offers');
        setActivePanel('offers');
      }
    } catch { /* storage unavailable (private mode) */ }
  }, []);

  // Fetch profile data on mount
  // Fetch profile data on mount / when the authenticated user changes.
  // We clear profileData first so a previous user's data (or a stale
  // email-prefix fallback) doesn't flash before the new data arrives.
  useEffect(() => {
    if (user && user.provider !== 'guest') {
      setProfileData(null);
      fetchProfileData();
    } else {
      setProfileData(null);
    }
  }, [user]);

  const fetchProfileData = async () => {
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        if (data.profile) setProfileData(data.profile);
        if (data.settings) setSettings(data.settings);
        if (data.rewards) setRewards(data.rewards);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchOrders = async (): Promise<Order[]> => {
    setOrdersError(null);
    try {
      const res = await fetch('/api/profile/orders?status=active', {
        // Capacitor mobile webview sometimes doesn't include cookies on
        // same-origin requests by default — force it so the session is
        // attached on iOS/Android builds.
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOrders(data.orders || []);
        return data.orders || [];
      } else {
        const msg = data.error || `Server returned ${res.status}`;
        console.error('Error fetching orders:', msg);
        setOrdersError(msg);
        setOrders([]);
      }
    } catch (error: any) {
      console.error('Error fetching orders:', error);
      setOrdersError(error?.message || 'Network error');
      setOrders([]);
    }
    return [];
  };

  // Viewing Track Orders self-heals stale statuses: /api/orders/track polls
  // Flash and advances the order server-side. Webhooks can be dropped and the
  // reconcile cron runs hourly, so the moment the buyer actually looks is the
  // one time staleness is guaranteed visible — sync it then. Capped at 10
  // orders and one sweep per minute: each call is a signed Flash API request
  // against a per-merchant rate limit, and a buyer toggling the panel must
  // not burn it. Refetch only if something actually advanced.
  const lastSweepAtRef = useRef(0);
  const syncInFlightOrders = async (list: Order[]) => {
    if (Date.now() - lastSweepAtRef.current < 60_000) return;
    const inFlight = list
      .filter((o) => {
        const pno = o.shipping_labels?.[0]?.tracking_number;
        return ['label_generated', 'shipped', 'in_transit', 'out_for_delivery'].includes(o.status) && pno && pno !== 'MANUAL';
      })
      .slice(0, 10);
    if (inFlight.length === 0) return;
    lastSweepAtRef.current = Date.now();
    const results = await Promise.allSettled(
      inFlight.map((o) =>
        fetch(`/api/orders/track?orderId=${o.id}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))
      )
    );
    const advanced = results.some((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return false;
      const before = inFlight[i];
      return (
        (r.value.label?.status && r.value.label.status !== before.shipping_labels?.[0]?.status) ||
        (r.value.order?.status && r.value.order.status !== before.status)
      );
    });
    if (advanced) fetchOrders();
  };

  const fetchSales = async () => {
    try {
      const res = await fetch('/api/profile/sales');
      if (res.ok) {
        const data = await res.json();
        setSales(data.sales);
        setTotalEarnings(data.totalEarnings);
      }
    } catch (error) {
      console.error('Error fetching sales:', error);
    }
  };

  const fetchShipments = async () => {
    try {
      const res = await fetch('/api/profile/shipments');
      if (res.ok) {
        const data = await res.json();
        setShipments(data.shipments);
      }
    } catch (error) {
      console.error('Error fetching shipments:', error);
    }
  };

  // Swipe-to-dismiss on a delivered/completed shipment card. Optimistic:
  // the card animates out immediately; on failure the list is refetched so
  // the card comes back rather than silently staying "cleared" locally only.
  const clearShipment = async (orderId: string) => {
    setShipments((prev) => prev.filter((s) => s.id !== orderId));
    try {
      const res = await fetch('/api/profile/shipments/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      showToast(t('profile.shipmentClearFailed'), 'error');
      fetchShipments();
    }
  };

  // Note: manual "ship order" flow is intentionally removed. Flash Express
  // labels are auto-generated by the Stripe webhook post-payment; sellers only
  // print and drop off. If status sits at 'paid' (Flash failed), the order
  // shows up in the support queue instead of being a seller action.

  const openLabel = async (orderId: string) => {
    setLabelModal({ orderId, savedUri: null, savedFilename: null, loading: true, error: null });
    try {
      // Step 1: request a signed URL from the server (cookies attached so
      // we can prove the caller is the order's seller). The response is a
      // self-authenticating URL valid for ~5 minutes — it lets the eventual
      // PDF fetch authenticate by query-string token instead of cookies.
      const urlRes = await fetch(`/api/orders/${orderId}/label/url`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!urlRes.ok) {
        const data = await urlRes.json().catch(() => ({}));
        setLabelModal({
          orderId,
          savedUri: null,
          savedFilename: null,
          loading: false,
          error: data.error || `Server returned ${urlRes.status}`,
        });
        return;
      }
      const { url: signedUrl } = await urlRes.json();

      const isCapacitor =
        typeof window !== 'undefined' &&
        !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

      // Web branch: the response's Content-Disposition: attachment header
      // makes browsers trigger their native download flow on same-window
      // navigation. Nothing else needed.
      if (!isCapacitor) {
        // Preflight first so Flash recovery errors land in the modal rather
        // than as a raw JSON page in the download bar.
        const preflight = await fetch(signedUrl, { credentials: 'include' });
        if (!preflight.ok) {
          const data = await preflight.json().catch(() => ({}));
          setLabelModal({
            orderId,
            savedUri: null,
            savedFilename: null,
            loading: false,
            error: data.error || `Server returned ${preflight.status}`,
          });
          return;
        }
        setLabelModal({ orderId: null, savedUri: null, savedFilename: null, loading: false, error: null });
        window.location.href = signedUrl;
        return;
      }

      // Native (Android) branch: pull the PDF into JS as a blob, write it to
      // app-private Documents via @capacitor/filesystem, then surface an
      // Open/Print affordance that hands the saved file to the system share
      // sheet (Android exposes Print there as a target).
      //
      // Why not WebView DownloadManager: Capacitor's default download
      // listener forwards the URL to a generic system Intent and silently
      // no-ops if no default PDF viewer is registered. Writing the bytes
      // ourselves bypasses that and never leaves the app.
      const pdfRes = await fetch(signedUrl, { credentials: 'include' });
      if (!pdfRes.ok) {
        const data = await pdfRes.json().catch(() => ({}));
        setLabelModal({
          orderId,
          savedUri: null,
          savedFilename: null,
          loading: false,
          error: data.error || `Server returned ${pdfRes.status}`,
        });
        return;
      }

      const blob = await pdfRes.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the "data:application/pdf;base64," prefix — Filesystem
          // expects raw base64.
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read PDF blob'));
        reader.readAsDataURL(blob);
      });

      // Prefer the server's filename when available so it matches the
      // name the seller would see if they downloaded on web.
      const cd = pdfRes.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="?([^";]+)"?/i);
      const filename = m?.[1] || `cardstreet-${orderId}.pdf`;

      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const result = await Filesystem.writeFile({
        path: `cardstreet/labels/${filename}`,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });

      setLabelModal({
        orderId,
        savedUri: result.uri,
        savedFilename: filename,
        loading: false,
        error: null,
      });
      showToast(t('profile.labelSavedToast'), 'success');
    } catch (err: any) {
      setLabelModal({
        orderId,
        savedUri: null,
        savedFilename: null,
        loading: false,
        error: err?.message || 'Network error',
      });
    }
  };

  const openSavedLabel = async () => {
    if (!labelModal.savedUri) return;
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: 'Shipping Label',
        text: labelModal.savedFilename || 'Shipping label',
        url: labelModal.savedUri,
        dialogTitle: 'Open or print label',
      });
    } catch (err: any) {
      // User cancelling the share sheet throws; ignore that and only
      // surface real failures.
      if (err?.message && !/cancel/i.test(err.message)) {
        console.error('[Label] Share/open failed:', err);
        showToast(err.message, 'error');
      }
    }
  };

  const closeLabel = () => {
    setLabelModal({ orderId: null, savedUri: null, savedFilename: null, loading: false, error: null });
  };

  const handleCompleteOrder = (orderId: string) => {
    setReviewModalOrderId(orderId);
    setReviewScore(5);
    setReviewComment('');
  };

  const executeCompleteOrder = async () => {
    if (!reviewModalOrderId) return;
    setIsProcessingAction(true);
    try {
      const res = await fetch('/api/orders/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: reviewModalOrderId,
          reviewScore: reviewScore || null,
          reviewComment
        })
      });

      if (res.ok) {
        setReviewModalOrderId(null);
        fetchOrders(); // Refresh
      } else {
        const data = await res.json();
        showToast('Failed: ' + data.error, 'error');
      }
    } catch (error) {
      console.error('Error completing order:', error);
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleLogout = async () => {
    if (user?.provider === 'guest') {
      localStorage.removeItem('cardstreet-guest');
    } else {
      await supabase.auth.signOut();
    }
    // Clear per-session client state so the next signed-out / signed-in user
    // doesn't see the previous account's cart on first render.
    localStorage.removeItem('cardstreet-cart');
    window.location.reload();
  };

  const updateSettings = async (field: string, value: boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    try {
      await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
    } catch (error) {
      console.error('Error updating settings:', error);
      // Revert on error
      setSettings(prev => ({ ...prev, [field]: !value }));
    }
  };

  const saveProfile = async () => {
    // A phone is required to buy or sell (the courier needs it). Don't block a
    // bio-only save when it's still empty, but reject a malformed number early
    // so the user fixes it here instead of hitting the checkout gate later.
    if (editPhone.trim() && !isValidThaiPhone(editPhone)) {
      showToast(t('profile.invalidPhone'), 'error');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editName,
          username: editUsername,
          phone_number: editPhone,
          bio: editBio,
          ...editAddress
        })
      });

      const data = await res.json();
      if (res.ok) {
          setProfileData((prev: any) => ({
            ...prev,
            display_name: editName,
            username: editUsername,
            phone_number: editPhone,
            bio: editBio,
            ...editAddress
          }));
          showToast('Profile updated successfully', 'success');
      } else {
          showToast(data.error || 'Failed to update profile', 'error');
      }
    } catch (error: any) {
      console.error('Error saving profile:', error);
      const detail = error?.message ? `: ${error.message}` : '';
      showToast(`Couldn't save your profile${detail}. Please try again, or contact support if it keeps happening.`, 'error');
    }
    setIsLoading(false);
  };

  // Upload a new profile photo: downscale, push to the 'avatars' bucket under
  // the user's own folder, then store the public URL on user_metadata so it
  // surfaces everywhere user.avatar is read. Cache-bust the URL so the new
  // image shows immediately instead of a stale CDN copy.
  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file', 'error');
      return;
    }

    setAvatarUploading(true);
    try {
      const blob = await downscaleImage(file, 512);
      const path = `${user.id}/${Date.now()}.jpg`;
      const { data, error } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;

      const publicUrl = supabase.storage.from('avatars').getPublicUrl(data.path).data.publicUrl;
      const bustUrl = `${publicUrl}?v=${Date.now()}`;

      const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: bustUrl } });
      if (updateError) throw updateError;

      // Mirror the URL onto the profiles table too. The seller/shop pages read
      // profiles.avatar_url (via the public_profiles view), which is otherwise
      // only seeded once at signup from the OAuth (Gmail) picture — so without
      // this, the shop kept showing the stale Gmail avatar. Fail-soft: the
      // user's own profile already reflects the new photo via user_metadata.
      const { error: profileAvatarError } = await supabase
        .from('profiles')
        .update({ avatar_url: bustUrl })
        .eq('id', user.id);
      if (profileAvatarError) {
        console.error('Failed to mirror avatar to profiles table:', profileAvatarError);
      }

      setAvatarOverride(bustUrl);
      showToast('Profile photo updated', 'success');
    } catch (err: any) {
      console.error('Avatar upload failed:', err);
      showToast(err?.message || "Couldn't update your photo. Please try again.", 'error');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Open panel handlers
  const openPanel = (panel: ActivePanel) => {
    setActivePanel(panel);
    if (panel === 'orders') fetchOrders().then(syncInFlightOrders);
    if (panel === 'sales') fetchSales();
    if (panel === 'shipments') fetchShipments();
    if (panel === 'account' && user) {
      setEditName(user.name);
      setEditUsername(profileData?.username || '');
      setEditPhone(profileData?.phone_number || '');
      setEditBio(profileData?.bio || '');
      setEditAddress({
        address: profileData?.address || '',
        district: profileData?.district || '',
        state: profileData?.state || '',
        province: profileData?.province || '',
        postcode: profileData?.postcode || ''
      });
    }
  };

  // Menu sections
  const baseMenuSections = [
    {
      title: t('profile.account'),
      items: [
        { name: t('profile.editProfile'), icon: User, panel: 'account' as ActivePanel, color: 'text-brand-cyan' }
      ]
    },
    {
      title: t('profile.securityNotifications'),
      items: [
        { name: t('profile.settings'), icon: Settings, panel: 'settings' as ActivePanel, color: 'text-purple-400' }
      ]
    },
    {
      title: t('profile.ordersSales'),
      items: [
        { name: t('profile.trackOrders'), icon: Package, panel: 'orders' as ActivePanel, color: 'text-blue-400' },
        // OBO offers inbox (received as seller + made as buyer). Flag-gated so
        // nothing appears while the feature is dark.
        ...(process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1'
          ? [{ name: t('offer.menuTitle'), icon: Tag, panel: 'offers' as ActivePanel, color: 'text-brand-cyan' }]
          : []),
        { name: t('profile.pendingShipments'), icon: Truck, panel: 'shipments' as ActivePanel, color: 'text-orange-400' },
        { name: t('profile.salesHistory'), icon: History, panel: 'sales' as ActivePanel, color: 'text-green-400' },
        { name: t('profile.sellerPayouts'), icon: Wallet, panel: 'payouts' as ActivePanel, color: 'text-brand-cyan' }
      ]
    },
    {
      title: t('profile.support'),
      items: [
        { name: t('profile.supportCenter'), icon: HelpCircle, panel: 'support' as ActivePanel, color: 'text-slate-400' }
      ]
    },
    {
      title: t('profile.proSection'),
      items: [
        // Standalone route (not a slide panel) — premium features live at
        // /premium, /grade, /trade, /insights outside the tab shell.
        { name: t('profile.cardstreetPro'), icon: Crown, action: () => { window.location.href = '/premium'; }, color: 'text-brand-cyan', special: true }
      ]
    }
  ];

  const isPartner = user?.isPartner || profileData?.role === 'partner' || !!profileData?.partner_joined_at;
  const menuSections = isPartner ? [
    ...baseMenuSections.slice(0, 3),
    {
      title: t('profile.operations'),
      items: [
        { name: t('profile.partnerDashboard'), icon: ShoppingBag, action: onNavigatePartner, color: 'text-brand-green', special: true }
      ]
    },
    ...baseMenuSections.slice(3)
  ] : baseMenuSections;

  // Guest/Logged out view
  if (!user) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8 py-10 flex flex-col items-center justify-center min-h-[70vh]"
        >
          <div className="text-center space-y-4">
            <div className="w-24 h-24 rounded-[2.8rem] glass mx-auto flex items-center justify-center border border-brand-cyan/20 shadow-2xl shadow-brand-cyan/10 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-cyan/10 to-brand-green/10"></div>
              <Lock className="w-10 h-10 text-brand-cyan relative z-10 group-hover:scale-110 transition-transform duration-500" />
            </div>
            <div className="space-y-2 px-4">
              <h2 className="text-3xl font-black text-white tracking-tight uppercase leading-tight italic skew-x-[-10deg]">
                {t('profile.joinCardStreet')} <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan to-brand-green">CardStreet</span>
              </h2>
              <p className="text-sm text-slate-400 font-medium leading-relaxed max-w-[280px] mx-auto">
                {t('profile.createAccountDesc')}
              </p>
            </div>
          </div>

          <div className="w-full space-y-3 px-4 max-w-sm">
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="w-full h-14 bg-gradient-to-r from-brand-cyan to-brand-green hover:shadow-lg hover:shadow-brand-cyan/30 active:scale-95 rounded-2xl flex items-center justify-center gap-3 transition-all group font-black text-brand-darker uppercase tracking-wide text-sm"
            >
              <span>{t('profile.createAccountBtn')}</span>
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="w-full h-12 bg-white/5 hover:bg-white/10 active:bg-white/15 rounded-xl flex items-center justify-center gap-2 transition-all border border-white/10 text-slate-300 font-semibold"
            >
              <span>{t('profile.alreadyHaveAccount')}</span>
            </button>

          </div>
        </motion.div>
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      </>
    );
  }

  const TierIcon = tierConfig[rewards.tier].icon;

  return (
    <div className="relative min-h-screen pb-20">
      {/* Main Profile View */}
      <AnimatePresence mode="wait">
        {activePanel === 'none' && (
          <motion.div
            key="main"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="space-y-8 py-6"
          >
            {/* Profile Header */}
            <div className="text-center pb-4">
              <div className="relative w-24 h-24 mx-auto mb-5">
                <div className="w-24 h-24 rounded-[2.8rem] glass flex items-center justify-center p-1.5 border border-brand-cyan/20 group overflow-hidden shadow-2xl">
                  <div className="w-full h-full rounded-[2.5rem] bg-slate-900 flex items-center justify-center overflow-hidden border border-white/10">
                    <img src={avatarOverride || user.avatar} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={user.name} />
                  </div>
                </div>
                {user.provider !== 'guest' && (
                  <>
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                      aria-label="Change profile photo"
                      className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-brand-cyan text-black flex items-center justify-center shadow-lg border-2 border-brand-darker active:scale-90 transition-transform disabled:opacity-60"
                    >
                      {avatarUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarSelect}
                    />
                  </>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white tracking-tight italic skew-x-[-10deg]">{user.name}</h3>
                {user.provider !== 'guest' ? (
                   <p className="text-sm text-brand-cyan font-bold leading-none min-h-[1.25rem]">
                     {profileData?.username ? `@${profileData.username}` : ' '}
                   </p>
                ) : (
                   <p className="text-[10px] uppercase tracking-[0.4em] text-brand-cyan font-black">
                     Temporary Director
                   </p>
                )}
              </div>


            </div>

            {/* Menu Sections */}
            <div className="space-y-6">
              {menuSections.map((section) => (
                <div key={section.title} className="space-y-3">
                  <h4 className="text-slate-700 text-[9px] font-black uppercase tracking-[0.4em] px-2">{section.title}</h4>
                  <div className="glass rounded-[2rem] border-white/5 overflow-hidden shadow-xl">
                    {section.items.map((item, idx) => (
                      <button
                        key={item.name}
                        onClick={() => item.action ? item.action() : item.panel && openPanel(item.panel)}
                        className={`w-full h-14 px-5 flex items-center justify-between group active:bg-white/[0.04] transition-colors ${idx !== section.items.length - 1 ? 'border-b border-white/[0.03]' : ''}`}
                      >
                        <div className="flex items-center gap-4">
                          <item.icon className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`} />
                          <span className={`text-sm font-semibold ${item.special ? 'text-white' : 'text-slate-300'} group-hover:text-white transition-colors`}>
                            {item.name}
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:translate-x-1 transition-transform" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Sign Out */}
            <button
              onClick={handleLogout}
              className="w-full h-14 glass rounded-[2rem] text-brand-red/70 font-bold text-xs uppercase tracking-[0.2em] border-brand-red/10 active:scale-[0.98] transition-all mt-4 hover:text-brand-red hover:bg-brand-red/5 shadow-lg flex items-center justify-center gap-3"
            >
              <LogOut className="w-4 h-4" />
              {t('profile.signOut')}
            </button>

            {/* Account deletion — required to be reachable in-app by App Store
                Guideline 5.1.1(v). Guests have no server account, so hide it for them. */}
            {user?.provider !== 'guest' && (
              <div className="flex justify-center mt-6">
                <a
                  href="/delete"
                  className="text-[11px] text-slate-500 hover:text-brand-red underline underline-offset-4 transition-colors"
                >
                  {t('profile.deleteAccount')}
                </a>
              </div>
            )}

            {/* DBD Registration Banner — Thailand Department of Business
                Development e-commerce trust mark. Legal requirement for Thai
                online merchants; the linked page lets the public verify the
                business at dbdregistered.dbd.go.th. */}
            <div className="flex justify-center mt-10 pb-6">
              <a
                href="https://dbdregistered.dbd.go.th/api/public/shopinfo?param=264F801AB2642972F5E2CFBD3345A5B9F80CC9E827CEC2581CF516701D187501"
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://dbdregistered.dbd.go.th/api/public/banner?param=264F801AB2642972F5E2CFBD3345A5B9F80CC9E827CEC2581CF516701D187501"
                  alt="DBD Registered"
                  className="h-12 w-auto"
                />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slide-in Panels */}
      <AnimatePresence>
        {/* Account Panel */}
        {activePanel === 'account' && (
          <motion.div
            key="account"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{t('profile.editProfile')}</h2>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <User className="w-3 h-3" /> {t('profile.name')}
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder={t('profile.yourName')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <User className="w-3 h-3" /> {t('profile.username')}
                  </label>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder={t('profile.enterUniqueUsername')}
                    maxLength={20}
                  />
                  {profileData?.username_updated_at && (
                     <p className="text-[10px] text-slate-500 mt-1">
                        {t('profile.usernameChangeRule')}
                     </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <Store className="w-3 h-3" /> {t('profile.aboutShop')}
                  </label>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    rows={4}
                    maxLength={500}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors resize-none"
                    placeholder={t('profile.aboutShopPlaceholder')}
                  />
                  <p className="text-[10px] text-slate-600">{t('profile.aboutShopHint')}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <Mail className="w-3 h-3" /> {t('profile.email')}
                  </label>
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-slate-500 cursor-not-allowed"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <Phone className="w-3 h-3" /> {t('profile.phoneNumber')} <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder={t('profile.phonePlaceholder')}
                  />
                  <p className="text-[10px] text-slate-600">{t('profile.phoneRequiredHint')}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> {t('profile.shippingAddress')}
                  </label>

                  <GooglePlacesAddressInput
                    id="profile-address-autocomplete"
                    defaultValue=""
                    placeholder={isThai ? 'พิมพ์ที่อยู่เพื่อค้นหาอัตโนมัติ...' : 'Search address to auto-fill...'}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    onAddressParsed={(parsed: ParsedThaiAddress) => {
                      setEditAddress(prev => ({
                        ...prev,
                        address: parsed.detail_address || prev.address,
                        district: parsed.sub_district || prev.district,
                        state: parsed.district || prev.state,
                        province: parsed.province || prev.province,
                        postcode: parsed.postal_code || prev.postcode,
                      }));
                    }}
                  />
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    {isThai ? 'เลือกจากรายการ แล้วแก้ไขด้านล่างได้' : 'Select from suggestions, then edit below if needed'}
                  </p>

                  <input
                    type="text"
                    value={editAddress.address}
                    onChange={(e) => setEditAddress(prev => ({ ...prev, address: e.target.value }))}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder={t('profile.streetPlaceholder')}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editAddress.district}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, district: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder={t('profile.districtPlaceholder')}
                    />
                    <input
                      type="text"
                      value={editAddress.state}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, state: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder={t('profile.statePlaceholder')}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editAddress.province}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, province: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder={t('profile.provincePlaceholder')}
                    />
                    <input
                      type="text"
                      value={editAddress.postcode}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, postcode: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder={t('profile.postalCodePlaceholder')}
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={saveProfile}
                disabled={isLoading}
                className="w-full h-14 bg-brand-cyan hover:bg-brand-cyan/90 text-black font-bold rounded-2xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    {t('profile.saveChanges')}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Payment Methods Panel */}
        {/* Rewards Panel */}
        {activePanel === 'rewards' && (
          <motion.div
            key="rewards"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Rewards</h2>
              </div>

              {/* Points Balance Card */}
              <div className={`glass p-6 rounded-3xl border border-white/10 bg-gradient-to-br ${tierConfig[rewards.tier].color} relative overflow-hidden`}>
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <TierIcon className="w-6 h-6 text-white" />
                    <span className="text-white/80 text-xs uppercase tracking-widest font-bold">{rewards.tier} Member</span>
                  </div>
                  <p className="text-5xl font-black text-white mb-1">{rewards.points_balance.toLocaleString()}</p>
                  <p className="text-white/60 text-sm">Available Points</p>
                </div>
              </div>

              {/* Tier Progress */}
              {tierConfig[rewards.tier].next && (
                <div className="glass p-4 rounded-2xl border border-white/5 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-xs uppercase tracking-wider font-bold">Progress to {tierConfig[rewards.tier].next}</span>
                    <span className="text-white font-bold text-sm">{rewards.lifetime_points} / {tierConfig[rewards.tier].pointsNeeded}</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min((rewards.lifetime_points / (tierConfig[rewards.tier].pointsNeeded || 1)) * 100, 100)}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                      className={`h-full rounded-full bg-gradient-to-r ${tierConfig[rewards.tier].color}`}
                    />
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="glass p-4 rounded-2xl border border-white/5 text-center">
                  <p className="text-2xl font-black text-white">{rewards.lifetime_points.toLocaleString()}</p>
                  <p className="text-slate-500 text-xs uppercase tracking-wider">Lifetime Points</p>
                </div>
                <div className="glass p-4 rounded-2xl border border-white/5 text-center">
                  <p className="text-2xl font-black text-brand-green">฿{(rewards.points_balance * 0.5).toFixed(0)}</p>
                  <p className="text-slate-500 text-xs uppercase tracking-wider">Points Value</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Settings Panel */}
        {activePanel === 'settings' && (
          <motion.div
            key="settings"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{t('profile.settingsPanel')}</h2>
              </div>

              {/* Appearance Section */}
              <div className="space-y-3">
                <h4 className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-1">{t('profile.appearance')}</h4>
                <div className="glass rounded-2xl border border-white/5 p-2 flex gap-2">
                  {([
                    { theme: 'dark' as const, label: t('profile.themeDark'), Icon: Moon },
                    { theme: 'light' as const, label: t('profile.themeLight'), Icon: Sun }
                  ]).map(({ theme, label, Icon }) => (
                    <button
                      key={theme}
                      onClick={() => updateTheme(theme)}
                      className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-colors ${
                        appSettings.theme === theme
                          ? 'bg-brand-cyan text-brand-darker'
                          : 'bg-white/5 text-slate-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Security Section */}
              <div className="space-y-3">
                <h4 className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-1">{t('profile.security')}</h4>
                <div className="glass rounded-2xl border border-white/5 overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className={`w-5 h-5 ${settings.two_factor_enabled ? 'text-brand-green' : 'text-slate-500'}`} />
                      <div>
                        <p className="text-white font-semibold text-sm">{t('profile.twoFactorAuth')}</p>
                        <p className="text-slate-500 text-xs flex items-center gap-1">
                          {settings.two_factor_enabled ? (
                            <>
                              <CheckCircle className="w-3 h-3 text-brand-green" />
                              <span className="text-brand-green">{t('profile.secured')}</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3 text-amber-500" />
                              <span className="text-amber-500">{t('profile.notEnabled')}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => updateSettings('two_factor_enabled', !settings.two_factor_enabled)}
                      className={`w-12 h-7 rounded-full transition-colors relative ${settings.two_factor_enabled ? 'bg-brand-green' : 'bg-slate-700'}`}
                    >
                      <motion.div
                        animate={{ x: settings.two_factor_enabled ? 20 : 0 }}
                        className="absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow-lg"
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Notifications Section */}
              <div className="space-y-3">
                <h4 className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-1">{t('profile.notifications')}</h4>
                <div className="glass rounded-2xl border border-white/5 overflow-hidden divide-y divide-white/5">
                  {[
                    { key: 'notify_price_drops', label: t('profile.priceDropAlerts'), desc: t('profile.priceDropAlertsDesc') },
                    { key: 'notify_order_updates', label: t('profile.orderUpdatesAlerts'), desc: t('profile.orderUpdatesAlertsDesc') },
                    { key: 'notify_marketing', label: t('profile.marketingAlerts'), desc: t('profile.marketingAlertsDesc') }
                  ].map((item) => (
                    <div key={item.key} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Bell className="w-5 h-5 text-slate-500" />
                        <div>
                          <p className="text-white font-semibold text-sm">{item.label}</p>
                          <p className="text-slate-500 text-xs">{item.desc}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => updateSettings(item.key, !settings[item.key as keyof UserSettings])}
                        className={`w-12 h-7 rounded-full transition-colors relative ${settings[item.key as keyof UserSettings] ? 'bg-brand-cyan' : 'bg-slate-700'}`}
                      >
                        <motion.div
                          animate={{ x: settings[item.key as keyof UserSettings] ? 20 : 0 }}
                          className="absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow-lg"
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Orders Panel */}
        {activePanel === 'orders' && (
          <motion.div
            key="orders"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{isThai ? 'ติดตามคำสั่งซื้อ' : 'Track Orders'}</h2>
              </div>

              <div className="space-y-4">
                {orders.length === 0 ? (
                  <div className="text-center py-12 space-y-4">
                    <Package className="w-12 h-12 text-slate-700 mx-auto" />
                    {ordersError ? (
                      <>
                        <p className="text-red-400 text-sm">Couldn&apos;t load orders</p>
                        <p className="text-slate-500 text-xs px-4">{ordersError}</p>
                      </>
                    ) : (
                      <p className="text-slate-500 text-sm">No active orders</p>
                    )}
                  </div>
                ) : (
                  orders.map((order) => (
                    <div key={order.id} className="glass p-4 rounded-2xl border border-white/5 space-y-4">
                      {/* Order Header */}
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-16 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0">
                          {order.listing?.card_data?.images?.small && (
                            <img
                              src={getThumbnailUrl(order.listing.card_data.images.small)}
                              alt="Card"
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm truncate">
                            {order.listing?.card_data?.name || 'Card Order'}
                          </p>
                          <p className="text-slate-500 text-xs">{order.listing?.condition}</p>
                          <p className="text-brand-cyan font-bold text-sm mt-1">฿{order.total_amount?.toLocaleString()}</p>
                        </div>
                      </div>

                      <OrderTrackingTimeline order={order} isThai={isThai} />

                      {/* Buyer Action required */}
                      {(order.status === 'shipped' || order.status === 'out_for_delivery' || order.status === 'delivered') && (
                        <button
                          onClick={() => handleCompleteOrder(order.id)}
                          className="w-full h-10 mt-2 bg-brand-cyan text-brand-darker font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-white transition-colors"
                        >
                          {isThai ? 'ยืนยันการรับพัสดุและรีวิว' : 'Confirm Delivery & Review'}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* OBO Offers Panel — received (as seller) + made (as buyer). The inbox
            early-returns null when the offers flag is off, and the menu item
            that opens this panel is itself flag-gated. */}
        {activePanel === 'offers' && (
          <motion.div
            key="offers"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{t('offer.menuTitle')}</h2>
              </div>

              <OffersInbox
                onPayOffer={(args) => {
                  // Close the slide panel first so the shell's PaymentModal
                  // (lower z-index) isn't hidden behind this overlay.
                  setActivePanel('none');
                  onPayOffer?.(args);
                }}
                onViewListing={(offer) => {
                  // Leave the panel open — the CardDetails overlay renders above
                  // it, so closing the card returns straight to this list.
                  onViewListing?.(offer);
                }}
              />
            </div>
          </motion.div>
        )}

        {/* Sales History Panel */}
        {activePanel === 'sales' && (
          <motion.div
            key="sales"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{t('profile.salesHistory')}</h2>
              </div>

              {/* Total Earnings */}
              <div className="glass p-4 rounded-2xl border border-brand-green/20 bg-brand-green/5">
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{t('profile.totalEarnings')}</p>
                <p className="text-3xl font-black text-brand-green">฿{totalEarnings.toLocaleString()}</p>
              </div>

              {/* Stripe Connect payout onboarding */}
              <StripeConnectSection />

              <div className="space-y-3">
                {sales.length === 0 ? (
                  <div className="text-center py-12 space-y-4">
                    <History className="w-12 h-12 text-slate-700 mx-auto" />
                    <p className="text-slate-500 text-sm">{t('profile.noSalesYet')}</p>
                  </div>
                ) : (
                  sales.map((sale) => (
                    <div key={sale.id} className="glass p-3 rounded-2xl border border-white/5 flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0">
                        {sale.listing?.card_data?.images?.small && (
                          <img
                            src={getThumbnailUrl(sale.listing.card_data.images.small)}
                            alt="Card"
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm truncate">
                          {sale.listing?.card_data?.name || t('profile.cardSale')}
                        </p>
                        <p className="text-slate-500 text-xs">{sale.listing?.condition}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-brand-green font-bold">+฿{(sale.total_amount - (sale.platform_fee || 0)).toLocaleString()}</p>
                        <p className="text-slate-600 text-[10px]">
                          {new Date(sale.completed_at ?? sale.created_at).toLocaleDateString(isThai ? 'th-TH' : 'en-US')}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Pending Shipments Panel */}
        {activePanel === 'shipments' && (
          <motion.div
            key="shipments"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{isThai ? 'รายการรอจัดส่ง' : 'Pending Shipments'}</h2>
              </div>

              <div className="space-y-3">
                {shipments.length === 0 ? (
                  <div className="text-center py-12 space-y-4">
                    <Truck className="w-12 h-12 text-slate-700 mx-auto" />
                    <p className="text-slate-500 text-sm">{t('profile.noPendingShipments')}</p>
                    <p className="text-slate-600 text-xs">{t('profile.pendingShipmentsDesc')}</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                  {shipments.map((shipment) => {
                    // Finished shipments stay in the panel as a delivery
                    // notice until the seller swipes them away (see
                    // clearShipment). Active ones can't be dismissed.
                    const isDeliveredCard = ['delivered', 'completed'].includes(shipment.status);
                    return (
                    <motion.div
                      key={shipment.id}
                      layout
                      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
                      drag={isDeliveredCard ? 'x' : false}
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={0.8}
                      dragMomentum={false}
                      onDragEnd={(_, info) => {
                        if (isDeliveredCard && (Math.abs(info.offset.x) > 120 || Math.abs(info.velocity.x) > 600)) {
                          clearShipment(shipment.id);
                        }
                      }}
                      className="glass p-4 rounded-2xl border border-white/5 space-y-4"
                    >
                      {/* Shipment Header */}
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-16 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0">
                          {shipment.listing?.card_data?.images?.small && (
                            <img
                              src={getThumbnailUrl(shipment.listing.card_data.images.small)}
                              alt="Card"
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm truncate">
                            {shipment.listing?.card_data?.name || t('profile.cardOrder')}
                          </p>
                          <p className="text-slate-500 text-xs">{shipment.listing?.condition}</p>
                          <p className={`font-bold text-sm mt-1 ${isDeliveredCard ? 'text-brand-green' : 'text-brand-orange'}`}>
                            {/* 'completed' reads "Delivered" here — in a shipping
                                panel the parcel state is what matters; the
                                escrow-side "Completed" label lives in Sales
                                History. */}
                            {t('profile.status')}: <span className="uppercase tracking-wider text-[10px]">{t(`profile.status_${shipment.status === 'completed' ? 'delivered' : shipment.status.toLowerCase()}`) || shipment.status.replace('_', ' ')}</span>
                          </p>
                        </div>
                      </div>

                      {/* Delivery notice for sellers not opted into push or
                          email — the card lingers here until swiped away. */}
                      {isDeliveredCard && (
                        <div className="flex items-center justify-between gap-2 h-10 px-3 bg-brand-green/10 border border-brand-green/20 rounded-xl">
                          <div className="flex items-center gap-2 text-brand-green min-w-0">
                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            <span className="font-bold text-xs uppercase tracking-widest truncate">{t('profile.shipmentDeliveredBanner')}</span>
                          </div>
                          <span className="text-slate-500 text-[10px] flex-shrink-0">{t('profile.swipeToClear')}</span>
                        </div>
                      )}
                      {/* Status hint while Flash is preparing the label.
                          Labels are generated automatically after payment — no
                          seller action is needed. If the order sticks at 'paid'
                          for long, fulfillment hit an error and support is on it. */}
                      {(shipment.status === 'paid' || shipment.status === 'pending') && (
                        <div className="w-full h-10 bg-slate-800 text-slate-400 border border-white/5 font-bold rounded-xl text-xs uppercase tracking-widest flex items-center justify-center">
                          {t('profile.labelBeingPrepared')}
                        </div>
                      )}
                      {shipment.shipping_labels?.[0]?.tracking_number === 'MANUAL' && (
                        <div className="w-full h-10 bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold rounded-xl text-xs uppercase tracking-widest flex items-center justify-center px-3 text-center">
                          {t('profile.manualLabelRequired')}
                        </div>
                      )}
                      {/* Print Shipping Label button. Visible whenever the
                          order is at a status where a Flash label should
                          exist — even if shipping_labels has no row yet (a
                          recovery path in /api/orders/[id]/label calls Flash
                          again with the same outTradeNo to retrieve the
                          existing shipment). Hidden only when this is a
                          MANUAL placeholder, which the block above already
                          handles with its own UI. */}
                      {['label_generated', 'shipped', 'in_transit', 'out_for_delivery'].includes(shipment.status) &&
                       shipment.shipping_labels?.[0]?.tracking_number !== 'MANUAL' && (
                        <button
                          onClick={() => openLabel(shipment.id)}
                          disabled={labelModal.loading && labelModal.orderId === shipment.id}
                          className="w-full h-10 flex items-center justify-center gap-2 bg-brand-green/20 text-brand-green border border-brand-green/30 font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-brand-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                          {labelModal.loading && labelModal.orderId === shipment.id && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          )}
                          {t('profile.printShippingLabel')}
                        </button>
                      )}
                      {/* Durable track entry point — the label-saved modal only
                          appears right after a download, so sellers need a way
                          back to the timeline afterwards. Shown through to
                          'delivered'/'completed' so the seller can follow the
                          parcel the whole way, mirroring the buyer's view. */}
                      {['label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed'].includes(shipment.status) &&
                       shipment.shipping_labels?.[0]?.tracking_number !== 'MANUAL' && (
                        <button
                          onClick={() => setTrackingOrderId(shipment.id)}
                          className="w-full h-10 flex items-center justify-center gap-2 bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-brand-cyan/20 transition-colors">
                          <MapPin className="w-3.5 h-3.5" />
                          {t('profile.trackOrder')}
                        </button>
                      )}
                    </motion.div>
                    );
                  })}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Seller Payouts Panel — Stripe Connect onboarding & management */}
        {activePanel === 'payouts' && (
          <motion.div
            key="payouts"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{t('profile.sellerPayouts')}</h2>
              </div>

              <StripeConnectSection />
            </div>
          </motion.div>
        )}

        {/* Support Panel */}
        {activePanel === 'support' && (
          <motion.div
            key="support"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto"
          >
            <div className="p-4 pt-16 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}>
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{t('profile.helpSupport')}</h2>
              </div>

              {/* In-app support tickets: submit + track replies without leaving the app */}
              <SupportTickets />

              <div className="glass rounded-2xl border border-white/5 overflow-hidden divide-y divide-white/5">
                {[
                  { icon: HelpCircle, label: t('profile.helpCenter'), href: '/help' },
                  { icon: Mail, label: t('profile.contactUs'), href: '/contact' },
                  { icon: FileText, label: t('profile.privacyPolicy'), href: '/privacy' },
                  { icon: FileText, label: t('profile.termsOfService'), href: '/terms' }
                ].map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="p-4 flex items-center justify-between group hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors" />
                      <span className="text-white font-semibold text-sm">{item.label}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-700 group-hover:translate-x-1 transition-transform" />
                  </a>
                ))}
              </div>

              <div className="text-center pt-8">
                <p className="text-slate-600 text-xs">CardStreet TCG v1.0.0</p>
                <p className="text-slate-700 text-[10px] mt-1">Made with ❤️ in Thailand</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Label download status modal. Three states:
          - loading: fetching signed URL, downloading PDF, writing to disk.
          - error: anything along the way failed (Flash recovery, network,
            Filesystem write).
          - success: PDF saved on device — show filename and Open/Print
            (system share sheet) + Done buttons. Web users never reach the
            success state because the browser handles the attachment-header
            download natively and the modal closes immediately. */}
      <AnimatePresence>
        {(labelModal.loading || labelModal.error || labelModal.savedUri) && (
          <motion.div
            key="label-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex flex-col bg-brand-darker"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/5 shrink-0">
              <h3 className="text-white font-black uppercase tracking-widest text-sm">
                {t('profile.printShippingLabel')}
              </h3>
              <button
                onClick={closeLabel}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {labelModal.loading && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-brand-cyan" />
                <p className="text-sm">{t('profile.labelSaving')}</p>
              </div>
            )}

            {labelModal.error && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <AlertCircle className="w-10 h-10 text-amber-400" />
                <p className="text-amber-300 font-bold uppercase tracking-widest text-xs">
                  {t('profile.labelLoadError')}
                </p>
                <p className="text-slate-400 text-xs max-w-md leading-relaxed">{labelModal.error}</p>
              </div>
            )}

            {!labelModal.loading && !labelModal.error && labelModal.savedUri && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-brand-green/15 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-brand-green" />
                </div>
                <p className="text-white font-black uppercase tracking-widest text-sm">
                  {t('profile.labelSaved')}
                </p>
                <p className="text-slate-400 text-xs max-w-md leading-relaxed">
                  {t('profile.labelSavedLocation')}
                </p>
                {labelModal.savedFilename && (
                  <p className="text-slate-500 text-[11px] font-mono break-all max-w-md">
                    {labelModal.savedFilename}
                  </p>
                )}
                <div className="flex flex-col w-full max-w-xs gap-2 mt-2">
                  <button
                    onClick={openSavedLabel}
                    className="w-full h-12 rounded-xl bg-brand-green text-white font-black text-xs uppercase tracking-widest hover:bg-brand-green/90 active:scale-[0.98] transition-all"
                  >
                    {t('profile.labelOpenPrint')}
                  </button>
                  {/* Track Order — opens the same delivery timeline the buyer
                      sees. Layered above this modal (higher z-index), so
                      closing it returns to the label-saved screen. */}
                  {labelModal.orderId && (
                    <button
                      onClick={() => setTrackingOrderId(labelModal.orderId)}
                      className="w-full h-12 rounded-xl bg-brand-cyan/15 border border-brand-cyan/30 text-brand-cyan font-bold text-xs uppercase tracking-widest hover:bg-brand-cyan/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                      <MapPin className="w-4 h-4" />
                      {t('profile.trackOrder')}
                    </button>
                  )}
                  <button
                    onClick={closeLabel}
                    className="w-full h-12 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-colors"
                  >
                    {t('profile.labelDone')}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Seller delivery-tracking modal. Mirrors the buyer's Track Orders
            timeline so the seller can follow the parcel after handing it off.
            Layered above the label-saved modal (z-[10001] > z-[10000]) so
            closing it returns to the saved-label screen when opened from
            there; it also opens standalone from a pending shipment card. */}
        {trackingOrderId && (() => {
          const trackingOrder = shipments.find((s) => s.id === trackingOrderId);
          const tLabel = trackingOrder?.shipping_labels?.[0];
          return (
            <motion.div
              key="tracking-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[10001] flex flex-col bg-brand-darker"
            >
              <div className="flex items-center justify-between p-4 border-b border-white/5 shrink-0">
                <h3 className="text-white font-black uppercase tracking-widest text-sm">
                  {t('profile.trackOrder')}
                </h3>
                <button
                  onClick={() => setTrackingOrderId(null)}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)' }}>
                {!trackingOrder ? (
                  <div className="flex flex-col items-center justify-center gap-3 text-slate-400 py-16 text-center">
                    <Package className="w-10 h-10 text-slate-700" />
                    <p className="text-sm">{t('profile.trackingUnavailable')}</p>
                  </div>
                ) : (
                  <>
                    {/* Card context so the seller knows which parcel this is */}
                    <div className="flex items-start gap-3">
                      <div className="w-16 h-16 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0">
                        {trackingOrder.listing?.card_data?.images?.small && (
                          <img
                            src={getThumbnailUrl(trackingOrder.listing.card_data.images.small)}
                            alt="Card"
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm truncate">
                          {trackingOrder.listing?.card_data?.name || t('profile.cardOrder')}
                        </p>
                        <p className="text-slate-500 text-xs">{trackingOrder.listing?.condition}</p>
                        <p className="text-brand-orange font-bold text-sm mt-1">
                          {t('profile.status')}: <span className="uppercase tracking-wider text-[10px]">{t(`profile.status_${trackingOrder.status.toLowerCase()}`) || trackingOrder.status.replace('_', ' ')}</span>
                        </p>
                      </div>
                    </div>

                    <div className="glass p-4 rounded-2xl border border-white/5 space-y-4">
                      <OrderTrackingTimeline order={trackingOrder} isThai={isThai} />
                      {!tLabel?.tracking_number && (
                        <p className="text-slate-500 text-xs leading-relaxed text-center">
                          {t('profile.noTrackingYet')}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          );
        })()}

        {reviewModalOrderId && (
          <motion.div
            key="review-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-brand-darker/90 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm glass rounded-3xl p-6 border border-white/10 relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-orange to-amber-500"></div>
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-xl font-black text-white uppercase tracking-widest leading-tight">
                  {t('profile.confirmDelivery')}
                </h3>
                <button
                  onClick={() => setReviewModalOrderId(null)}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <i className="fa-solid fa-xmark text-slate-400"></i>
                </button>
              </div>

              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                {t('profile.confirmDeliveryMsg')}
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{t('profile.rating')}</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        onClick={() => setReviewScore(star)}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${reviewScore >= star ? 'bg-amber-500/20 text-amber-500 border border-amber-500/50' : 'bg-white/5 text-slate-600 border border-transparent'
                          }`}
                      >
                        <i className="fa-solid fa-star text-sm"></i>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{t('profile.reviewCommentOptional')}</label>
                  <textarea
                    value={reviewComment}
                    onChange={e => setReviewComment(e.target.value)}
                    className="w-full h-24 bg-black/50 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-orange/50 resize-none"
                    placeholder={t('profile.reviewPlaceholder')}
                  />
                </div>
              </div>

              <button
                onClick={executeCompleteOrder}
                disabled={isProcessingAction}
                className="w-full h-12 rounded-xl bg-brand-orange text-white font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brand-darker active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessingAction ? t('profile.processing') : t('profile.confirmDelivery')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Profile;
