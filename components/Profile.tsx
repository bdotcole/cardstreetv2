
import React, { useState } from 'react';
import { UserProfile } from '@/types';
import AuthModal from './AuthModal';
import { createClient } from '@/lib/supabase/client';

interface ProfileProps {
  user: UserProfile | null;
  onNavigatePartner?: () => void;
  onGuestLogin?: () => void;
}

const Profile: React.FC<ProfileProps> = ({ user, onNavigatePartner, onGuestLogin }) => {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const supabase = createClient();

  const handleLogout = async () => {
    if (user?.provider === 'guest') {
      localStorage.removeItem('cardstreet-guest');
    } else {
      await supabase.auth.signOut();
    }
    window.location.reload(); // Force refresh to clear state
  };

  const sections = [
    {
      title: 'Operations',
      items: [
        {
          name: 'Partner Dashboard',
          icon: 'fa-handshake-angle',
          action: onNavigatePartner,
          special: true
        }
      ]
    },
    {
      title: 'Security & Access',
      items: [
        { name: 'Director Credentials', icon: 'fa-id-card-clip' },
        { name: 'Two-Factor Auth', icon: 'fa-shield-halved' },
        { name: 'Device Registry', icon: 'fa-mobile-screen-button' }
      ]
    },
    {
      title: 'Logistics',
      items: [
        { name: 'Sales History', icon: 'fa-file-invoice-dollar' },
        { name: 'Order Tracking', icon: 'fa-truck-fast' },
        { name: 'Shipping Vaults', icon: 'fa-box-archive' }
      ]
    },
    {
      title: 'Support',
      items: [
        { name: 'Executive Concierge', icon: 'fa-headset' },
        { name: 'Documentation', icon: 'fa-circle-info' }
      ]
    }
  ];

  // ... (auth guard handled below)

  if (!user) {
    /// ... (existing code for guest view)
    return (
      // ... same guest render ...
      <>
        <div className="space-y-12 animate-fadeIn py-10 flex flex-col items-center justify-center min-h-[70vh]">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-[2.2rem] glass mx-auto flex items-center justify-center border border-brand-cyan/20">
              <i className="fa-solid fa-fingerprint text-brand-cyan text-3xl"></i>
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
              <i className="fa-solid fa-arrow-right text-slate-900 group-hover:translate-x-1 transition-transform"></i>
            </button>
            <button
              onClick={onGuestLogin}
              className="w-full py-4 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-white transition-colors"
            >
              Enter as Guest <i className="fa-solid fa-user-secret ml-1"></i>
            </button>
          </div>
        </div>
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="space-y-10 animate-fadeIn py-6 pb-20">
      <div className="text-center pb-6">
        {/* ... (existing header) ... */}
        <div className="w-24 h-24 rounded-[2.8rem] glass mx-auto mb-5 flex items-center justify-center p-1.5 border border-brand-cyan/20 relative group overflow-hidden shadow-2xl">
          <div className="w-full h-full rounded-[2.5rem] bg-slate-900 flex items-center justify-center overflow-hidden border border-white/10">
            <img src={user.avatar} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={user.name} />
          </div>
          <div className={`absolute -bottom-1 -right-1 w-9 h-9 rounded-2xl flex items-center justify-center border-4 border-[#121212] shadow-lg ${user.provider === 'google' ? 'bg-white' : 'bg-slate-700'}`}>
            {user.provider === 'google' ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            ) : (
              <i className="fa-solid fa-user-secret text-[#121212] text-xs"></i>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="text-2xl font-black text-white tracking-tight italic skew-x-[-10deg]">{user.name}</h3>
          <p className="text-[10px] uppercase tracking-[0.4em] text-brand-cyan font-black">
            {user.provider === 'guest' ? 'Temporary Director' : 'Verified Vault Member'}
          </p>
          <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest pt-2">{user.email}</p>
        </div>
      </div>

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.title} className="space-y-4">
            <h4 className="text-slate-700 text-[9px] font-black uppercase tracking-[0.4em] px-4">{section.title}</h4>
            <div className="glass rounded-[2.5rem] border-white/5 overflow-hidden shadow-xl">
              {section.items.map((item, idx) => (
                <button
                  key={item.name}
                  onClick={() => item.action && item.action()}
                  className={`w-full h-16 px-6 flex items-center justify-between group active:bg-white/[0.04] transition-colors ${idx !== section.items.length - 1 ? 'border-b border-white/[0.03]' : ''
                    }`}
                >
                  <div className="flex items-center gap-5 py-4">
                    <i className={`fa-solid ${item.icon} ${item.special ? 'text-brand-green' : 'text-slate-500'} group-hover:text-brand-cyan transition-colors text-sm`}></i>
                    <span className={`text-sm font-bold ${item.special ? 'text-white' : 'text-slate-300'} group-hover:text-white transition-colors`}>{item.name}</span>
                  </div>
                  <i className="fa-solid fa-chevron-right text-[10px] text-slate-700 group-hover:translate-x-1 transition-transform"></i>
                </button>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={handleLogout}
          className="w-full h-16 glass rounded-[2.5rem] text-brand-red/60 font-black text-[10px] uppercase tracking-[0.3em] border-brand-red/10 active:scale-95 transition-all mt-6 hover:text-brand-red hover:bg-brand-red/5 shadow-lg"
        >
          Sign Out of Terminal
        </button>
      </div>
    </div>
  );
};

export default Profile;

