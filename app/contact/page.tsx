import React from 'react';
import Link from 'next/link';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/" className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Contact Us</h1>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <p>
            Need help with an order, your account, or a listing? We&apos;re here for you. The fastest way to reach the CardStreet team is by email — we read every message.
          </p>

          {/* Primary support email */}
          <section className="glass rounded-2xl border border-white/10 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan">
                <i className="fa-solid fa-envelope text-lg"></i>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Email Support</p>
                <a href="mailto:support@cardstreet.app" className="text-white font-bold hover:text-brand-cyan transition-colors">
                  support@cardstreet.app
                </a>
              </div>
            </div>
            <a
              href="mailto:support@cardstreet.app"
              className="block w-full text-center bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider py-3.5 rounded-xl active:scale-[0.98] transition-all"
            >
              Send us an email
            </a>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">Response Time</h2>
            <p>
              We typically reply within 1–2 business days. Support is provided in English and Thai (ภาษาไทย).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">Order &amp; Dispute Help</h2>
            <p>
              For a problem with a specific order — an item that arrived damaged, counterfeit, or not as described — please email us with your <strong className="text-white">order number</strong> and clear photos. This helps us mediate and resolve disputes as quickly as possible.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">When You Write In</h2>
            <p>Including these details helps us help you faster:</p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              <li>The email address on your CardStreet account</li>
              <li>The order or listing number, if relevant</li>
              <li>A short description of the issue and any screenshots</li>
            </ul>
          </section>

          <section className="space-y-2 pt-2 border-t border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Operated By</p>
            <p className="text-slate-400">
              ELC Global Ventures, LLC d.b.a CardStreet
            </p>
            <p className="text-slate-600 text-xs">Made with care in Thailand.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
