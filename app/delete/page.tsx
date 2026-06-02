'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function DeleteAccountPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setLoading(false);
    });
  }, [supabase]);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body.error || 'Failed to delete your account. Please try again.');
      }

      // Clear the local session so the app drops back to a signed-out state.
      await supabase.auth.signOut();
      setIsDeleted(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/" className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Delete Account</h1>
        </div>

        {loading ? (
          <div className="glass rounded-[2rem] p-8 border-white/10 text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto"></div>
          </div>
        ) : isDeleted ? (
          <div className="glass rounded-[2rem] p-8 border-white/10 text-center space-y-4 animate-fadeIn">
            <div className="w-20 h-20 rounded-full bg-brand-green/10 flex items-center justify-center mx-auto text-brand-green mb-6">
              <i className="fa-solid fa-check text-3xl"></i>
            </div>
            <h2 className="text-2xl font-black uppercase tracking-widest text-white">Account Deleted</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Your account and all associated data have been permanently deleted. We're sorry to see you go.
            </p>
            <button
              onClick={() => window.location.href = '/'}
              className="mt-8 px-8 py-4 bg-white/5 hover:bg-white/10 rounded-xl text-white font-bold uppercase tracking-wider transition-colors w-full"
            >
              Return Home
            </button>
          </div>
        ) : !email ? (
          /* Not signed in — deletion must be initiated by the account owner. */
          <div className="glass rounded-[2rem] p-8 border-white/10 space-y-5 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto text-slate-400">
              <i className="fa-solid fa-lock text-2xl"></i>
            </div>
            <h2 className="text-xl font-black text-white uppercase tracking-wider">Sign in required</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              To permanently delete your account, please sign in first. For security, account
              deletion can only be performed by the signed-in account owner.
            </p>
            <Link
              href="/"
              className="inline-block mt-2 px-8 py-4 bg-brand-cyan text-brand-darker rounded-xl font-black uppercase tracking-wider transition-colors w-full"
            >
              Go to Sign In
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-white uppercase tracking-wider">Permanently delete your account</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                This will permanently erase the account for{' '}
                <span className="text-brand-cyan font-semibold">{email}</span>, including your
                collection, marketplace listings, orders, and all personal data. This action is
                irreversible.
              </p>
            </div>

            {error && (
              <div className="bg-brand-red/10 border border-brand-red/20 rounded-xl p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-red/20 flex items-center justify-center flex-shrink-0">
                  <i className="fa-solid fa-exclamation text-brand-red text-sm"></i>
                </div>
                <p className="text-sm text-red-200 flex-1">{error}</p>
              </div>
            )}

            <form onSubmit={handleDelete} className="glass rounded-[2rem] p-6 border-white/10 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">
                  Type DELETE to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoCapitalize="characters"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white placeholder-slate-600 focus:outline-none focus:border-brand-red transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || confirmText.trim().toUpperCase() !== 'DELETE'}
                className="w-full bg-red-500 hover:bg-red-400 text-white font-black uppercase tracking-widest py-4 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-trash"></i>
                    Permanently Delete My Account
                  </>
                )}
              </button>
              <p className="text-center text-[10px] text-slate-500 mt-4 px-4 uppercase tracking-wider leading-relaxed">
                Orders with funds still in escrow must be completed or refunded before your account can be deleted.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
