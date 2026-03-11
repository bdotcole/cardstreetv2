'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ReactNode, useState } from 'react'

const NAV_ITEMS = [
    { href: '/admin', label: 'Overview', icon: 'fa-solid fa-chart-line' },
    { href: '/admin/users', label: 'Users', icon: 'fa-solid fa-user' },
    { href: '/admin/partners', label: 'Partners', icon: 'fa-solid fa-handshake' },
    { href: '/admin/tickets', label: 'Support Tickets', icon: 'fa-solid fa-ticket' },
    { href: '/admin/downloads', label: 'Download Analytics', icon: 'fa-solid fa-download' },
]

export default function AdminLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const [sidebarOpen, setSidebarOpen] = useState(false)

    return (
        <div className="min-h-screen bg-[#0a0d12] text-slate-200 flex">
            {/* Overlay for mobile */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-20 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-[#0f1419] border-r border-white/5 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static`}>
                {/* Brand */}
                <div className="px-6 h-16 flex items-center gap-3 border-b border-white/5 shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-cyan to-blue-500 flex items-center justify-center">
                        <i className="fa-solid fa-shield-halved text-sm text-white" />
                    </div>
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest text-brand-cyan italic">CardStreet</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Admin Console</p>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                    {NAV_ITEMS.map((item) => {
                        const active = item.href === '/admin'
                            ? pathname === '/admin'
                            : (pathname ?? '').startsWith(item.href)
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setSidebarOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${active
                                    ? 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                                    }`}
                            >
                                <i className={`${item.icon} w-4 text-center`} />
                                {item.label}
                            </Link>
                        )
                    })}
                </nav>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-white/5 shrink-0">
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <i className="fa-solid fa-arrow-left" />
                        Back to App
                    </Link>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-screen lg:ml-0">
                {/* Top bar */}
                <header className="h-16 bg-[#0f1419] border-b border-white/5 px-6 flex items-center justify-between shrink-0 sticky top-0 z-10">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition"
                    >
                        <i className="fa-solid fa-bars text-slate-400" />
                    </button>
                    <div className="hidden lg:block">
                        <p className="text-sm font-bold text-slate-300">
                            {NAV_ITEMS.find(n =>
                                n.href === '/admin' ? pathname === '/admin' : (pathname ?? '').startsWith(n.href)
                            )?.label ?? 'Admin'}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-brand-cyan/10 border border-brand-cyan/20 rounded-full px-3 py-1.5">
                            <div className="w-2 h-2 rounded-full bg-brand-cyan animate-pulse" />
                            <span className="text-xs font-bold text-brand-cyan uppercase tracking-wider">Admin</span>
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 p-6 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
