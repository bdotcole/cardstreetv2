import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { OFFER_MIN_FLOOR_FRACTION, OFFER_EXPIRY_HOURS } from '@/lib/offerPolicy';
import { notifyOffersChanged } from '@/lib/hooks/useOfferBadge';
import CheckoutAddressSheet, {
  EMPTY_CHECKOUT_ADDRESS,
  type CheckoutAddressValues,
} from '@/components/CheckoutAddressSheet';
import { BUYER_REQUIRED_PROFILE_FIELDS, checkBuyerProfileComplete } from '@/lib/profileValidation';
import { isValidThaiPhone } from '@/lib/utils/phone';

interface OfferModalProps {
  listingId: string;
  listingPrice: number;
  cardName: string;
  onClose: () => void;
  /** Called after a successful offer create so the parent can toast/close. */
  onSubmitted?: () => void;
}

/**
 * Buyer-side "Make an offer" modal. POSTs to /api/offers. Only mounted for OBO
 * listings behind the offers feature flag (the caller gates it). The min-floor
 * and 48h expiry are shown up front; the server is authoritative on both.
 *
 * Delivery details are collected HERE rather than at Pay. QC 2026-08-14 found
 * 6 of the 8 buyers holding an accepted offer had no address/phone on file, so
 * tapping "Pay ฿X" — hours or days later, arriving from an email — dropped them
 * into an address form instead of the payment sheet, and none of them came
 * back. Same total friction, moved to the moment intent is highest. This modal
 * is shared by the mobile shell and both desktop entry points, so gating it
 * here covers every surface at once.
 */
