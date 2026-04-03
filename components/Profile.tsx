'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Mail, Phone, MapPin, CreditCard, Gift, Shield, Bell,
  Package, History, HelpCircle, FileText, Lock, ChevronRight,
  ChevronLeft, Plus, Trash2, Check, X, Truck, Clock, CheckCircle,
  AlertCircle, Star, Crown, Zap, LogOut, Settings, ShoppingBag
} from 'lucide-react';
import { UserProfile } from '@/types';
import AuthModal from './AuthModal';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';

interface ProfileProps {
  user: UserProfile | null;
  onNavigatePartner?: () => void;
  onGuestLogin?: () => void;
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

interface PaymentMethod {
  id: string;
  card_type: string;
  last_four: string;
  expiry_month: number;
  expiry_year: number;
  cardholder_name: string;
  is_default: boolean;
}

interface Order {
  id: string;
  status: 'pending' | 'paid' | 'label_generated' | 'processing' | 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'completed' | 'cancelled' | 'disputed';
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  estimated_delivery: string | null;
  total_amount: number;
  listing: {
    card_data: any;
    condition: string;
  };
  shipping_labels?: { label_url: string }[];
}

interface Sale {
  id: string;
  total_amount: number;
  platform_fee: number;
  completed_at: string;
  listing: {
    card_data: any;
    condition: string;
    price: number;
  };
}

type ActivePanel = 'none' | 'account' | 'payment' | 'rewards' | 'settings' | 'orders' | 'sales' | 'shipments' | 'support';

const tierConfig = {
  bronze: { color: 'from-amber-700 to-amber-900', icon: Star, next: 'silver', pointsNeeded: 500 },
  silver: { color: 'from-slate-400 to-slate-600', icon: Crown, next: 'gold', pointsNeeded: 2000 },
  gold: { color: 'from-yellow-400 to-amber-500', icon: Crown, next: 'platinum', pointsNeeded: 5000 },
  platinum: { color: 'from-purple-400 to-indigo-600', icon: Zap, next: null, pointsNeeded: null }
};

const Profile: React.FC<ProfileProps> = ({ user, onNavigatePartner, onGuestLogin }) => {
  const { t, isThai } = useTranslation();
  const { showToast } = useToast();
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
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [shipments, setShipments] = useState<Order[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Edit states
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState({ address: '', district: '', state: '', province: '', postcode: '' });
  const [profileData, setProfileData] = useState<any>(null);

  // Modal states
  const [shippingModalOrderId, setShippingModalOrderId] = useState<string | null>(null);
  const [reviewModalOrderId, setReviewModalOrderId] = useState<string | null>(null);
  const [reviewScore, setReviewScore] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Scroll to top when panel changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [activePanel]);

  // Fetch profile data on mount
  useEffect(() => {
    if (user && user.provider !== 'guest') {
      fetchProfileData();
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

  const fetchPaymentMethods = async () => {
    try {
      const res = await fetch('/api/profile/payment-methods');
      if (res.ok) {
        const data = await res.json();
        setPaymentMethods(data);
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/profile/orders?status=active');
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
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

  const handleShipOrder = (orderId: string) => {
    setShippingModalOrderId(orderId);
  };

  const executeShipOrder = async () => {
    if (!shippingModalOrderId) return;
    setIsProcessingAction(true);
    try {
      const res = await fetch('/api/orders/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: shippingModalOrderId, trackingNumber: '', carrier: 'Thailand Post' })
      });
      if (res.ok) {
        setShippingModalOrderId(null);
        fetchShipments(); // Refresh
      } else {
        const data = await res.json();
        showToast('Failed: ' + data.error, 'error');
      }
    } catch (error) {
      console.error('Error shipping order:', error);
    } finally {
      setIsProcessingAction(false);
    }
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
    setIsLoading(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editName,
          username: editUsername,
          phone_number: editPhone,
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
            ...editAddress
          }));
          showToast('Profile updated successfully', 'success');
      } else {
          showToast(data.error || 'Failed to update profile', 'error');
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      showToast('An unexpected error occurred', 'error');
    }
    setIsLoading(false);
  };

  const deletePaymentMethod = async (id: string) => {
    try {
      await fetch(`/api/profile/payment-methods?id=${id}`, { method: 'DELETE' });
      setPaymentMethods(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      console.error('Error deleting payment method:', error);
    }
  };

  // Open panel handlers
  const openPanel = (panel: ActivePanel) => {
    setActivePanel(panel);
    if (panel === 'payment') fetchPaymentMethods();
    if (panel === 'orders') fetchOrders();
    if (panel === 'sales') fetchSales();
    if (panel === 'shipments') fetchShipments();
    if (panel === 'account' && user) {
      setEditName(user.name);
      setEditUsername(profileData?.username || '');
      setEditPhone(profileData?.phone_number || '');
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
        { name: t('profile.editProfile'), icon: User, panel: 'account' as ActivePanel, color: 'text-brand-cyan' },
        { name: t('profile.paymentMethods'), icon: CreditCard, panel: 'payment' as ActivePanel, color: 'text-emerald-400' }
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
        { name: 'Pending Shipments', icon: Truck, panel: 'shipments' as ActivePanel, color: 'text-orange-400' },
        { name: t('profile.salesHistory'), icon: History, panel: 'sales' as ActivePanel, color: 'text-green-400' }
      ]
    },
    {
      title: t('profile.support'),
      items: [
        { name: 'Support Center', icon: HelpCircle, panel: 'support' as ActivePanel, color: 'text-slate-400' }
      ]
    }
  ];

  const menuSections = user?.isPartner ? [
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
              <div className="w-24 h-24 rounded-[2.8rem] glass mx-auto mb-5 flex items-center justify-center p-1.5 border border-brand-cyan/20 relative group overflow-hidden shadow-2xl">
                <div className="w-full h-full rounded-[2.5rem] bg-slate-900 flex items-center justify-center overflow-hidden border border-white/10">
                  <img src={user.avatar} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={user.name} />
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white tracking-tight italic skew-x-[-10deg]">{user.name}</h3>
                {user.provider !== 'guest' ? (
                   <p className="text-sm text-brand-cyan font-bold leading-none">
                     @{profileData?.username || user.email?.split('@')[0]}
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
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
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
                    <Phone className="w-3 h-3" /> {t('profile.phoneNumber')}
                  </label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder={t('profile.phonePlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> {t('profile.shippingAddress')}
                  </label>
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
        {activePanel === 'payment' && (
          <motion.div
            key="payment"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Payment Methods</h2>
              </div>

              <div className="space-y-3">
                {paymentMethods.length === 0 ? (
                  <div className="text-center py-12 space-y-4">
                    <CreditCard className="w-12 h-12 text-slate-700 mx-auto" />
                    <p className="text-slate-500 text-sm">{isThai ? 'ยังไม่มีข้อมูลการชำระเงิน' : 'No payment methods saved'}</p>
                  </div>
                ) : (
                  paymentMethods.map((method) => (
                    <div
                      key={method.id}
                      className="glass px-4 py-3 rounded-2xl border border-white/5 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${method.card_type === 'visa' ? 'bg-blue-600' : method.card_type === 'mastercard' ? 'bg-orange-500' : 'bg-slate-600'}`}>
                          <CreditCard className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="text-white font-semibold text-sm flex items-center gap-2">
                            •••• {method.last_four}
                            {method.is_default && (
                              <span className="text-[8px] px-2 py-0.5 bg-brand-cyan/20 text-brand-cyan rounded-full uppercase">Default</span>
                            )}
                          </p>
                          <p className="text-slate-500 text-xs">{method.expiry_month}/{method.expiry_year}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => deletePaymentMethod(method.id)}
                        className="p-2 hover:bg-red-500/20 rounded-xl transition-colors group"
                      >
                        <Trash2 className="w-4 h-4 text-slate-600 group-hover:text-red-400" />
                      </button>
                    </div>
                  ))
                )}

                {/* Add New Card Button */}
                <button className="w-full h-16 border-2 border-dashed border-white/10 rounded-2xl flex items-center justify-center gap-3 text-slate-500 hover:text-white hover:border-brand-cyan/30 transition-colors group">
                  <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  <span className="font-semibold">{isThai ? 'เพิ่มการ์ดใหม่' : 'Add New Card'}</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Rewards Panel */}
        {activePanel === 'rewards' && (
          <motion.div
            key="rewards"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
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
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">{isThai ? 'ตั้งค่า' : 'Settings'}</h2>
              </div>

              {/* Security Section */}
              <div className="space-y-3">
                <h4 className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-1">{isThai ? 'ความปลอดภัย' : 'Security'}</h4>
                <div className="glass rounded-2xl border border-white/5 overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className={`w-5 h-5 ${settings.two_factor_enabled ? 'text-brand-green' : 'text-slate-500'}`} />
                      <div>
                        <p className="text-white font-semibold text-sm">{isThai ? 'การยืนยันตัวตนแบบสองชั้น' : 'Two-Factor Authentication'}</p>
                        <p className="text-slate-500 text-xs flex items-center gap-1">
                          {settings.two_factor_enabled ? (
                            <>
                              <CheckCircle className="w-3 h-3 text-brand-green" />
                              <span className="text-brand-green">Secured</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3 text-amber-500" />
                              <span className="text-amber-500">{isThai ? 'ยังไม่ได้เปิดใช้งาน' : 'Not Enabled'}</span>
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
                <h4 className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-1">{isThai ? 'การแจ้งเตือน' : 'Notifications'}</h4>
                <div className="glass rounded-2xl border border-white/5 overflow-hidden divide-y divide-white/5">
                  {[
                    { key: 'notify_price_drops', label: isThai ? 'แจ้งเตือนเมื่อราคาลดลง' : 'Price Drop Alerts', desc: isThai ? 'แจ้งเตือนเมื่อรายการโปรดลดรา' : 'Get notified when wishlist items drop' },
                    { key: 'notify_order_updates', label: isThai ? 'สถานะคำสั่งซื้อ' : 'Order Updates', desc: isThai ? 'แจ้งเตือนการจัดส่งสินค้า' : 'Shipping and delivery notifications' },
                    { key: 'notify_marketing', label: isThai ? 'ข่าวสารและกิจกรรม' : 'Marketing', desc: isThai ? 'โปรโมชันและข้อเสนอพิเศษ' : 'Promotions and special offers' }
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
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
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
                    <p className="text-slate-500 text-sm">No active orders</p>
                  </div>
                ) : (
                  orders.map((order) => (
                    <div key={order.id} className="glass p-4 rounded-2xl border border-white/5 space-y-4">
                      {/* Order Header */}
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-16 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0">
                          {order.listing?.card_data?.images?.small && (
                            <img
                              src={order.listing.card_data.images.small}
                              alt="Card"
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

                      {/* Order Timeline */}
                      <div className="flex items-center justify-between">
                        {['processing', 'shipped', 'out_for_delivery', 'delivered'].map((step, idx) => {
                          const stepOrder = ['processing', 'shipped', 'out_for_delivery', 'delivered'];
                          const currentIdx = stepOrder.indexOf(order.status);
                          const isComplete = idx <= currentIdx;
                          const isCurrent = idx === currentIdx;

                          return (
                            <React.Fragment key={step}>
                              <div className="flex flex-col items-center gap-1">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isComplete ? 'bg-brand-green' : 'bg-slate-800'} ${isCurrent ? 'ring-2 ring-brand-green ring-offset-2 ring-offset-brand-darker' : ''}`}>
                                  {step === 'processing' && <Clock className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                                  {step === 'shipped' && <Package className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                                  {step === 'out_for_delivery' && <Truck className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                                  {step === 'delivered' && <CheckCircle className={`w-4 h-4 ${isComplete ? 'text-black' : 'text-slate-600'}`} />}
                                </div>
                                <span className={`text-[8px] uppercase tracking-wider ${isCurrent ? 'text-brand-green font-bold' : 'text-slate-600'}`}>
                                  {isThai ? ({ processing: 'กำลังดำเนินการ', shipped: 'จัดส่งแล้ว', out_for_delivery: 'กำลังนำจ่าย', delivered: 'จัดส่งสำเร็จ' }[step as string] || step.replace('_', ' ')) : (step.replace('_', ' '))}
                                </span>
                              </div>
                              {idx < 3 && (
                                <div className={`flex-1 h-0.5 ${idx < currentIdx ? 'bg-brand-green' : 'bg-slate-800'}`} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>

                      {order.tracking_number && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-slate-500">Tracking:</span>
                          <span className="text-white font-mono">{order.tracking_number}</span>
                        </div>
                      )}

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

        {/* Sales History Panel */}
        {activePanel === 'sales' && (
          <motion.div
            key="sales"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Sales History</h2>
              </div>

              {/* Total Earnings */}
              <div className="glass p-4 rounded-2xl border border-brand-green/20 bg-brand-green/5">
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total Earnings</p>
                <p className="text-3xl font-black text-brand-green">฿{totalEarnings.toLocaleString()}</p>
              </div>

              <div className="space-y-3">
                {sales.length === 0 ? (
                  <div className="text-center py-12 space-y-4">
                    <History className="w-12 h-12 text-slate-700 mx-auto" />
                    <p className="text-slate-500 text-sm">No sales yet</p>
                  </div>
                ) : (
                  sales.map((sale) => (
                    <div key={sale.id} className="glass p-3 rounded-2xl border border-white/5 flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0">
                        {sale.listing?.card_data?.images?.small && (
                          <img
                            src={sale.listing.card_data.images.small}
                            alt="Card"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm truncate">
                          {sale.listing?.card_data?.name || 'Card Sale'}
                        </p>
                        <p className="text-slate-500 text-xs">{sale.listing?.condition}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-brand-green font-bold">+฿{(sale.total_amount - (sale.platform_fee || 0)).toLocaleString()}</p>
                        <p className="text-slate-600 text-[10px]">
                          {new Date(sale.completed_at).toLocaleDateString(isThai ? 'th-TH' : 'en-US')}
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
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
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
                    <p className="text-slate-500 text-sm">{isThai ? 'ไม่มีรายการรอจัดส่ง' : 'No pending shipments'}</p>
                    <p className="text-slate-600 text-xs">{isThai ? 'เมื่อมีผู้ซื้อสั่งซื้อการ์ดของคุณ รายการจะปรากฏที่นี่เพื่อรอการจัดส่ง' : 'When your items are purchased, they will appear here.'}</p>
                  </div>
                ) : (
                  shipments.map((shipment) => (
                    <div key={shipment.id} className="glass p-4 rounded-2xl border border-white/5 space-y-4">
                      {/* Shipment Header */}
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-16 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0">
                          {shipment.listing?.card_data?.images?.small && (
                            <img
                              src={shipment.listing.card_data.images.small}
                              alt="Card"
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm truncate">
                            {shipment.listing?.card_data?.name || 'Card Order'}
                          </p>
                          <p className="text-slate-500 text-xs">{shipment.listing?.condition}</p>
                          <p className="text-brand-orange font-bold text-sm mt-1">
                            {isThai ? 'สถานะ' : 'Status'}: <span className="uppercase tracking-wider text-[10px]">{isThai ? ({ processing: 'กำลังดำเนินการ', shipped: 'จัดส่งแล้ว', out_for_delivery: 'กำลังนำจ่าย', delivered: 'จัดส่งสำเร็จ', paid: 'รอจัดส่ง', pending: 'รอชำระเงิน' }[shipment.status as string] || shipment.status.replace('_', ' ')) : (shipment.status.replace('_', ' '))}</span>
                          </p>
                        </div>
                      </div>

                      {/* Action Required */}
                      {(shipment.status === 'paid' || shipment.status === 'pending') && (
                        <button
                          onClick={() => {
                            console.log('Opening shipping modal for order:', shipment.id);
                            handleShipOrder(shipment.id);
                          }}
                          className="w-full h-10 bg-brand-cyan text-brand-darker font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-white transition-colors">
                          {isThai ? 'สร้างป้ายชื่อและจัดส่ง' : 'Create Label & Ship'}
                        </button>
                      )}
                      {shipment.shipping_labels?.[0]?.label_url && shipment.shipping_labels[0].label_url !== 'N/A' && (
                        <a
                          href={shipment.shipping_labels[0].label_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full h-10 flex items-center justify-center bg-brand-green/20 text-brand-green border border-brand-green/30 font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-brand-green/30 transition-colors">
                          {isThai ? 'พิมพ์ป้ายชื่อจัดส่ง' : 'Print Shipping Label'}
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
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
            className="fixed inset-0 bg-brand-darker z-[200] overflow-y-auto pb-20"
          >
            <div className="p-4 pt-16 space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Help & Support</h2>
              </div>

              <div className="glass rounded-2xl border border-white/5 overflow-hidden divide-y divide-white/5">
                {[
                  { icon: HelpCircle, label: 'Help Center', href: '#' },
                  { icon: Mail, label: 'Contact Us', href: 'mailto:support@cardstreet.app' },
                  { icon: FileText, label: 'Privacy Policy', href: '/privacy' },
                  { icon: FileText, label: 'Terms of Service', href: '/terms' }
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

      {/* Action Modals */}
      <AnimatePresence>
        {shippingModalOrderId && (
          <motion.div
            key="shipping-modal"
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
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-cyan to-brand-green"></div>
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-xl font-black text-white uppercase tracking-widest leading-tight">
                  {isThai ? 'ยืนยันการจัดส่ง' : 'Confirm Shipment'}
                </h3>
                <button
                  onClick={() => setShippingModalOrderId(null)}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <i className="fa-solid fa-xmark text-slate-400"></i>
                </button>
              </div>

              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                {isThai ? 'ระบบจะสร้างหมายเลขติดตามและป้ายจัดส่งผ่าน SHIPPOP สำหรับคำสั่งซื้อนี้โดยอัตโนมัติ คุณพร้อมที่จะแพ็คและนำพัสดุไปส่งแล้วหรือยัง?' : 'The system will automatically generate a tracking number and shipping label via SHIPPOP. Are you ready to pack and drop off the shipment?'}
              </p>

              <button
                onClick={executeShipOrder}
                disabled={isProcessingAction}
                className="w-full h-12 rounded-xl bg-brand-cyan text-brand-darker font-black text-sm uppercase tracking-widest hover:bg-white active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessingAction ? (isThai ? 'กำลังดำเนินการ...' : 'Processing...') : (isThai ? 'สร้างป้ายชื่อจัดส่งอัตโนมัติ' : 'Generate Shipping Label')}
              </button>
            </motion.div>
          </motion.div>
        )}

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
                  {isThai ? 'ยืนยันการรับพัสดุ' : 'Confirm Delivery'}
                </h3>
                <button
                  onClick={() => setReviewModalOrderId(null)}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <i className="fa-solid fa-xmark text-slate-400"></i>
                </button>
              </div>

              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                {isThai ? 'สินค้าชิ้นนี้ถึงมือคุณอย่างปลอดภัยแล้วใช่หรือไม่? การยืนยันจะถือเป็นการสิ้นสุดการทำธุรกรรมและจะทำการโอนเงินให้กับผู้ขาย' : 'Has this item arrived safely? Confirming will finalize the transaction and transfer funds to the seller.'}
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{isThai ? 'ให้คะแนน' : 'Rating'}</label>
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
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{isThai ? 'ความคิดเห็น (ไม่บังคับ)' : 'Review Comment (Optional)'}</label>
                  <textarea
                    value={reviewComment}
                    onChange={e => setReviewComment(e.target.value)}
                    className="w-full h-24 bg-black/50 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-orange/50 resize-none"
                    placeholder={isThai ? 'แพ็คเกจดีมาก การ์ดสภาพสมบูรณ์!' : 'Great packaging, perfect condition!'}
                  />
                </div>
              </div>

              <button
                onClick={executeCompleteOrder}
                disabled={isProcessingAction}
                className="w-full h-12 rounded-xl bg-brand-orange text-white font-black text-sm uppercase tracking-widest hover:bg-white hover:text-brand-darker active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessingAction ? (isThai ? 'กำลังดำเนินการ...' : 'Processing...') : (isThai ? 'ยืนยันรับพัสดุ' : 'Confirm Delivery')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Profile;
