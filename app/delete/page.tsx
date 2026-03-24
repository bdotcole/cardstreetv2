'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function DeleteDataPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API request
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/" className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Data Deletion</h1>
        </div>

        {isSubmitted ? (
          <div className="glass rounded-[2rem] p-8 border-white/10 text-center space-y-4 animate-fadeIn">
            <div className="w-20 h-20 rounded-full bg-brand-green/10 flex items-center justify-center mx-auto text-brand-green mb-6">
              <i className="fa-solid fa-check text-3xl"></i>
            </div>
            <h2 className="text-2xl font-black uppercase tracking-widest text-white">Request Received</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Your deletion request has been successfully submitted. Our team will process this request within 3-5 business days. You will receive an email confirmation once the deletion is complete.
            </p>
            <button
              onClick={() => window.location.href = '/'}
              className="mt-8 px-8 py-4 bg-white/5 hover:bg-white/10 rounded-xl text-white font-bold uppercase tracking-wider transition-colors w-full"
            >
              Return Home
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-white uppercase tracking-wider">Account & Data Deletion Request</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                CardStreet respects your privacy. Use this form to request the permanent deletion of your account and/or personal data. Please note that account deletion is irreversible and will result in the loss of all your registry entries and marketplace listings.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="glass rounded-[2rem] p-6 border-white/10 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
                <input 
                  type="email" 
                  required 
                  placeholder="Enter the email associated with your account"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white placeholder-slate-600 focus:outline-none focus:border-brand-cyan transition-colors"
                />
              </div>

              <div className="space-y-4 pt-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Request Type</label>
                
                <label className="flex items-start gap-4 p-4 rounded-xl border border-white/10 bg-white/5 cursor-pointer hover:bg-white/10 transition-colors">
                  <div className="flex-shrink-0 mt-1">
                    <input type="radio" name="requestType" value="account" className="w-4 h-4 accent-brand-cyan" required defaultChecked />
                  </div>
                  <div>
                    <span className="block text-white font-bold mb-1">Delete Account & Data</span>
                    <span className="text-xs text-slate-400">Permanently close my account and erase all associated personal data, cards, and history.</span>
                  </div>
                </label>

                <label className="flex items-start gap-4 p-4 rounded-xl border border-white/10 bg-white/5 cursor-pointer hover:bg-white/10 transition-colors">
                  <div className="flex-shrink-0 mt-1">
                    <input type="radio" name="requestType" value="data" className="w-4 h-4 accent-brand-cyan" required />
                  </div>
                  <div>
                    <span className="block text-white font-bold mb-1">Delete Specific Data Only</span>
                    <span className="text-xs text-slate-400">Keep my account open, but delete specific personal data points.</span>
                  </div>
                </label>
              </div>

              <div className="space-y-2 pt-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Additional Details (Optional)</label>
                <textarea 
                  rows={4}
                  placeholder="Tell us exactly what you want deleted if choosing 'Specific Data Only', or leave us some feedback on why you're leaving."
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white placeholder-slate-600 focus:outline-none focus:border-brand-cyan transition-colors resize-none"
                />
              </div>

              <div className="pt-4">
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full bg-red-500 hover:bg-red-400 text-white font-black uppercase tracking-widest py-4 rounded-xl disabled:opacity-50 transition-colors flex items-center justify-center gap-3"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-trash"></i>
                      Submit Deletion Request
                    </>
                  )}
                </button>
                <p className="text-center text-[10px] text-slate-500 mt-4 px-4 uppercase tracking-wider leading-relaxed">
                  By submitting this request, you confirm that you are the rightful owner of the account.
                </p>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
