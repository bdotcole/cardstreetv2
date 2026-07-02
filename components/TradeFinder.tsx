'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * Trade Finder (premium) — built for in-person trading.
 *
 * Two users at a card show mark cards for trade; one scans the other's
 * QR/code and gets at least five value-balanced offers built from the FULL
 * trade lists (no wishlist gating — wishlist hits are just badges):
 *
 *   even mode    "what would be a fair trade between our binders?"
 *   target mode  "you want my Card 1 (~B900)? Here's what you could give" —
 *                pick any card from your collection, scan their code, get
 *                singles and 2-4-card combos from their trade list at ~B900.
 *
 * Offers are refinable: every card row carries its market snapshot and an X.
 * Declining a card excludes it from ALL matching (single-card offers collapse
 * — that IS declining the trade); refresh tops edited offers back up with
 * replacements where a close-value one exists, otherwise builds fresh offers.
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
  wanted?: boolean;
  condition?: string | null;
  set?: string | null;
  rarity?: string | null;
  change7d?: number | null;
}

interface TradeOffer {
  kind: 'single' | 'combo' | 'bundle';
  give: TradeItem[];
  get: TradeItem[];
  giveValue: number;
  getValue: number;
  deltaPct: number;
}

interface MatchResult {
  mode: 'even' | 'target';
  partner: { displayName: string; avatar: string | null };
  anchor?: TradeItem;
  counts: { myTradables?: number; theirTradables: number };
  offers: TradeOffer[];
}

const baht = (v: number) => `฿${Math.round(v).toLocaleString()}`;

