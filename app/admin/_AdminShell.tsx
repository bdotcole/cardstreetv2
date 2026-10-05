'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ReactNode, useState } from 'react'

interface NavPage { href: string; label: string }
interface NavSection { label: string; icon: string; pages: NavPage[] }

// Sidebar sections. A section with several pages shows them as tabs under the
// top bar. Every page keeps its own URL, so links from emails and other admin
// pages (e.g. /admin/tickets?ticket=, /admin/breakers) still land directly.
// The sidebar entry opens the section's first page.
const NAV_SECTIONS: NavSection[] = [
    { label: 'Overview', icon: 'fa-solid fa-chart-line', pages: [{ href: '/admin', label: 'Overview' }] },
    {
        label: 'Users', icon: 'fa-solid fa-user', pages: [
            { href: '/admin/users', label: 'Users' },
            { href: '/admin/breakers', label: 'Breaker Applications' },
        ],
    },
    {
        label: 'Partners', icon: 'fa-solid fa-handshake', pages: [
            { href: '/admin/partners', label: 'Partners' },
            { href: '/admin/downloads', label: 'Download Analytics' },
        ],
    },
    {
        label: 'Support', icon: 'fa-solid fa-headset', pages: [
            { href: '/admin/tickets', label: 'Tickets' },
            { href: '/admin/reports', label: 'User Reports' },
        ],
    },
    {
        label: 'Catalog & Listings', icon: 'fa-solid fa-database', pages: [
            { href: '/admin/listings', label: 'Listings' },
            { href: '/admin/catalog', label: 'Catalog' },
            { href: '/admin/sets', label: 'Mapping QC' },
        ],
    },
    { label: 'Rewards', icon: 'fa-solid fa-coins', pages: [{ href: '/admin/rewards', label: 'Rewards' }] },
]

function isActivePage(href: string, pathname: string): boolean {
    if (href === '/admin') return pathname === '/admin'
    return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Client-side chrome for /admin/*. Extracted from the route layout so the
 * route layout can stay a server component and export `dynamic = 'force-dynamic'`
 * to opt the whole admin tree out of build-time prerendering. (Route Segment
 * Config exports aren't allowed in client components.)
 */
export default function AdminShell({ children }: { children: ReactNode }) {
    return <AdminChrome pathname={usePathname() ?? ''}>{children}</AdminChrome>
}

export function AdminChrome({ pathname, children }: { pathname: string; children: ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const activeSection = NAV_SECTIONS.find(s => s.pages.some(p => isActivePage(p.href, pathname)))
    const activePage = activeSection?.pages.find(p => isActivePage(p.href, pathname))

    return (
        <div className="min-h-screen bg-brand-darker text-slate-200 flex">
            {/* Overlay for mobile */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-20 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-brand-darker border-r border-white/5 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static`}>
                {/* Brand */}
                <div className="px-6 h-16 flex items-center gap-3 border-b border-white/5 shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-cyan to-blue-500 flex items-center justify-center">
                        <i className="fa-solid fa-shield-halved text-sm text-white" />
                    </div>
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest text-brand-cyan italic">Cardstreet</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Admin Console</p>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                    {NAV_SECTIONS.map((section) => {
                        const active = section === activeSection
                        return (
                            <Link
                                key={section.label}
                                href={section.pages[0].href}
                                onClick={() => setSidebarOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${active
                                    ? 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                                    }`}
                            >
                                <i className={`${section.icon} w-4 text-center`} />
                                {section.label}
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
                <header className="h-16 bg-brand-darker border-b border-white/5 px-6 flex items-center justify-between shrink-0 sticky top-0 z-10">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition"
                    >
                        <i className="fa-solid fa-bars text-slate-400" />
                    </button>
                    <div className="hidden lg:block">
                        <p className="text-sm font-bold text-slate-300">{activeSection?.label ?? 'Admin'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-brand-cyan/10 border border-brand-cyan/20 rounded-full px-3 py-1.5">
                            <div className="w-2 h-2 rounded-full bg-brand-cyan animate-pulse" />
                            <span className="text-xs font-bold text-brand-cyan uppercase tracking-wider">Admin</span>
                        </div>
                    </div>
                </header>

                {/* Section tabs, kept outside the scrolling content so they stay put */}
                {activeSection && activeSection.pages.length > 1 && (
                    <nav className="bg-brand-darker border-b border-white/5 px-6 flex gap-1 overflow-x-auto shrink-0">
                        {activeSection.pages.map((page) => {
                            const active = page === activePage
                            return (
                                <Link
                                    key={page.href}
                                    href={page.href}
                                    className={`px-4 py-3 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${active
                                        ? 'border-brand-cyan text-brand-cyan'
                                        : 'border-transparent text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    {page.label}
                                </Link>
                            )
                        })}
                    </nav>
                )}

                {/* Page content */}
                <main className="flex-1 p-6 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
