import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { notifyOffersChanged } from '@/lib/hooks/useOfferBadge';
import { Offer } from '@/types';

interface OffersInboxProps {
  /**
   * Called when the buyer taps "Pay" on an accepted offer. The parent owns the
   * checkout/payment modal, so it decides how to open it. Receives the offer's
   * listing id, amount, and the acceptedOfferId to pass to /api/orders/checkout.
   */
  onPayOffer?: (args: { offer: Offer }) => void;
  /**
   * Called when the user taps an offer's card preview to view the underlying
   * listing. The parent owns navigation — desktop pushes /card/:id, mobile
   * opens the CardDetails overlay — so closing that view returns here. Omitted
   * when the host can't navigate (the row is then non-interactive).
   */
  onViewListing?: (offer: Offer) => void;
}

/**
 * OBO negotiation UI: lists the signed-in user's offers (as buyer and seller)
 * with per-state actions. Only useful while the offers feature flag is on; the
 * component early-returns null when the flag is off so it can be mounted
 * unconditionally by a parent (Profile tab or a route).
 *
 * All actions POST to the /api/offers* routes, which enforce the state machine
 * server-side via CAS — this UI only decides which buttons to SHOW.
 */
// Status chip styling per offer state. Pending is the "needs your attention"
// color; accepted is the success color; terminal states are muted.
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-400/10 text-amber-300 border-amber-400/30',
  accepted: 'bg-brand-green/10 text-brand-green border-brand-green/30',
  countered: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30',
  rejected: 'bg-white/5 text-slate-400 border-white/10',
  expired: 'bg-white/5 text-slate-400 border-white/10',
  withdrawn: 'bg-white/5 text-slate-400 border-white/10',
};

const statusLabel = (status: string, isThai: boolean): string => {
  switch (status) {
    case 'pending': return isThai ? 'รอตอบรับ' : 'Pending';
    case 'accepted': return isThai ? 'ตอบรับแล้ว' : 'Accepted';
    case 'countered': return isThai ? 'ต่อรองแล้ว' : 'Countered';
    case 'rejected': return isThai ? 'ปฏิเสธแล้ว' : 'Declined';
    case 'expired': return isThai ? 'หมดอายุ' : 'Expired';
    case 'withdrawn': return isThai ? 'ถอนแล้ว' : 'Withdrawn';
    default: return status;
  }
};