const CardThumb: React.FC<{ item: TradeItem }> = ({ item }) => (
  <div className="w-9 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
    {item.image && <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-contain" />}
  </div>
);

const TradeFinder: React.FC<{ initialCode?: string }> = ({ initialCode }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'mine' | 'code' | 'match'>(initialCode ? 'match' : 'mine');

  // My collection (all items — tradable toggling + target-card picking)
  const [items, setItems] = useState<TradeItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // My code
  const [myCode, setMyCode] = useState<{ code: string; url: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Match
  const [codeInput, setCodeInput] = useState(initialCode ?? '');
  const [anchor, setAnchor] = useState<TradeItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  // Refinement: declined cards, per side, persist across refresh rounds.
  const [declinedMine, setDeclinedMine] = useState<Set<string>>(new Set());
  const [declinedTheirs, setDeclinedTheirs] = useState<Set<string>>(new Set());

  const KIND_LABEL: Record<TradeOffer['kind'], string> = {
    single: t('pro.trade.kindSingle'),
    combo: t('pro.trade.kindCombo'),
    bundle: t('pro.trade.kindBundle'),
  };

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

  const resetDeclines = () => {
    setDeclinedMine(new Set());
    setDeclinedTheirs(new Set());
  };

  const runMatch = useCallback(async (code: string, anchorItem: TradeItem | null) => {
    if (!code.trim()) return;
    setMatching(true);
    setMatchError(null);
    setMatch(null);
    resetDeclines();
    try {
      const anchorParam = anchorItem ? `&itemId=${encodeURIComponent(anchorItem.itemId)}` : '';
      const res = await fetch(`/api/trade/match?code=${encodeURIComponent(code.trim())}${anchorParam}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Match failed');
      setMatch(data);
    } catch (e: any) {
      setMatchError(e.message);
    } finally {
      setMatching(false);
    }
  }, []);

  // Refinement round: declined cards excluded everywhere; edited offers'
  // surviving cards ride along as `keeps` for replacement-completion.
  const refreshOffers = useCallback(async () => {
    if (!match || !codeInput.trim()) return;
    setMatching(true);
    setMatchError(null);
    try {
      const keeps = match.offers
        .filter((o) =>
          o.give.some((i) => declinedMine.has(i.itemId)) || o.get.some((i) => declinedTheirs.has(i.itemId)))
        .map((o) => ({
          give: o.give.filter((i) => !declinedMine.has(i.itemId)).map((i) => i.itemId),
          get: o.get.filter((i) => !declinedTheirs.has(i.itemId)).map((i) => i.itemId),
        }))
        .filter((k) => k.give.length > 0 && k.get.length > 0);

      const res = await fetch('/api/trade/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: codeInput.trim(),
          itemId: match.mode === 'target' ? match.anchor?.itemId : undefined,
          excludeMine: [...declinedMine],
          excludeTheirs: [...declinedTheirs],
          keeps,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Refresh failed');
      setMatch(data);
    } catch (e: any) {
      setMatchError(e.message);
    } finally {
      setMatching(false);
    }
  }, [match, codeInput, declinedMine, declinedTheirs]);

  const decline = (item: TradeItem, mineSide: boolean) => {
    if (mineSide) {
      setDeclinedMine((prev) => new Set(prev).add(item.itemId));
    } else {
      setDeclinedTheirs((prev) => new Set(prev).add(item.itemId));
    }
  };

  // Deep link: /trade?code=... runs an even-mode match immediately.
  useEffect(() => {
    if (initialCode) runMatch(initialCode, null);
  }, [initialCode, runMatch]);

  const targetFromMyCards = (item: TradeItem) => {
    setAnchor(item);
    setMatch(null);
    resetDeclines();
    setTab('match');
  };

  const copyCode = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard denied — the code is visible to copy by hand */ }
  };

  const tradableCount = items?.filter((i) => i.forTrade).length ?? 0;
  const declinedCount = declinedMine.size + declinedTheirs.size;

  const pickerItems = useMemo(() => {
    if (!items) return [];
    const q = pickerQuery.trim().toLowerCase();
    const pool = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
    return pool.slice(0, 30);
  }, [items, pickerQuery]);

  const WantedBadge: React.FC<{ mine: boolean }> = ({ mine }) => (
    <span className="text-[8px] bg-amber-400/10 text-amber-300 font-black uppercase px-1.5 py-0.5 rounded-full tracking-widest whitespace-nowrap">
      <i className="fa-solid fa-star mr-1"></i>
      {mine ? t('pro.trade.theyWantBadge') : t('pro.trade.youWantBadge')}
    </span>
  );

  // Offer row with market snapshot (value, set, condition, 7d change) and the
  // decline X. Declined cards stay visible struck-through until refresh.
  const OfferRow: React.FC<{ item: TradeItem; mineSide: boolean }> = ({ item, mineSide }) => {
    const declined = mineSide ? declinedMine.has(item.itemId) : declinedTheirs.has(item.itemId);
    const meta = [item.set, item.condition].filter(Boolean).join(' · ');
    return (
      <div className={`flex items-start gap-3 py-1.5 transition-opacity ${declined ? 'opacity-40' : ''}`}>
        <CardThumb item={item} />
        <div className="flex-1 min-w-0">
          <p className={`text-white text-xs font-bold truncate ${declined ? 'line-through' : ''}`}>{item.name}</p>
          {meta && <p className="text-[9px] text-slate-600 truncate">{meta}</p>}
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`text-[10px] text-slate-400 font-bold ${declined ? 'line-through' : ''}`}>{baht(item.value)}</p>
            {typeof item.change7d === 'number' && item.change7d !== 0 && (
              <span className={`text-[9px] font-black ${item.change7d > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {item.change7d > 0 ? '▲' : '▼'}{Math.abs(item.change7d).toFixed(1)}%
              </span>
            )}
            {item.wanted && !declined && <WantedBadge mine={mineSide} />}
          </div>
        </div>
        {!declined && (
          <button
            onClick={() => decline(item, mineSide)}
            aria-label={`${t('pro.trade.removeCard')}: ${item.name}`}
            title={t('pro.trade.removeCard')}
            className="w-6 h-6 rounded-lg bg-white/5 hover:bg-rose-500/20 flex items-center justify-center text-slate-600 hover:text-rose-300 active:scale-90 transition-all flex-shrink-0"
          >
            <i className="fa-solid fa-xmark text-[10px]"></i>
          </button>
        )}
      </div>
    );
  };

  const OfferCard: React.FC<{ offer: TradeOffer; partnerName: string }> = ({ offer, partnerName }) => {
    const even = offer.deltaPct <= 0.1;
    const diff = offer.getValue - offer.giveValue;
    const fullyDeclined =
      offer.give.every((i) => declinedMine.has(i.itemId)) || offer.get.every((i) => declinedTheirs.has(i.itemId));
    return (
      <div className={`glass rounded-3xl border-white/10 p-5 transition-opacity ${fullyDeclined ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-[9px] bg-brand-cyan/10 text-brand-cyan font-black uppercase px-2.5 py-1 rounded-full tracking-widest">
            {KIND_LABEL[offer.kind]}
          </span>
          <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full tracking-widest ${even ? 'bg-emerald-400/10 text-emerald-400' : 'bg-amber-400/10 text-amber-400'}`}>
            {even ? t('pro.trade.fairDeal') : `${diff > 0 ? '+' : '−'}${baht(Math.abs(diff))} ${diff > 0 ? t('pro.trade.inYourFavor') : t('pro.trade.theirFavor')}`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">{t('pro.trade.youSend')} · {baht(offer.giveValue)}</p>
            {offer.give.map((i) => <OfferRow key={i.itemId} item={i} mineSide />)}
          </div>
          <div className="border-l border-white/5 pl-4">
            <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">{partnerName} {t('pro.trade.sends')} · {baht(offer.getValue)}</p>
            {offer.get.map((i) => <OfferRow key={i.itemId} item={i} mineSide={false} />)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-[520px] mx-auto">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-4">
          <i className="fa-solid fa-right-left text-brand-cyan text-xl"></i>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight uppercase italic skew-x-[-10deg]">{t('pro.tradeTitle')}</h2>
        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">{t('pro.trade.tagline')}</p>
      </div>

      <div className="flex gap-2 mb-6">
        {([['mine', t('pro.trade.tabMine')], ['code', t('pro.trade.tabCode')], ['match', t('pro.trade.tabFind')]] as const).map(([key, label]) => (
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
            {t('pro.trade.toggleHint')} <span className="text-brand-cyan font-bold">{tradableCount}</span> {t('pro.trade.upForTrade')}
          </p>
          {itemsError && <p className="text-[11px] text-rose-300 text-center mb-3">{itemsError}</p>}
          {items === null && !itemsError && (
            <div className="text-center py-10"><i className="fa-solid fa-circle-notch animate-spin text-brand-cyan"></i></div>
          )}
          {items?.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-8">{t('pro.trade.emptyCollection')}</p>
          )}
          <div className="space-y-2">
            {items?.map((item) => (
              <div key={item.itemId} className="w-full glass rounded-2xl border-white/5 px-4 py-2.5 flex items-center gap-3">
                <CardThumb item={item} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-bold truncate">{item.name}</p>
                  <p className="text-[10px] text-slate-500">{baht(item.value)}{item.quantity > 1 ? ` · x${item.quantity}` : ''}</p>
                </div>
                <button
                  onClick={() => targetFromMyCards(item)}
                  aria-label={`${t('pro.trade.tradingFor')} ${item.name}`}
                  className="w-9 h-9 rounded-xl glass border-white/10 flex items-center justify-center text-slate-400 hover:text-brand-cyan active:scale-90 transition-all"
                >
                  <i className="fa-solid fa-crosshairs text-sm"></i>
                </button>
                <button
                  onClick={() => toggle(item)}
                  aria-label={item.name}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${item.forTrade ? 'bg-brand-cyan' : 'bg-white/10'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white transition-transform ${item.forTrade ? 'translate-x-5' : ''}`} />
                </button>
              </div>
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
              <p className="text-[11px] text-slate-500 mt-2 leading-snug">{t('pro.trade.codeHint')}</p>
              <button
                onClick={copyCode}
                className="mt-5 w-full h-12 rounded-2xl glass border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                <i className={`fa-solid ${copied ? 'fa-check text-emerald-400' : 'fa-copy'} mr-2`}></i>
                {copied ? t('pro.trade.copied') : t('pro.trade.copyLink')}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'match' && (
        <div>
          {/* Target-card selector: offers match this card's value instead of the whole binder. */}
          <div className="glass rounded-2xl border-white/10 p-3 mb-3">
            {anchor ? (
              <div className="flex items-center gap-3">
                <CardThumb item={anchor} />
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{t('pro.trade.tradingFor')}</p>
                  <p className="text-white text-xs font-bold truncate">{anchor.name} · {baht(anchor.value)}</p>
                </div>
                <button
                  onClick={() => { setAnchor(null); setMatch(null); resetDeclines(); }}
                  className="px-3 h-9 rounded-xl glass border-white/10 text-slate-400 text-[9px] font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  {t('pro.trade.clearTarget')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setPickerOpen((o) => !o)}
                className="w-full flex items-center justify-between text-left"
              >
                <span className="text-[11px] text-slate-400 font-bold">
                  <i className="fa-solid fa-crosshairs mr-2 text-brand-cyan"></i>
                  {t('pro.trade.findForCard')}
                </span>
                <span className="text-[9px] text-brand-cyan font-black uppercase tracking-widest">{t('pro.trade.chooseCard')}</span>
              </button>
            )}
            {pickerOpen && !anchor && (
              <div className="mt-3 border-t border-white/5 pt-3">
                <input
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder={t('pro.trade.searchCollection')}
                  className="w-full h-10 px-3 bg-white/5 border border-white/10 rounded-xl focus:border-brand-cyan/50 outline-none text-xs text-white placeholder:text-slate-600 transition-all mb-2"
                />
                <div className="max-h-56 overflow-y-auto space-y-1 scrollbar-hide">
                  {pickerItems.map((item) => (
                    <button
                      key={item.itemId}
                      onClick={() => { setAnchor(item); setPickerOpen(false); setMatch(null); resetDeclines(); }}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-white/5 text-left transition-colors"
                    >
                      <CardThumb item={item} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-bold truncate">{item.name}</p>
                        <p className="text-[10px] text-slate-500">{baht(item.value)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 mb-5">
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="TR-XXXXXX"
              className="flex-1 h-12 px-4 bg-white/5 border border-white/10 rounded-2xl focus:border-brand-cyan/50 outline-none text-sm font-bold text-white tracking-widest placeholder:text-slate-600 transition-all"
            />
            <button
              onClick={() => runMatch(codeInput, anchor)}
              disabled={matching || !codeInput.trim()}
              className="px-6 h-12 rounded-2xl bg-brand-cyan text-brand-darker font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
            >
              {matching ? <i className="fa-solid fa-circle-notch animate-spin"></i> : t('pro.trade.match')}
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
                    {match.mode === 'even' && (
                      <>{t('pro.trade.you')}: <span className="text-brand-cyan font-bold">{match.counts.myTradables ?? 0}</span> {t('pro.trade.forTradeShort')} · {match.partner.displayName}: <span className="text-brand-cyan font-bold">{match.counts.theirTradables}</span> {t('pro.trade.forTradeShort')}</>
                    )}
                    {match.mode === 'target' && match.anchor && (
                      <>{t('pro.trade.tradingFor')} <span className="text-brand-cyan font-bold">{match.anchor.name}</span> · {baht(match.anchor.value)}</>
                    )}
                  </p>
                </div>
              </div>

              {declinedCount > 0 && (
                <div className="glass rounded-2xl border-brand-cyan/20 p-3 flex items-center gap-3">
                  <p className="flex-1 text-[11px] text-slate-400 leading-snug">
                    <span className="text-white font-bold">{declinedCount}</span> {t('pro.trade.removedCards')}
                    <button onClick={resetDeclines} className="ml-2 text-brand-cyan text-[10px] font-black uppercase tracking-widest">
                      {t('pro.trade.resetRemoved')}
                    </button>
                  </p>
                  <button
                    onClick={refreshOffers}
                    disabled={matching}
                    className="px-4 h-10 rounded-xl bg-brand-cyan text-brand-darker font-black text-[9px] uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40 whitespace-nowrap"
                  >
                    {matching ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <><i className="fa-solid fa-rotate mr-1.5"></i>{t('pro.trade.refreshOffers')}</>}
                  </button>
                </div>
              )}

              {match.offers.length > 0 ? (
                <>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest text-center">
                    {t('pro.trade.offersTitle')} · {match.offers.length}
                  </p>
                  {match.offers.map((o, i) => (
                    <OfferCard key={`${o.kind}-${i}`} offer={o} partnerName={match.partner.displayName} />
                  ))}
                </>
              ) : (
                <div className="glass rounded-3xl border-white/10 p-6 text-center">
                  <p className="text-sm text-slate-300 font-bold">{t('pro.trade.noMatchesTitle')}</p>
                  <p className="text-[11px] text-slate-500 mt-2 leading-snug">
                    {t('pro.trade.noMatchesBody')}
                    {match.mode === 'even' && (match.counts.myTradables ?? 0) === 0 && ` ${t('pro.trade.youNoTradables')}`}
                    {match.counts.theirTradables === 0 && ` ${t('pro.trade.theyNoTradables')}`}
                  </p>
                </div>
              )}

              <p className="text-[10px] text-slate-600 text-center leading-snug px-4">
                {t('pro.trade.valuesFootnote')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TradeFinder;
