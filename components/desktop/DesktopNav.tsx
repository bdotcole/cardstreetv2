'use client'

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import AuthModal from '@/components/AuthModal';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';

export default function DesktopNav() {
    const router = useRouter();
    const pathname = usePathname();
    const { items: cartItems, openCart } = useDesktopCart();
    const [query, setQuery] = useState('');
    const [user, setUser] = useState<User | null>(null);
    const [authOpen, setAuthOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const q = query.trim();
        router.push(q ? `/?q=${encodeURIComponent(q)}` : '/');
    };

    const handleSignOut = async () => {
        setMenuOpen(false);
        await createClient().auth.signOut();
    };

    const displayName =
        (user?.user_metadata?.display_name as string) ||
        (user?.user_metadata?.name as string) ||
        user?.email ||
        '';
    const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

    return (
        <header className="sticky top-0 z-50 border-b border-white/5 bg-brand-darker/90 backdrop-blur">
            <div className="max-w-screen-2xl mx-auto px-8 h-16 flex items-center gap-8">
                <Link href="/" className="flex items-center gap-3 shrink-0">
                    <Image src="/logo.png" alt="CardStreet" width={40} height={40} priority className="object-contain" />
                    <span className="text-lg font-black text-white tracking-tight">CardStreet</span>
                </Link>

                <form onSubmit={handleSearch} className="flex-1 max-w-xl relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search cards by name..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                    />
                </form>

                <nav className="flex items-center gap-6 text-sm font-bold ml-auto shrink-0">
                    {([
                        ['/', 'Marketplace'],
                        ['/sell', 'Sell'],
                        ['/orders', 'Orders'],
                    ] as [string, string][]).map(([href, label]) => {
                        // Rendered paths live under /desktop/* via middleware
                        // rewrite, but client-side navigation keeps the clean
                        // URL in usePathname — normalize both.
                        const current = (pathname ?? '/').replace(/^\/desktop/, '') || '/';
                        const active = current === href;
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={`transition-colors ${active ? 'text-brand-cyan' : 'text-white hover:text-brand-cyan'}`}
                            >
                                {label}
                            </Link>
                        );
                    })}
                </nav>

                <button
                    onClick={openCart}
                    className="relative shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                    aria-label={`Cart, ${cartItems.length} item${cartItems.length === 1 ? '' : 's'}`}
                >
                    <i className="fa-solid fa-cart-shopping text-slate-400"></i>
                    {cartItems.length > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-brand-red text-white text-[9px] font-black rounded-full flex items-center justify-center border border-brand-darker">
                            {cartItems.length}
                        </span>
                    )}
                </button>

                {user ? (
                    <div className="relative shrink-0">
                        <button
                            onClick={() => setMenuOpen((open) => !open)}
                            className="flex items-center gap-2.5 bg-white/5 hover:bg-white/10 rounded-xl pl-1.5 pr-3 py-1.5 transition-colors"
                        >
                            <span className="w-7 h-7 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center text-[11px] font-black text-white">
                                {avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    displayName.charAt(0).toUpperCase()
                                )}
                            </span>
                            <span className="text-sm font-bold text-white max-w-[140px] truncate">{displayName}</span>
                            <i className="fa-solid fa-chevron-down text-[10px] text-slate-500"></i>
                        </button>

                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)}></div>
                                <div className="absolute right-0 top-full mt-2 w-56 bg-brand-dark border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                                    <a
                                        href="/?view=mobile"
                                        className="block px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors"
                                    >
                                        <i className="fa-solid fa-mobile-screen mr-2.5 text-slate-500"></i>
                                        Switch to mobile site
                                    </a>
                                    <button
                                        onClick={handleSignOut}
                                        className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors border-t border-white/5"
                                    >
                                        <i className="fa-solid fa-arrow-right-from-bracket mr-2.5 text-slate-500"></i>
                                        Sign out
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <button
                        onClick={() => setAuthOpen(true)}
                        className="shrink-0 bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-5 py-2 rounded-xl transition-colors"
                    >
                        Sign in
                    </button>
                )}
            </div>

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        </header>
    );
}