const OffersInbox: React.FC<OffersInboxProps> = ({ onPayOffer, onViewListing }) => {
  const { t, isThai } = useTranslation();
  const [offers, setOffers] = useState<Offer[]>([]);
  // Declared with the other hooks, not beside sharePayLink where it is used:
  // this component returns early while loading, so a hook further down the body
  // is a conditional hook and React refuses it.
  const [copiedOfferId, setCopiedOfferId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState<string>('');

  const enabled = process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/offers?state=active', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load offers');
      setOffers(Array.isArray(data?.offers) ? data.offers : []);
    } catch (e: any) {
      setError(e?.message || (isThai ? 'โหลดข้อเสนอไม่สำเร็จ' : 'Failed to load offers.'));
    } finally {
      setLoading(false);
    }
  }, [isThai]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled) return null;

  const act = async (offerId: string, action: 'accept' | 'reject' | 'withdraw') => {
    setBusyId(offerId);
    setError(null);
    try {
      const res = await fetch(`/api/offers/${offerId}/${action}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Action failed');
      notifyOffersChanged();
      await load();
    } catch (e: any) {
      setError(e?.message || (isThai ? 'ดำเนินการไม่สำเร็จ' : 'Action failed.'));
    } finally {
      setBusyId(null);
    }
  };

  const submitCounter = async (offerId: string) => {
    const value = parseFloat(counterAmount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(isThai ? 'กรุณาระบุจำนวนเงินที่ถูกต้อง' : 'Please enter a valid amount.');
      return;
    }
    setBusyId(offerId);
    setError(null);
    try {
      const res = await fetch(`/api/offers/${offerId}/counter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Counter failed');
      setCounterFor(null);
      setCounterAmount('');
      notifyOffersChanged();
      await load();
    } catch (e: any) {
      setError(e?.message || (isThai ? 'ต่อรองไม่สำเร็จ' : 'Counter failed.'));
    } finally {
      setBusyId(null);
    }
  };

  // Native share sheet where it exists — the destination is LINE and the sheet
  // is how a phone gets there. Clipboard elsewhere, with the button confirming
  // the copy so a silent no-op is impossible to mistake for success.
  const sharePayLink = async (offerId: string) => {
    const url = `${window.location.origin}/pay/${offerId}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {
      // Sheet dismissed or blocked — fall through to the clipboard.
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedOfferId(offerId);
      setTimeout(() => setCopiedOfferId(null), 2000);
    } catch {
      // Clipboard denied — nothing further to offer here.
    }
  };

  // Actions available depend on who made the pending row (actor_role) vs. the
  // viewer's role on this offer (viewerRole), matching the server's state machine.
  const renderActions = (o: Offer) => {
    const isViewerActor = o.viewerRole === o.actor_role;
    const busy = busyId === o.id;

    if (o.status === 'accepted') {
      if (o.viewerRole === 'buyer') {
        // There is no reserve — the listing stays buyable until this is paid,
        // so the button carries that urgency rather than reading as a receipt.
        return (
          <div className="space-y-1.5">
            <button
              disabled={busy}
              onClick={() => onPayOffer?.({ offer: o })}
              className="w-full sm:w-auto h-10 px-4 bg-brand-green text-brand-darker font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
            >
              {isThai ? `ชำระเงิน ฿${Number(o.amount).toLocaleString()}` : `Pay ฿${Number(o.amount).toLocaleString()}`}
            </button>
            <p className="text-[10px] text-amber-300/80 font-bold">
              {isThai
                ? 'ยังไม่ได้จองสินค้า — ผู้อื่นซื้อได้จนกว่าคุณจะชำระเงิน'
                : 'Not reserved — someone else can still buy it until you pay.'}
            </p>
          </div>
        );
      }
      // Seller side: an accepted offer is NOT a completed sale — the buyer
      // still has to pay. Saying nothing here read as "sold" to sellers.
      // The share button exists because the chase happens in LINE, not in the
      // app: without a link to paste, "have you paid yet" is all the seller
      // has, and the link is the only version of that message that converts.
      return (
        <div className="space-y-1.5">
          <p className="text-[10px] text-amber-300/80 font-bold uppercase tracking-wide">
            {isThai ? 'รอผู้ซื้อชำระเงิน' : 'Waiting for buyer to pay'}
          </p>
          <button
            onClick={() => sharePayLink(o.id)}
            className="w-full sm:w-auto h-10 px-4 bg-white/5 border border-white/10 text-slate-200 font-black text-[10px] tracking-widest rounded-lg uppercase"
          >
            <i className="fa-solid fa-paper-plane mr-2 text-[9px]"></i>
            {copiedOfferId === o.id ? t('offer.payLinkCopied') : t('offer.sharePayLink')}
          </button>
          <p className="text-[10px] text-slate-500">{t('offer.expiresIn48h')}</p>
        </div>
      );
    }

    if (o.status !== 'pending') return null;

    if (isViewerActor) {
      // The viewer made this pending offer — they can only withdraw.
      return (
        <button
          disabled={busy}
          onClick={() => act(o.id, 'withdraw')}
          className="w-full sm:w-auto h-10 px-4 bg-white/5 border border-white/10 text-slate-300 font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
        >
          {isThai ? 'ถอนข้อเสนอ' : 'Withdraw'}
        </button>
      );
    }

    // The viewer is the counterparty — accept / counter / reject.
    if (counterFor === o.id) {
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={counterAmount}
            onChange={(e) => setCounterAmount(e.target.value)}
            placeholder="฿"
            autoFocus
            className="flex-1 sm:flex-none sm:w-28 min-w-0 h-10 bg-white/5 border border-white/10 rounded-lg px-3 text-white text-sm"
          />
          <button
            disabled={busy}
            onClick={() => submitCounter(o.id)}
            className="h-10 px-4 bg-brand-cyan text-brand-darker font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
          >
            {isThai ? 'ส่ง' : 'Send'}
          </button>
          <button
            onClick={() => { setCounterFor(null); setCounterAmount(''); }}
            className="h-10 px-3 text-slate-400 text-[10px] font-bold uppercase"
          >
            {isThai ? 'ยกเลิก' : 'Cancel'}
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-stretch gap-2">
        <button
          disabled={busy}
          onClick={() => act(o.id, 'accept')}
          className="flex-1 sm:flex-none h-10 px-2 sm:px-4 bg-brand-green text-brand-darker font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
        >
          {isThai ? 'ตอบรับ' : 'Accept'}
        </button>
        <button
          disabled={busy}
          onClick={() => { setCounterFor(o.id); setCounterAmount(''); }}
          className="flex-1 sm:flex-none h-10 px-2 sm:px-4 bg-brand-cyan/10 border border-brand-cyan/40 text-brand-cyan font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
        >
          {isThai ? 'ต่อรอง' : 'Counter'}
        </button>
        <button
          disabled={busy}
          onClick={() => act(o.id, 'reject')}
          className="flex-1 sm:flex-none h-10 px-2 sm:px-4 bg-white/5 border border-white/10 text-slate-300 font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
        >
          {isThai ? 'ปฏิเสธ' : 'Decline'}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider border-l-4 border-brand-cyan pl-3">
          {isThai ? 'ข้อเสนอ' : 'Offers'}
        </h3>
        <button onClick={load} className="text-[10px] text-brand-cyan font-bold uppercase">
          {isThai ? 'รีเฟรช' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold">{error}</div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm py-6 text-center">{isThai ? 'กำลังโหลด…' : 'Loading…'}</div>
      ) : offers.length === 0 ? (
        <div className="text-slate-500 text-sm py-6 text-center">{isThai ? 'ยังไม่มีข้อเสนอ' : 'No active offers.'}</div>
      ) : (
        <div className="space-y-2">
          {offers.map((o) => {
            const card = o.listing?.card_data;
            const thumb = card?.images?.small;
            // The card preview is tappable when the host wired navigation and the
            // listing still resolves to a card page.
            const canView = !!onViewListing && !!o.listing?.card_id;
            // Actions render on their own full-width row below the card info —
            // sharing a row squeezed the title/price to nothing on phones.
            const actions = renderActions(o);
            return (
            <div key={o.id} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-3">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => { if (canView) onViewListing?.(o); }}
                  disabled={!canView}
                  className="flex items-start gap-3 min-w-0 flex-1 text-left group disabled:cursor-default"
                >
                  <span className="w-11 h-16 rounded-md bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                    {thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getThumbnailUrl(thumb)}
                        alt=""
                        loading="lazy"
                        className={`w-full h-full ${card?.isSealed ? 'object-contain' : 'object-cover'}`}
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-white font-bold text-sm truncate ${canView ? 'group-hover:text-brand-cyan transition-colors' : ''}`}>
                      {card?.name || (isThai ? 'การ์ด' : 'Card')}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      <span className="text-white font-bold">฿{Number(o.amount).toLocaleString()}</span>
                      {' · '}
                      {o.viewerRole === 'buyer' ? (isThai ? 'คุณเสนอ' : 'You offered') : (isThai ? 'ผู้ซื้อเสนอ' : 'Buyer offered')}
                    </p>
                    {o.listing?.price != null && (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        <span className="uppercase tracking-wide">{isThai ? 'ราคาตั้ง' : 'Listed'}</span>{' '}
                        ฿{Number(o.listing.price).toLocaleString()}
                      </p>
                    )}
                  </div>
                </button>
                <span className={`shrink-0 mt-0.5 px-2 py-1 rounded-md border text-[9px] font-black uppercase tracking-widest ${STATUS_STYLES[o.status] || STATUS_STYLES.rejected}`}>
                  {statusLabel(o.status, isThai)}
                </span>
              </div>
              {actions && <div>{actions}</div>}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OffersInbox;