const OfferModal: React.FC<OfferModalProps> = ({ listingId, listingPrice, cardName, onClose, onSubmitted }) => {
  const { isThai } = useTranslation();
  const [amount, setAmount] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = still loading / unknown. Unknown never blocks: the offer just goes
  // through and the buyer meets the old gate at Pay, exactly as before.
  const [needsAddress, setNeedsAddress] = useState<boolean | null>(null);
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const [addressInitial, setAddressInitial] = useState<CheckoutAddressValues>(EMPTY_CHECKOUT_ADDRESS);
  // Set when the address sheet was opened mid-submit, so saving resumes it.
  const resumeAfterAddress = useRef(false);

  const minOffer = Math.ceil(listingPrice * OFFER_MIN_FLOOR_FRACTION);

  // Read the buyer's shipping profile once on open so the form can warn before
  // they commit, and so the sheet prefills whatever is already saved.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/profile', { cache: 'no-store' });
        if (!res.ok) { if (alive) setNeedsAddress(false); return; }
        const { profile } = await res.json();
        if (!alive) return;
        const complete =
          checkBuyerProfileComplete(profile).complete && isValidThaiPhone(profile?.phone_number);
        setNeedsAddress(!complete);
        setAddressInitial({
          ...EMPTY_CHECKOUT_ADDRESS,
          ...Object.fromEntries(
            BUYER_REQUIRED_PROFILE_FIELDS.map((f) => [f, profile?.[f] ?? '']),
          ),
        } as CheckoutAddressValues);
      } catch {
        if (alive) setNeedsAddress(false); // fail open — never block on a hiccup
      }
    })();
    return () => { alive = false; };
  }, []);

  const postOffer = async (value: number) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, amount: value, message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Map the known server codes to friendly bilingual copy.
        const code = data?.code;
        if (code === 'OFFER_TOO_LOW') {
          setError(isThai ? `ข้อเสนอต่ำเกินไป (ขั้นต่ำ ฿${data.min?.toLocaleString?.() ?? minOffer})` : `Offer too low (minimum ฿${data.min ?? minOffer}).`);
        } else if (code === 'OFFER_ALREADY_LIVE') {
          setError(isThai ? 'คุณมีข้อเสนอที่ยังไม่สิ้นสุดบนรายการนี้อยู่แล้ว' : 'You already have a live offer on this listing.');
        } else if (code === 'OFFER_LIMIT_REACHED') {
          setError(isThai ? 'คุณมีข้อเสนอที่ค้างอยู่มากเกินไป' : 'You have too many active offers.');
        } else if (code === 'OFFER_COOLDOWN') {
          setError(isThai ? 'กรุณารอสักครู่ก่อนเสนอราคาอีกครั้งบนรายการนี้' : 'Please wait before offering again on this listing.');
        } else if (code === 'RATE_LIMITED') {
          setError(isThai ? 'คุณเสนอราคาเร็วเกินไป โปรดลองอีกครั้ง' : 'Too many offers — please slow down.');
        } else {
          setError(data?.error || (isThai ? 'ส่งข้อเสนอไม่สำเร็จ' : 'Failed to submit offer.'));
        }
        setSubmitting(false);
        return;
      }
      notifyOffersChanged();
      onSubmitted?.();
      onClose();
    } catch {
      setError(isThai ? 'ส่งข้อเสนอไม่สำเร็จ' : 'Failed to submit offer.');
      setSubmitting(false);
    }
  };

  const validAmount = (): number | null => {
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(isThai ? 'กรุณาระบุจำนวนเงินที่ถูกต้อง' : 'Please enter a valid amount.');
      return null;
    }
    if (value < minOffer) {
      setError(
        isThai
          ? `ข้อเสนอต้องไม่ต่ำกว่า ฿${minOffer.toLocaleString()}`
          : `Offer must be at least ฿${minOffer.toLocaleString()}.`,
      );
      return null;
    }
    return value;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const value = validAmount();
    if (value === null) return;
    // Collect delivery details first so an accepted offer is one tap from paid.
    if (needsAddress) {
      resumeAfterAddress.current = true;
      setAddressSheetOpen(true);
      return;
    }
    void postOffer(value);
  };

  const handleAddressSaved = () => {
    setAddressSheetOpen(false);
    setNeedsAddress(false);
    if (!resumeAfterAddress.current) return;
    resumeAfterAddress.current = false;
    const value = validAmount();
    if (value !== null) void postOffer(value);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[90dvh] overflow-y-auto animate-slideUp">
        <div className="bg-brand-darker/50 p-4 border-b border-white/5 flex justify-between items-center">
          <h3 className="text-white font-black italic skew-x-[-5deg] text-lg uppercase">{isThai ? 'เสนอราคา' : 'Make an Offer'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <p className="text-white font-bold truncate">{cardName}</p>
            <p className="text-xs text-slate-400 mt-1">
              {isThai ? 'ราคาขาย' : 'Asking'}: ฿{listingPrice.toLocaleString()}
            </p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">{isThai ? 'ข้อเสนอของคุณ' : 'Your Offer'} (THB)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">฿</span>
              <input
                type="number"
                required
                min={minOffer}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-8 pr-4 text-white font-bold focus:border-brand-cyan outline-none transition-colors placeholder-slate-600"
                placeholder={`${isThai ? 'ขั้นต่ำ' : 'Min'} ${minOffer.toLocaleString()}`}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {isThai
                ? `ขั้นต่ำ ฿${minOffer.toLocaleString()} · หมดอายุใน ${OFFER_EXPIRY_HOURS} ชั่วโมง`
                : `Minimum ฿${minOffer.toLocaleString()} · expires in ${OFFER_EXPIRY_HOURS}h`}
            </p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">{isThai ? 'ข้อความ (ไม่บังคับ)' : 'Message (optional)'}</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-brand-cyan outline-none transition-colors placeholder-slate-600 resize-none"
              placeholder={isThai ? 'เพิ่มข้อความถึงผู้ขาย…' : 'Add a note for the seller…'}
            />
          </div>

          {needsAddress && (
            <div className="p-3 bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl text-brand-cyan/90 text-[11px] font-bold flex items-start gap-2">
              <i className="fa-solid fa-truck-fast mt-0.5"></i>
              <span>
                {isThai
                  ? 'ขั้นตอนถัดไป: กรอกที่อยู่จัดส่ง เพื่อให้ชำระเงินได้ทันทีเมื่อผู้ขายตอบรับ'
                  : "Next: your delivery address — so you can pay the moment it's accepted."}
              </span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold flex items-center gap-2">
              <i className="fa-solid fa-circle-exclamation"></i>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-14 bg-brand-cyan hover:bg-brand-cyan/90 active:scale-[0.98] rounded-xl text-brand-darker font-black uppercase tracking-wider shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-brand-darker border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <>
                <i className="fa-solid fa-hand-holding-dollar"></i>
                {isThai ? 'ส่งข้อเสนอ' : 'Send Offer'}
              </>
            )}
          </button>
        </form>
      </div>

      {/* Renders at z-[70], above this modal's z-[60], so the offer form stays
          visible behind it and the buyer keeps their place. */}
      <CheckoutAddressSheet
        isOpen={addressSheetOpen}
        initialValues={addressInitial}
        onClose={() => { resumeAfterAddress.current = false; setAddressSheetOpen(false); }}
        onSaved={handleAddressSaved}
      />
    </div>
  );
};

export default OfferModal;
