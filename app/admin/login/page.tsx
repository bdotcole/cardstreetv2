'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
function LoginContent() {
    const searchParams = useSearchParams()
    const notAdmin = searchParams?.get('error') === 'not_admin'
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(
        notAdmin ? 'Your account does not have admin access.' : null
    )

    const handleGoogleLogin = async () => {
        setLoading(true)
        setError(null)
        // 1. Set a cookie to remember we want to go back to admin page
        document.cookie = "cardstreet_auth_redirect=/admin; path=/; max-age=3600; SameSite=Lax; Secure";
        
        // Force web redirect URL for admin since they should be on desktop web
        let redirectUrl = `https://cardstreet.app/api/auth/callback?next=/admin`;
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            redirectUrl = `http://localhost:3000/api/auth/callback?next=/admin`;
        }

        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
            },
        })
        if (error) {
            setError(error.message)
            setLoading(false)
        }
    }

    return (
        <div className="w-full max-w-sm">
            {/* Brand */}
            <div className="text-center mb-10">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-cyan to-blue-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-cyan/20">
                    <i className="fa-solid fa-shield-halved text-2xl text-white" />
                </div>
                <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic mb-1">CardStreet</p>
                <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Admin Console</h1>
                <p className="text-slate-500 text-sm mt-2">Sign in with your admin account to continue</p>
            </div>

            {/* Login Card */}
            <div className="glass rounded-2xl border border-white/10 p-8 space-y-4">
                {error && (
                    <div className="bg-brand-red/10 border border-brand-red/20 rounded-xl px-4 py-3">
                        <p className="text-xs font-semibold text-brand-red">{error}</p>
                    </div>
                )}

                <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-3 bg-white text-brand-darker font-black text-sm rounded-xl h-12 hover:brightness-95 active:scale-95 transition-all disabled:opacity-60"
                >
                    {loading ? (
                        <div className="animate-spin h-5 w-5 border-2 border-brand-darker/20 border-t-[#0f1419] rounded-full" />
                    ) : (
                        <>
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Continue with Google
                        </>
                    )}
                </button>

                <p className="text-center text-[10px] text-slate-600">
                    Only accounts with <span className="text-slate-400 font-semibold">admin role</span> can access this console
                </p>
            </div>

            <p className="text-center mt-6">
                <Link href="/" className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                    ← Back to CardStreet
                </Link>
            </p>
        </div>
    )
}

export default function AdminLoginPage() {
    return (
        <div className="min-h-screen bg-brand-darker flex items-center justify-center px-4">
            <Suspense fallback={
                <div className="animate-spin h-8 w-8 border-2 border-white/10 border-t-brand-cyan rounded-full" />
            }>
                <LoginContent />
            </Suspense>
        </div>
    )
}
