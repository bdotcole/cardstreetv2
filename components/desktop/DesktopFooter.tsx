import Link from 'next/link';

export default function DesktopFooter() {
    return (
        <footer className="border-t border-white/5 mt-16">
            <div className="max-w-screen-2xl mx-auto px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
                <p>© {new Date().getFullYear()} CardStreet TCG</p>
                <nav className="flex items-center gap-6">
                    <Link href="/help" className="hover:text-slate-300 transition-colors">Help</Link>
                    <Link href="/contact" className="hover:text-slate-300 transition-colors">Contact</Link>
                    <Link href="/terms" className="hover:text-slate-300 transition-colors">Terms</Link>
                    <Link href="/privacy" className="hover:text-slate-300 transition-colors">Privacy</Link>
                    {/* Plain anchor on purpose: the ?view= switch needs a full request so
                        middleware can set the cs_view cookie and re-route. */}
                    <a href="/?view=mobile" className="hover:text-slate-300 transition-colors">Switch to mobile site</a>
                </nav>
            </div>
        </footer>
    );
}
