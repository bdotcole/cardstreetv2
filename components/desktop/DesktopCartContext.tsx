'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { CartItem } from '@/types';

interface DesktopCartContextValue {
    user: User | null;
    authChecked: boolean;
    items: CartItem[];
    isOpen: boolean;
    addItem: (item: CartItem) => void;
    removeItem: (id: string) => void;
    clear: () => void;
    openCart: () => void;
    closeCart: () => void;
}

const DesktopCartContext = createContext<DesktopCartContextValue | null>(null);

export function useDesktopCart(): DesktopCartContextValue {
    const ctx = useContext(DesktopCartContext);
    if (!ctx) throw new Error('useDesktopCart must be used inside DesktopCartProvider');
    return ctx;
}

// User-scoped storage key, mirroring the mobile shell's convention: two
// accounts on one machine must never see each other's cart.
const keyFor = (userId: string | null) => `cardstreet-desktop-cart:${userId ?? 'anon'}`;

function readCart(userId: string | null): CartItem[] {
    try {
        const raw = window.localStorage.getItem(keyFor(userId));
        return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
        return [];
    }
}

export default function DesktopCartProvider({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const [user, setUser] = useState<User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [items, setItems] = useState<CartItem[]>([]);
    const [isOpen, setIsOpen] = useState(false);

    // Which user's storage key the in-memory cart belongs to. undefined =
    // not hydrated yet; the persist effect must not write before hydration.
    const ownerRef = useRef<string | null | undefined>(undefined);
    const itemsRef = useRef<CartItem[]>(items);
    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            setUser(data.user ?? null);
            setAuthChecked(true);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    // Hydrate, and re-hydrate when the account changes. A user signing in
    // adopts the cart they built while browsing anonymously.
    useEffect(() => {
        if (!authChecked) return;
        const owner = user?.id ?? null;
        if (ownerRef.current === owner) return;
        let next = readCart(owner);
        if (owner && next.length === 0) {
            const anon = readCart(null);
            if (anon.length > 0) {
                next = anon;
                try {
                    window.localStorage.removeItem(keyFor(null));
                    window.localStorage.setItem(keyFor(owner), JSON.stringify(anon));
                } catch { /* non-fatal */ }
            }
        }
        ownerRef.current = owner;
        setItems(next);
    }, [authChecked, user]);

    // Persist to the hydrated owner's key only.
    useEffect(() => {
        if (ownerRef.current === undefined) return;
        try {
            window.localStorage.setItem(keyFor(ownerRef.current), JSON.stringify(items));
        } catch { /* storage blocked — cart lives in memory only */ }
    }, [items]);

    const addItem = useCallback((item: CartItem) => {
        // TH checkout is a direct charge on one connected account, so a cart
        // holds one seller at a time — same constraint /api/orders/checkout
        // enforces server-side. The confirm() must stay outside the updater
        // (updaters run twice in StrictMode and must be pure), so it reads the
        // ref; the updater re-checks so a stale read can't corrupt the cart.
        const prev = itemsRef.current;
        if (prev.length > 0 && prev[0].sellerId !== item.sellerId) {
            const replace = window.confirm(
                t('desktop.cart.replaceSellerConfirm').replace('{seller}', prev[0].sellerName)
            );
            if (!replace) return;
            setItems([item]);
            setIsOpen(true);
            return;
        }
        setItems((cur) => {
            if (cur.find((i) => i.id === item.id)) return cur;
            if (cur.length > 0 && cur[0].sellerId !== item.sellerId) return cur;
            return [...cur, item];
        });
        setIsOpen(true);
    }, [t]);

    const removeItem = useCallback((id: string) => {
        setItems((prev) => prev.filter((i) => i.id !== id));
    }, []);

    const clear = useCallback(() => setItems([]), []);
    const openCart = useCallback(() => setIsOpen(true), []);
    const closeCart = useCallback(() => setIsOpen(false), []);

    return (
        <DesktopCartContext.Provider
            value={{ user, authChecked, items, isOpen, addItem, removeItem, clear, openCart, closeCart }}
        >
            {children}
        </DesktopCartContext.Provider>
    );
}
