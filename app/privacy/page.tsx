import React from 'react';
import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/" className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Privacy Policy</h1>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <p className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">Last Updated: March 21, 2026</p>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">1. Information We Collect</h2>
            <p>We collect information to provide a secure marketplace experience:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong className="text-white">Personal Data:</strong> Name, email address, physical shipping address, and phone number.</li>
              <li><strong className="text-white">Verification Data:</strong> We may collect government-issued ID images to verify "Verified Seller" status.</li>
              <li><strong className="text-white">Transaction Data:</strong> Payment details processed through Stripe/PayPal (we do not store full credit card numbers on our servers).</li>
              <li><strong className="text-white">Media:</strong> Photos of cards uploaded for listings.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">2. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To facilitate transactions between buyers and sellers.</li>
              <li>To prevent fraud and enforce our ban on counterfeit items.</li>
              <li>To improve our app using analytics.</li>
              <li>To comply with legal obligations (e.g., tax reporting).</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">3. Third-Party Sharing</h2>
            <p>We share your data with trusted service providers only as necessary:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong className="text-white">Infrastructure:</strong> Firebase (Google) for data storage and authentication.</li>
              <li><strong className="text-white">Payments:</strong> Stripe and PayPal for secure transaction processing.</li>
              <li><strong className="text-white">Compliance:</strong> We may disclose information if required by US law or to protect the safety of our users.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">4. International Transfers</h2>
            <p>
              Cardstreet is a US-based entity. While we operate in Thailand, your data is primarily stored and processed on servers located in the United States. By using the Service, you consent to this transfer.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">5. Your Rights</h2>
            <p>
              You have the right to access, correct, or request the deletion of your personal data. To exercise these rights, please contact us at <a href="mailto:support@thailandtcg.com" className="text-brand-cyan hover:underline">support@thailandtcg.com</a>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">6. Security</h2>
            <p>
              We implement industry-standard security measures via Firebase and encrypted payment gateways. However, no method of transmission over the internet is 100% secure.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
