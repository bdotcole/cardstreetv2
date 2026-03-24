import React from 'react';
import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/" className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Terms of Service</h1>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <p className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">Last Updated: March 21, 2026</p>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the Cardstreet mobile application and website (the "Service"), operated by ELC Global Ventures, LLC d.b.a Cardstreet ("Company," "we," "us," or "our"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">2. Eligibility and Registration</h2>
            <div className="space-y-4">
              <div>
                <strong className="text-white block mb-1">Age:</strong>
                <p>You must be at least 18 years old to sell or purchase items on the marketplace. Users under 18 may only use the Service under the supervision of a parent or legal guardian.</p>
              </div>
              <div>
                <strong className="text-white block mb-1">Accounts:</strong>
                <p>You are responsible for maintaining the confidentiality of your account credentials. You agree to provide accurate and complete information during registration.</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">3. Marketplace Rules & Prohibited Items</h2>
            <div className="space-y-4">
              <div>
                <strong className="text-white block mb-1">Scope:</strong>
                <p>Cardstreet is a marketplace for Trading Card Games (TCG), including but not limited to Pokémon, Magic: The Gathering, and Yu-Gi-Oh!.</p>
              </div>
              <div>
                <strong className="text-white block mb-1">Counterfeit Policy:</strong>
                <p>The sale of "proxy," "reproduction," "fake," or "counterfeit" cards is strictly prohibited. Any user found listing such items will face immediate account suspension and potential forfeiture of pending funds.</p>
              </div>
              <div>
                <strong className="text-white block mb-1">Condition Accuracy:</strong>
                <p>Sellers must accurately describe the condition of cards (e.g., Near Mint, Lightly Played).</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">4. Fees and Payments</h2>
            <div className="space-y-4">
              <div>
                <strong className="text-white block mb-1">Transaction Fees:</strong>
                <p>Cardstreet charges a 7.0% transaction fee on all successful sales. This fee is deducted automatically from the sale price before payout.</p>
              </div>
              <div>
                <strong className="text-white block mb-1">Payment Processing:</strong>
                <p>We use Stripe and PayPal to process payments. By using the Service, you also agree to the terms and conditions of these third-party processors.</p>
              </div>
              <div>
                <strong className="text-white block mb-1">Taxes:</strong>
                <p>Users are responsible for any applicable taxes (including sales tax or import duties) arising from their transactions.</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">5. Shipping and Disputes</h2>
            <div className="space-y-4">
              <div>
                <strong className="text-white block mb-1">Shipping:</strong>
                <p>Sellers are responsible for safely packaging and shipping items within the timeframe specified in the listing.</p>
              </div>
              <div>
                <strong className="text-white block mb-1">Disputes:</strong>
                <p>If a buyer receives a card that is damaged, counterfeit, or not as described, they must submit a ticket via our internal Reporting System. Cardstreet reserves the right to mediate disputes and issue refunds at its sole discretion based on evidence provided by both parties.</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">6. Limitation of Liability</h2>
            <p>
              ELC Global Ventures, LLC provides the platform "as-is." We are not responsible for the quality, safety, or legality of the items advertised, nor the truth or accuracy of the listings. Our total liability is limited to the amount of fees paid to us by the user in the 12 months prior to the claim.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
