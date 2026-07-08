import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
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
const OffersInbox: React.FC<OffersInboxProps> = ({ onPayOffer, onViewListing }) => {
  const { isThai } = useTranslation();
  const [offers, setOffers] = useState<Offer[]>([]);
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
      await load();
    } catch (e: any) {
      setError(e?.message || (isThai ? 'ต่อรองไม่สำเร็จ' : 'Counter failed.'));
    } finally {
      setBusyId(null);
    }
  };

  // Actions available depend on who made the pending row (actor_role) vs. the
  // viewer's role on this offer (viewerRole), matching the server's state machine.
  const renderActions = (o: Offer) => {
    const isViewerActor = o.viewerRole === o.actor_role;
    const busy = busyId === o.id;

    if (o.status === 'accepted') {
      // Only the offer's buyer can pay.
      if (o.viewerRole === 'buyer') {
        return (
          <button
            disabled={busy}
            onClick={() => onPayOffer?.({ offer: o })}
            className="h-9 px-4 bg-brand-green text-brand-darker font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
          >
            {isThai ? `ชำระเงิน ฿${Number(o.amount).toLocaleString()}` : `Pay ฿${Number(o.amount).toLocaleString()}`}
          </button>
        );
      }
      return <span className="text-[10px] text-brand-green font-bold uppercase">{isThai ? 'ตอบรับแล้ว' : 'Accepted'}</span>;
    }

    if (o.status !== 'pending') return null;

    if (isViewerActor) {
      // The viewer made this pending offer — they can only withdraw.
      return (
        <button
          disabled={busy}
          onClick={() => act(o.id, 'withdraw')}
          className="h-9 px-4 bg-white/5 border border-white/10 text-slate-300 font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
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
            className="w-24 h-9 bg-white/5 border border-white/10 rounded-lg px-2 text-white text-sm"
          />
          <button
            disabled={busy}
            onClick={() => submitCounter(o.id)}
            className="h-9 px-3 bg-brand-cyan text-brand-darker font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
          >
            {isThai ? 'ส่ง' : 'Send'}
          </button>
          <button
            onClick={() => { setCounterFor(null); setCounterAmount(''); }}
            className="h-9 px-3 text-slate-400 text-[10px] uppercase"
          >
            {isThai ? 'ยกเลิก' : 'Cancel'}
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <button
          disabled={busy}
          onClick={() => act(o.id, 'accept')}
          className="h-9 px-4 bg-brand-green text-brand-darker font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
        >
          {isThai ? 'ตอบรับ' : 'Accept'}
        </button>
        <button
          disabled={busy}
          onClick={() => { setCounterFor(o.id); setCounterAmount(''); }}
          className="h-9 px-4 bg-brand-cyan/10 border border-brand-cyan/40 text-brand-cyan font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
        >
          {isThai ? 'ต่อรอง' : 'Counter'}
        </button>
        <button
          disabled={busy}
          onClick={() => act(o.id, 'reject')}
          className="h-9 px-4 bg-white/5 border border-white/10 text-slate-300 font-black text-[10px] tracking-widest rounded-lg uppercase disabled:opacity-50"
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
            return (
            <div key={o.id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => { if (canView) onViewListing?.(o); }}
                disabled={!canView}
                className="flex items-center gap-3 min-w-0 flex-1 text-left group disabled:cursor-default"
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
                <div className="min-w-0">
                  <p className={`text-white font-bold truncate ${canView ? 'group-hover:text-brand-cyan transition-colors' : ''}`}>
                    {card?.name || (isThai ? 'การ์ด' : 'Card')}
                  </p>
                  <p className="text-xs text-slate-400">
                    ฿{Number(o.amount).toLocaleString()} ·{' '}
                    <span className="uppercase">{o.viewerRole === 'buyer' ? (isThai ? 'คุณเสนอ' : 'You offered') : (isThai ? 'ผู้ซื้อเสนอ' : 'Buyer offered')}</span>
                    {' · '}
                    <span className="uppercase">{o.status}</span>
                  </p>
                  {o.listing?.price != null && (
                    <p className="text-[11px] text-slate-500">
                      <span className="uppercase tracking-wide">{isThai ? 'ราคาตั้ง' : 'Listed'}</span>{' '}
                      ฿{Number(o.listing.price).toLocaleString()}
                    </p>
                  )}
                </div>
              </button>
              <div className="flex-shrink-0">{renderActions(o)}</div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OffersInbox;
