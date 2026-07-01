'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * Trade Finder (premium).
 *
 * NBA-2K-style trade machine, v1 as a discovery tool: tag cards you'd trade
 * away, share your code/QR, scan a friend's code, and the matcher proposes
 * value-balanced swaps from the overlap of tradables and wishlists. Settling
 * the trade happens between the users — no escrow/shipping in v1.
 *
 * All matching runs server-side (/api/trade/*, premium-gated); this component
 * only renders. Values are Card.marketPrice snapshots in THB.
 */

interface TradeItem {
  itemId: string;
  cardId: string;
  name: string;
  image: string | null;
  value: number;
  quantity: number;
  forTrade?: boolean;
}

interface TradeProposal {
  kind: 'single' | 'balanced' | 'max';
  give: TradeItem[];
  get: TradeItem[];
  giveValue: number;
  getValue: number;
  deltaPct: number;
}

interface MatchResult {
  partner: { displayName: string; avatar: string | null };
  counts: { myTradables: number; theirTradables: number; theyWant: number; youWant: number };
  proposals: TradeProposal[];
}

const baht = (v: number) => `฿${Math.round(v).toLocaleString()}`;

const KIND_LABEL: Record<TradeProposal['kind'], string> = {
  single: 'Even Swap',
  balanced: 'Balanced Bundle',
  max: 'Blockbuster',
};

const ItemRow: React.FC<{ item: TradeItem }> = ({ item }) => (
  <div className="flex items-center gap-3 py-1.5">
    <div className="w-9 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
      {item.image && <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-contain" />}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-white text-xs font-bold truncate">{item.name}</p>
      <p className="text-[10px] text-slate-500">{baht(item.value)}</p>
    </div>
  </div>
);

const ProposalCard: React.FC<{ proposal: TradeProposal; partnerName: string }> = ({ proposal, partnerName }) => {
  const even = proposal.deltaPct <= 0.1;
  const diff = proposal.getValue - proposal.giveValue;
  return (
    <div className="glass rounded-3xl border-white/10 p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[9px] bg-brand-cyan/10 text-brand-cyan font-black uppercase px-2.5 py-1 rounded-full tracking-widest">
          {KIND_LABEL[proposal.kind]}
        </span>
        <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full tracking-widest ${even ? 'bg-emerald-400/10 text-emerald-400' : 'bg-amber-400/10 text-amber-400'}`}>
          {even ? 'Fair Deal' : `${diff > 0 ? '+' : '−'}${baht(Math.abs(diff))} ${diff > 0 ? 'in your favor' : 'their favor'}`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">You send · {baht(proposal.giveValue)}</p>
          {proposal.give.map((i) => <ItemRow key={i.itemId} item={i} />)}
        </div>
        <div className="border-l border-white/5 pl-4">
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">{partnerName} sends · {baht(proposal.getValue)}</p>
          {proposal.get.map((i) => <ItemRow key={i.itemId} item={i} />)}
        </div>
      </div>
    </div>
  );
};

const TradeFinder: React.FC<{ initialCode?: string }> = ({ initialCode }) => {
  const [tab, setTab] = useState<'mine' | 'code' | 'match'>(initialCode ? 'match' : 'mine');

  // My tradables
  const [items, setItems] = useState<TradeItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // My code
  const [myCode, setMyCode] = useState<{ code: string; url: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Match
  const [codeInput, setCodeInput] = useState(initialCode ?? '');
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/trade/items')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Failed to load collection');
        setItems(data.items);
      })
      .catch((e) => setItemsError(e.message));
  }, []);

  useEffect(() => {
    if (tab !== 'code' || myCode) return;
    fetch('/api/trade/code')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Failed to get trade code');
        setMyCode(data);
        const QRCode = (await import('qrcode')).default;
        setQr(await QRCode.toDataURL(data.url, { width: 480, margin: 1, color: { dark: '#0f1419', light: '#ffffff' } }));
      })
      .catch(() => setMyCode(null));
  }, [tab, myCode]);

  const toggle = async (item: TradeItem) => {
    const next = !item.forTrade;
    // Optimistic; revert on failure.
    setItems((prev) => prev?.map((i) => (i.itemId === item.itemId ? { ...i, forTrade: next } : i)) ?? null);
    const res = await fetch('/api/trade/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.itemId, forTrade: next }),
    });
    if (!res.ok) {
      setItems((prev) => prev?.map((i) => (i.itemId === item.itemId ? { ...i, forTrade: !next } : i)) ?? null);
    }
  };

  const runMatch = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setMatching(true);
    setMatchError(null);
    setMatch(null);
    try {
      const res = await fetch(`/api/trade/match?code=${encodeURIComponent(code.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Match failed');
      setMatch(data);
    } catch (e: any) {
      setMatchError(e.message);
    } finally {
      setMatching(false);
    }
  }, []);

  // Deep link: /trade?code=... runs the match immediately.
  useEffect(() => {
    if (initialCode) runMatch(initialCode);
  }, [initialCode, runMatch]);

  const copyCode = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard denied — the code is visible to copy by hand */ }
  };

  const tradableCount = items?.filter((i) => i.forTrade).length ?? 0;

  return (
    <div className="w-full max-w-[520px] mx-auto">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-4">
          <i className="fa-solid fa-right-left text-brand-cyan text-xl"></i>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight uppercase italic skew-x-[-10deg]">Trade Finder</h2>
        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">Scan a code · Match by value · Make the deal</p>
      </div>

      <div className="flex gap-2 mb-6">
        {([['mine', 'My Cards'], ['code', 'My Code'], ['match', 'Find Trades']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 h-11 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${tab === key ? 'bg-brand-cyan text-brand-darker' : 'glass border-white/10 text-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'mine' && (
        <div>
          <p className="text-[11px] text-slate-500 mb-4 text-center">
            Toggle the cards you'd trade away. <span className="text-brand-cyan font-bold">{tradableCount}</span> up for trade.
          </p>
          {itemsError && <p className="text-[11px] text-rose-300 text-center mb-3">{itemsError}</p>}
          {items === null && !itemsError && (
            <div className="text-center py-10"><i className="fa-solid fa-circle-notch animate-spin text-brand-cyan"></i></div>
          )}
          {items?.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-8">Your collection is empty — scan some cards first.</p>
          )}
          <div className="space-y-2">
            {items?.map((item) => (
              <button
                key={item.itemId}
                onClick={() => toggle(item)}
                className="w-full glass rounded-2xl border-white/5 px-4 py-2.5 flex items-center gap-3 text-left active:scale-[0.98] transition-all"
              >
                <div className="w-9 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                  {item.image && <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-contain" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-bold truncate">{item.name}</p>
                  <p className="text-[10px] text-slate-500">{baht(item.value)}{item.quantity > 1 ? ` · x${item.quantity}` : ''}</p>
                </div>
                <div className={`w-11 h-6 rounded-full p-0.5 transition-colors ${item.forTrade ? 'bg-brand-cyan' : 'bg-white/10'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white transition-transform ${item.forTrade ? 'translate-x-5' : ''}`} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'code' && (
        <div className="glass rounded-[2rem] border-white/10 p-7 text-center">
          {!myCode ? (
            <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-xl"></i>
          ) : (
            <>
              {qr && (
                <div className="w-52 h-52 mx-auto rounded-3xl overflow-hidden bg-white p-3 mb-5">
                  <img src={qr} alt="Trade QR code" className="w-full h-full" />
                </div>
              )}
              <p className="text-2xl font-black text-white tracking-[0.2em]">{myCode.code}</p>
              <p className="text-[11px] text-slate-500 mt-2 leading-snug">
                Friends scan this (or enter the code) to see trades matched against your tradables and wishlist.
              </p>
              <button
                onClick={copyCode}
                className="mt-5 w-full h-12 rounded-2xl glass border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                <i className={`fa-solid ${copied ? 'fa-check text-emerald-400' : 'fa-copy'} mr-2`}></i>
                {copied ? 'Copied' : 'Copy Link'}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'match' && (
        <div>
          <div className="flex gap-2 mb-5">
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="TR-XXXXXX"
              className="flex-1 h-12 px-4 bg-white/5 border border-white/10 rounded-2xl focus:border-brand-cyan/50 outline-none text-sm font-bold text-white tracking-widest placeholder:text-slate-600 transition-all"
            />
            <button
              onClick={() => runMatch(codeInput)}
              disabled={matching || !codeInput.trim()}
              className="px-6 h-12 rounded-2xl bg-brand-cyan text-brand-darker font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
            >
              {matching ? <i className="fa-solid fa-circle-notch animate-spin"></i> : 'Match'}
            </button>
          </div>

          {matchError && (
            <div className="flex items-start gap-2 rounded-2xl bg-rose-500/10 border border-rose-500/20 p-3 mb-4">
              <i className="fa-solid fa-triangle-exclamation text-rose-400 text-xs mt-0.5"></i>
              <p className="text-[11px] text-rose-200/90 leading-snug">{matchError}</p>
            </div>
          )}

          {match && (
            <div className="space-y-4">
              <div className="glass rounded-3xl border-white/10 p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-full overflow-hidden bg-white/5 flex-shrink-0">
                  {match.partner.avatar
                    ? <img src={match.partner.avatar} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><i className="fa-solid fa-user text-slate-600"></i></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold truncate">{match.partner.displayName}</p>
                  <p className="text-[10px] text-slate-500">
                    They want <span className="text-brand-cyan font-bold">{match.counts.theyWant}</span> of your cards · You want <span className="text-brand-cyan font-bold">{match.counts.youWant}</span> of theirs
                  </p>
                </div>
              </div>

              {match.proposals.length > 0 ? (
                match.proposals.map((p, i) => (
                  <ProposalCard key={`${p.kind}-${i}`} proposal={p} partnerName={match.partner.displayName} />
                ))
              ) : (
                <div className="glass rounded-3xl border-white/10 p-6 text-center">
                  <p className="text-sm text-slate-300 font-bold">No matching trades yet</p>
                  <p className="text-[11px] text-slate-500 mt-2 leading-snug">
                    A match needs overlap both ways: cards on your trade list that they've wishlisted, and cards on theirs that you've wishlisted.
                    {match.counts.myTradables === 0 && ' You haven’t tagged any cards for trade yet.'}
                    {match.counts.theirTradables === 0 && ' They haven’t tagged any cards for trade yet.'}
                  </p>
                </div>
              )}

              <p className="text-[10px] text-slate-600 text-center leading-snug px-4">
                Values are market estimates. CardStreet doesn't broker the swap — agree on the details together.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TradeFinder;
