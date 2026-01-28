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
  status: 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled';
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  estimated_delivery: string | null;
  transaction: {
    amount: number;
    listing: {
      card_data: any;
      condition: string;
    };
  };
}

interface Sale {
  id: string;
  amount: number;
  platform_fee: number;
  completed_at: string;
  listing: {
    card_data: any;
    condition: string;
    price: number;
  };
}

type ActivePanel = 'none' | 'account' | 'payment' | 'rewards' | 'settings' | 'orders' | 'sales' | 'support';

const tierConfig = {
  bronze: { color: 'from-amber-700 to-amber-900', icon: Star, next: 'silver', pointsNeeded: 500 },
  silver: { color: 'from-slate-400 to-slate-600', icon: Crown, next: 'gold', pointsNeeded: 2000 },
  gold: { color: 'from-yellow-400 to-amber-500', icon: Crown, next: 'platinum', pointsNeeded: 5000 },
  platinum: { color: 'from-purple-400 to-indigo-600', icon: Zap, next: null, pointsNeeded: null }
};

const Profile: React.FC<ProfileProps> = ({ user, onNavigatePartner, onGuestLogin }) => {
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
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Edit states
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState({ street: '', city: '', state: '', postal_code: '', country: '' });

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
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editName,
          phone_number: editPhone,
          shipping_address: editAddress
        })
      });
      setSettings(prev => ({
        ...prev,
        phone_number: editPhone,
        shipping_address: editAddress
      }));
    } catch (error) {
      console.error('Error saving profile:', error);
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
    if (panel === 'account' && user) {
      setEditName(user.name);
      setEditPhone(settings.phone_number || '');
      setEditAddress({
        street: settings.shipping_address?.street || '',
        city: settings.shipping_address?.city || '',
        state: settings.shipping_address?.state || '',
        postal_code: settings.shipping_address?.postal_code || '',
        country: settings.shipping_address?.country || ''
      });
    }
  };

  // Menu sections
  const menuSections = [
    {
      title: 'Account',
      items: [
        { name: 'Edit Profile', icon: User, panel: 'account' as ActivePanel, color: 'text-brand-cyan' },
        { name: 'Payment Methods', icon: CreditCard, panel: 'payment' as ActivePanel, color: 'text-emerald-400' },
        { name: 'Rewards', icon: Gift, panel: 'rewards' as ActivePanel, color: 'text-amber-400' }
      ]
    },
    {
      title: 'Security & Notifications',
      items: [
        { name: 'Settings', icon: Settings, panel: 'settings' as ActivePanel, color: 'text-purple-400' }
      ]
    },
    {
      title: 'Orders & Sales',
      items: [
        { name: 'Track Orders', icon: Package, panel: 'orders' as ActivePanel, color: 'text-blue-400' },
        { name: 'Sales History', icon: History, panel: 'sales' as ActivePanel, color: 'text-green-400' }
      ]
    },
    {
      title: 'Operations',
      items: [
        { name: 'Partner Dashboard', icon: ShoppingBag, action: onNavigatePartner, color: 'text-brand-green', special: true }
      ]
    },
    {
      title: 'Support',
      items: [
        { name: 'Help & Support', icon: HelpCircle, panel: 'support' as ActivePanel, color: 'text-slate-400' }
      ]
    }
  ];

  // Guest/Logged out view
  if (!user) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-12 py-10 flex flex-col items-center justify-center min-h-[70vh]"
        >
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-[2.2rem] glass mx-auto flex items-center justify-center border border-brand-cyan/20">
              <Lock className="w-8 h-8 text-brand-cyan" />
            </div>
            <div className="space-y-1 px-4">
              <h2 className="text-3xl font-black text-white tracking-tight uppercase leading-tight italic skew-x-[-10deg]">Elite Registry</h2>
              <p className="text-[10px] text-slate-600 font-black uppercase tracking-[0.3em] leading-relaxed max-w-[240px] mx-auto">
                Unlock cross-device vault synchronization
              </p>
            </div>
          </div>

          <div className="w-full space-y-4 px-4 max-w-sm">
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="w-full h-16 bg-white hover:bg-slate-50 active:bg-slate-100 rounded-2xl flex items-center justify-center gap-4 transition-all shadow-xl group mb-3"
            >
              <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-900">Access Terminal</span>
              <ChevronRight className="w-4 h-4 text-slate-900 group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              onClick={onGuestLogin}
              className="w-full py-4 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-white transition-colors flex items-center justify-center gap-2"
            >
              Enter as Guest <User className="w-3 h-3" />
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
                <div className={`absolute -bottom-1 -right-1 w-9 h-9 rounded-2xl flex items-center justify-center border-4 border-[#121212] shadow-lg bg-gradient-to-br ${tierConfig[rewards.tier].color}`}>
                  <TierIcon className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white tracking-tight italic skew-x-[-10deg]">{user.name}</h3>
                <p className="text-[10px] uppercase tracking-[0.4em] text-brand-cyan font-black">
                  {user.provider === 'guest' ? 'Temporary Director' : `${rewards.tier.toUpperCase()} MEMBER`}
                </p>
                <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest pt-2">{user.email}</p>
              </div>

              {/* Quick Rewards Preview */}
              {user.provider !== 'guest' && (
                <button
                  onClick={() => openPanel('rewards')}
                  className="mt-4 mx-auto flex items-center gap-3 px-4 py-2 glass rounded-2xl border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                >
                  <Gift className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-bold text-white">{rewards.points_balance.toLocaleString()}</span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-500">Points</span>
                  <ChevronRight className="w-3 h-3 text-slate-600" />
                </button>
              )}
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
              Sign Out
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
            className="absolute inset-0 bg-brand-darker z-50 overflow-y-auto pb-20"
          >
            <div className="p-4 space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Edit Profile</h2>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <User className="w-3 h-3" /> Name
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder="Your name"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <Mail className="w-3 h-3" /> Email
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
                    <Phone className="w-3 h-3" /> Phone Number
                  </label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder="+66 xxx xxx xxxx"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> Shipping Address
                  </label>
                  <input
                    type="text"
                    value={editAddress.street}
                    onChange={(e) => setEditAddress(prev => ({ ...prev, street: e.target.value }))}
                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                    placeholder="Street address"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editAddress.city}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, city: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder="City"
                    />
                    <input
                      type="text"
                      value={editAddress.state}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, state: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder="State/Province"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editAddress.postal_code}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, postal_code: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder="Postal Code"
                    />
                    <input
                      type="text"
                      value={editAddress.country}
                      onChange={(e) => setEditAddress(prev => ({ ...prev, country: e.target.value }))}
                      className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan/50 focus:outline-none transition-colors"
                      placeholder="Country"
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
                    Save Changes
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
            className="absolute inset-0 bg-brand-darker z-50 overflow-y-auto pb-20"
          >
            <div className="p-4 space-y-6">
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
                    <p className="text-slate-500 text-sm">No payment methods saved</p>
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
                  <span className="font-semibold">Add New Card</span>
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
            className="absolute inset-0 bg-brand-darker z-50 overflow-y-auto pb-20"
          >
            <div className="p-4 space-y-6">
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
            className="absolute inset-0 bg-brand-darker z-50 overflow-y-auto pb-20"
          >
            <div className="p-4 space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Settings</h2>
              </div>

              {/* Security Section */}
              <div className="space-y-3">
                <h4 className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-1">Security</h4>
                <div className="glass rounded-2xl border border-white/5 overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className={`w-5 h-5 ${settings.two_factor_enabled ? 'text-brand-green' : 'text-slate-500'}`} />
                      <div>
                        <p className="text-white font-semibold text-sm">Two-Factor Authentication</p>
                        <p className="text-slate-500 text-xs flex items-center gap-1">
                          {settings.two_factor_enabled ? (
                            <>
                              <CheckCircle className="w-3 h-3 text-brand-green" />
                              <span className="text-brand-green">Secured</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3 text-amber-500" />
                              <span className="text-amber-500">Not enabled</span>
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
                <h4 className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-1">Notifications</h4>
                <div className="glass rounded-2xl border border-white/5 overflow-hidden divide-y divide-white/5">
                  {[
                    { key: 'notify_price_drops', label: 'Price Drop Alerts', desc: 'Get notified when wishlist items drop' },
                    { key: 'notify_order_updates', label: 'Order Updates', desc: 'Shipping and delivery notifications' },
                    { key: 'notify_marketing', label: 'Marketing', desc: 'Promotions and special offers' }
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
            className="absolute inset-0 bg-brand-darker z-50 overflow-y-auto pb-20"
          >
            <div className="p-4 space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setActivePanel('none')} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors">
                  <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">Track Orders</h2>
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
                          {order.transaction?.listing?.card_data?.images?.small && (
                            <img
                              src={order.transaction.listing.card_data.images.small}
                              alt="Card"
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm truncate">
                            {order.transaction?.listing?.card_data?.name || 'Card Order'}
                          </p>
                          <p className="text-slate-500 text-xs">{order.transaction?.listing?.condition}</p>
                          <p className="text-brand-cyan font-bold text-sm mt-1">฿{order.transaction?.amount?.toLocaleString()}</p>
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
                                  {step.replace('_', ' ')}
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
            className="absolute inset-0 bg-brand-darker z-50 overflow-y-auto pb-20"
          >
            <div className="p-4 space-y-6">
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
                        <p className="text-brand-green font-bold">+฿{(sale.amount - (sale.platform_fee || 0)).toLocaleString()}</p>
                        <p className="text-slate-600 text-[10px]">
                          {new Date(sale.completed_at).toLocaleDateString()}
                        </p>
                      </div>
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
            className="absolute inset-0 bg-brand-darker z-50 overflow-y-auto pb-20"
          >
            <div className="p-4 space-y-6">
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
                  { icon: FileText, label: 'Privacy Policy', href: '#' },
                  { icon: FileText, label: 'Terms of Service', href: '#' }
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
    </div>
  );
};

export default Profile;
