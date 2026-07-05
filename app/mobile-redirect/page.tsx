import { Suspense } from 'react'
import RedirectContent from './RedirectContent'

export default function MobileRedirect() {
    // We use a Suspense boundary because useSearchParams() bails out of static rendering
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-brand-darker text-white p-6 font-sans">
                <div className="w-8 h-8 border-4 border-t-[#22d3ee] border-white/10 rounded-full animate-spin"></div>
            </div>
        }>
            <RedirectContent />
        </Suspense>
    )
}
