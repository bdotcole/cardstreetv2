import React, { useState, useMemo, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { CustomCollection, Card, UserCollectionItem } from '../types';
import { COLLECTION_FOLDERS, MOCK_CARDS } from '../constants';
import ListingForm from './ListingForm';
import MasterSetPicker from './MasterSetPicker';
import GamePicker from './GamePicker';
import SetBrowser from './SetBrowser';
import MasterSetDetail from './MasterSetDetail';
import { gameHasMultipleLanguages } from '@/lib/games';
import { ApiSet } from '../services/pokemonService';
import CardDetails from './CardDetails';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import Image from 'next/image';
import { getThumbnailUrl, getPreviewUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';

// recharts is ~100KB. Defer until the chart actually renders.
const PriceChart = dynamic(() => import('./PriceChart'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-64 rounded-lg bg-brand-darker/40 animate-pulse" />
    ),
});

interface VaultProps {
  customCollections: CustomCollection[];
  wishlist: Card[];
  onUpdateCollections: (collections: CustomCollection[]) => void;
  onAddToCollection: (card: Card) => void;
  onToggleWishlist: (card: Card) => void;
  onListCard: (colId: string, item: UserCollectionItem, card: Card) => void;
  onRemoveListing: (colId: string, item: UserCollectionItem, card: Card) => void | Promise<void>;
  onUpdateListingPrice: (colId: string, item: UserCollectionItem, card: Card, price: number) => Promise<void>;
  listingTarget: { colId: string, item: UserCollectionItem, card: Card } | null;
  onCancelListing: () => void;
  onPublishListing: (data: any) => void;
  activeListings?: any[];
  totalValue: number;
  currencySymbol: string;
  currency: string;
  exchangeRate: number;
  onRemoveFromCollection?: (collectionId: string, itemId: string) => Promise<void>;
}

type VaultView = 'folders' | 'wishlist' | 'listings' | 'collections' | 'master-game' | 'master' | 'sets' | 'set-detail';
type SortOption = 'date_desc' | 'date_asc' | 'price_desc' | 'price_asc' | 'name_asc';

const Vault: React.FC<VaultProps> = ({
  customCollections,
  wishlist,
  onUpdateCollections,
  onAddToCollection,
  onToggleWishlist,
  onListCard,
  onRemoveListing,
  onUpdateListingPrice,
  listingTarget,
  onCancelListing,
  onPublishListing,
  activeListings = [],
  totalValue,
  currencySymbol,
  currency,
  exchangeRate,
  onRemoveFromCollection
}) => {
  const { t, isThai } = useTranslation();
  const { showToast } = useToast();
  const [view, setView] = useState<VaultView>('folders');
  const [selectedGame, setSelectedGame] = useState<string>('pokemon');
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [selectedSet, setSelectedSet] = useState<ApiSet | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'jp' | 'th'>('en');
  const [isSelectingForListing, setIsSelectingForListing] = useState(false);
  // Inline quick price edit on an active listing (one at a time, keyed by item id)
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const [timeframe, setTimeframe] = useState('1M');
  const [chartData, setChartData] = useState<{ date: string; price: number }[]>([]);
  const [isLoadingChart, setIsLoadingChart] = useState(true);

  // Fetch real portfolio history from API
  useEffect(() => {
    const fetchPortfolioHistory = async () => {
      setIsLoadingChart(true);
      try {
        // Add timestamp to bypass cache
        const timestamp = new Date().getTime();
        console.log('[Vault] Fetching portfolio data:', { timeframe, timestamp });
        const response = await fetch(`/api/portfolio/history?range=${timeframe}&t=${timestamp}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });
        const result = await response.json();
        console.log('[Vault] API Response:', result);

        if (result.success && result.data) {
          // Transform API response to chart format with proper labels
          const formattedData = result.data.map((point: any, index: number) => {
            const dateObj = new Date(point.date);
            let label = '';

            if (timeframe === '1D') {
              label = index % 6 === 0 ? `${dateObj.getHours()}h` : '';
            } else if (timeframe === '1W') {
              const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              label = dayNames[dateObj.getDay()];
            } else if (timeframe === '1M') {
              label = index % 5 === 0 ? `${dateObj.getDate()}` : '';
            } else {
              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              label = monthNames[dateObj.getMonth()];
            }

            return {
              date: label,
              price: point.value
            };
          });

          console.log('[Vault] Setting chart data:', {
            points: formattedData.length,
            firstPrice: formattedData[0]?.price,
            lastPrice: formattedData[formattedData.length - 1]?.price,
            sample: formattedData.slice(0, 3)
          });

          setChartData(formattedData);
        } else {
          // Fallback to empty data or show error
          console.error('Failed to fetch portfolio history:', result.error);
          setChartData([]);
        }
      } catch (error) {
        console.error('Error fetching portfolio history:', error);
        setChartData([]);
      } finally {
        setIsLoadingChart(false);
      }
    };

    fetchPortfolioHistory();
  }, [timeframe]);

  // Calculate percentage change based on chart data
  const percentageChange = useMemo(() => {
    console.log('[Vault] Calculating percentage, chartData length:', chartData.length);
    if (chartData.length < 2) {
      console.log('[Vault] Not enough data points');
      return 0;
    }
    const firstPrice = chartData[0].price;
    const lastPrice = chartData[chartData.length - 1].price;
    console.log('[Vault] Percentage calc:', { firstPrice, lastPrice, dataPoints: chartData.length });
    if (firstPrice === 0) {
      console.log('[Vault] First price is zero');
      return 0;
    }
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;
    console.log('[Vault] Calculated percentage:', change.toFixed(2) + '%');
    return change;
  }, [chartData]);

  // Card Details Popup State
  const [viewingCard, setViewingCard] = useState<Card | null>(null);
  const [viewingItem, setViewingItem] = useState<{ colId: string, item: UserCollectionItem } | null>(null);

  // Collection View State
  const [collectionSearchQuery, setCollectionSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('date_desc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Hardware back inside the Vault. The page shell owns the single Capacitor
  // backButton listener and dispatches a cancelable 'vault-back' event while
  // this tab is active. Consume it (preventDefault) when there is an overlay
  // to close or a sub-view to step out of — a card open from a collection
  // must land back in that collection, not at the Vault root — and leave it
  // unconsumed at the root so the shell's tab fallback runs.
  useEffect(() => {
    const handleBack = (event: Event) => {
      const consume = (step: () => void) => { event.preventDefault(); step(); };

      if (viewingCard) return consume(() => { setViewingCard(null); setViewingItem(null); });
      if (listingTarget) return consume(() => onCancelListing());
      if (isSelectingForListing) return consume(() => setIsSelectingForListing(false));
      if (view === 'set-detail') return consume(() => setView('sets'));
      if (view === 'sets') return consume(() => setView(gameHasMultipleLanguages(selectedGame) ? 'master' : 'master-game'));
      if (view === 'master') return consume(() => setView('master-game'));
      if (view !== 'folders') return consume(() => setView('folders'));
      // At the Vault root — leave unconsumed, the shell decides.
    };

    window.addEventListener('vault-back', handleBack);
    return () => window.removeEventListener('vault-back', handleBack);
  }, [view, selectedGame, viewingCard, listingTarget, isSelectingForListing, onCancelListing]);

  // Close sort menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setIsSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close sort menu when clicking outside

  // Flatten all owned card IDs for fast lookup in Master Set view
  const ownedCardIds = useMemo(() => {
    const ids = new Set<string>();
    customCollections.forEach(col => {
      col.items.forEach(item => {
        if (item.quantity > 0) {
          ids.add(item.cardId);
        }
      });
    });
    return ids;
  }, [customCollections]);

  // Create wishlist card IDs Set for fast lookup
  const wishlistCardIds = useMemo(() => new Set(wishlist.map(card => card.id)), [wishlist]);

  const myVaultListings = useMemo(() => {
    const list: { colId: string, item: UserCollectionItem, card: Card }[] = [];
    customCollections.forEach(col => {
      col.items.forEach(item => {
        if (item.isListing) {
          const card = item.card || MOCK_CARDS.find(c => c.id === item.cardId);
          if (card) list.push({ colId: col.id, item, card });
        }
      });
    });
    return list;
  }, [customCollections]);

  // Combined flat list of all cards in collection
  const allVaultItems = useMemo(() => {
    const list: { colId: string, item: UserCollectionItem, card: Card }[] = [];
    customCollections.forEach(col => {
      col.items.forEach(item => {
        const card = item.card || MOCK_CARDS.find(c => c.id === item.cardId);
        if (card) list.push({ colId: col.id, item, card });
      });
    });
    return list;
  }, [customCollections]);

  // Filter and Sort Items
  const processedItems = useMemo(() => {
    const q = collectionSearchQuery.toLowerCase();
    const filtered = allVaultItems.filter(({ card }) => {
      return (
        card.name.toLowerCase().includes(q) ||
        card.set.toLowerCase().includes(q) ||
        card.number.includes(q)
      );
    });

    return filtered.sort((a, b) => {
      switch (sortOption) {
        case 'name_asc':
          return a.card.name.localeCompare(b.card.name);
        case 'price_desc':
          return b.card.marketPrice - a.card.marketPrice;
        case 'price_asc':
          return a.card.marketPrice - b.card.marketPrice;
        case 'date_asc':
          return new Date(a.item.addedAt).getTime() - new Date(b.item.addedAt).getTime();
        case 'date_desc':
        default:
          return new Date(b.item.addedAt).getTime() - new Date(a.item.addedAt).getTime();
      }
    });
  }, [allVaultItems, collectionSearchQuery, sortOption]);

  const handleRemoveCard = async (e: React.MouseEvent, colId: string, itemId: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to remove this card from your collection?")) {
      if (onRemoveFromCollection) {
        try {
          await onRemoveFromCollection(colId, itemId);
          showToast('Card removed successfully.', 'success');
        } catch (error: any) {
          console.error('Failed to remove card:', error);
          const detail = error?.message ? `: ${error.message}` : '';
          showToast(`Couldn't remove the card${detail}. Try refreshing your Vault.`, 'error');
        }
      } else {
        // Fallback for legacy
        const col = customCollections.find(c => c.id === colId);
        if (col) {
          const updatedItems = col.items.filter(item => item.id !== itemId);
          onUpdateCollections(customCollections.map(c => c.id === colId ? { ...c, items: updatedItems } : c));
        }
      }
    }
  };

  const getSortLabel = () => {
    switch (sortOption) {
      case 'price_desc': return isThai ? 'ราคา (สูง-ต่ำ)' : 'Price (High-Low)';
      case 'price_asc': return isThai ? 'ราคา (ต่ำ-สูง)' : 'Price (Low-High)';
      case 'name_asc': return isThai ? 'ชื่อ (ก-ฮ)' : 'Name (A-Z)';
      default: return isThai ? 'วางขายล่าสุด' : 'Recently Added';
    }
  };

  const renderFolders = () => (
    <div className="space-y-4 animate-fadeIn pb-24">
      {/* Portfolio Header */}
      <div className="pt-4 relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-brand-cyan to-brand-green opacity-20 blur-3xl rounded-full"></div>

        <div className="flex justify-between items-end mb-1 px-2">
          <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg]">{t('vault.myPortfolio')}</p>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${percentageChange >= 0 ? 'bg-brand-green/10 border-brand-green/20' : 'bg-brand-red/10 border-brand-red/20'}`}>
            <i className={`fa-solid ${percentageChange >= 0 ? 'fa-arrow-trend-up text-brand-green' : 'fa-arrow-trend-down text-brand-red'} text-[10px]`}></i>
            <span className={`${percentageChange >= 0 ? 'text-brand-green' : 'text-brand-red'} text-[10px] font-black`}>
              {percentageChange >= 0 ? '+' : ''}{percentageChange.toFixed(1)}%
            </span>
          </div>
        </div>

        <h2 className="px-2 text-5xl font-black text-white tracking-tighter leading-none italic skew-x-[-6deg] drop-shadow-lg mb-4">
          {currencySymbol}{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </h2>

        {/* Chart Card */}
        <div className="glass-panel rounded-2xl p-0.5 border-brand-cyan/20 overflow-hidden shadow-2xl mb-6 mx-1">
          <div className="bg-[#0f172a] rounded-2xl p-4">
            <div className="flex justify-start items-center mb-4 gap-2">
              {['1D', '1W', '1M', '1Y'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeframe(t)}
                  className={`px-3 py-1 rounded-md text-[10px] font-black tracking-widest transition-all skew-x-[-10deg] ${timeframe === t ? 'bg-brand-cyan text-brand-darker' : 'text-slate-600 hover:text-slate-300 bg-white/5'
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="h-40">
              <PriceChart data={chartData} />
            </div>
          </div>
        </div>

        {/* Folders */}
        <div className="grid grid-cols-2 gap-4">
          {COLLECTION_FOLDERS.map((folder) => {
            let count = 0;
            let iconColor = 'text-slate-500';

            if (folder.id === 'wishlist') {
              count = wishlist.length;
              iconColor = 'text-brand-red';
            } else if (folder.id === 'listings') {
              count = myVaultListings.length;
              iconColor = 'text-brand-cyan';
            } else if (folder.id === 'collections') {
              count = allVaultItems.length;
              iconColor = 'text-brand-green';
            } else {
              count = folder.count;
            }

            const targetView = folder.id === 'collections' ? 'collections'
              : folder.id === 'master' ? 'master-game'
              : folder.id as VaultView;

            return (
              <div
                key={folder.id}
                onClick={() => setView(targetView)}
                className="glass p-5 rounded-[2rem] border-white/5 active:scale-95 transition-all group cursor-pointer hover:border-brand-cyan/20"
              >
                <div className="w-12 h-12 rounded-2xl glass border-white/10 flex items-center justify-center mb-3 group-hover:border-white/20 transition-colors">
                  <i className={`fa-solid ${folder.icon} ${iconColor} group-hover:scale-110 transition-transform`}></i>
                </div>
                <h4 className="text-white text-sm font-bold tracking-tight mb-1">
                  {folder.id === 'collections' ? t('vault.collection') :
                    folder.id === 'listings' ? t('vault.listings') :
                      folder.id === 'wishlist' ? t('vault.wishlist') :
                        folder.id === 'master' ? t('vault.masterSets') : folder.name}
                </h4>
                <p className="text-[9px] text-slate-600 font-black uppercase tracking-widest">{count} {t('vault.items')}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // Listing/market amounts are stored in THB; convert for display the same
  // way the Marketplace grid does (exchangeRate is 1 when displaying THB).
  const formatDisplayPrice = (thb: number) => {
    const v = (thb || 0) * exchangeRate;
    return `${currencySymbol}${v < 1 ? v.toFixed(2) : Math.round(v).toLocaleString()}`;
  };

  const startPriceEdit = (item: UserCollectionItem) => {
    setPriceDraft(item.listingPrice != null ? String(item.listingPrice) : '');
    setEditingPriceItemId(item.id);
  };

  const draftPrice = parseFloat(priceDraft);
  // Mirror the bounds enforced by /api/listings' zod schema.
  const isPriceDraftValid = Number.isFinite(draftPrice) && draftPrice > 0 && draftPrice <= 10_000_000;

  const savePriceEdit = async (colId: string, item: UserCollectionItem, card: Card) => {
    if (!isPriceDraftValid || isSavingPrice) return;
    if (draftPrice === item.listingPrice) {
      setEditingPriceItemId(null);
      return;
    }
    setIsSavingPrice(true);
    try {
      await onUpdateListingPrice(colId, item, card, draftPrice);
      setEditingPriceItemId(null);
    } catch {
      // The page shell already toasts the failure; keep the editor open for retry.
    } finally {
      setIsSavingPrice(false);
    }
  };

  const renderListings = () => (
    <div className="space-y-6 animate-fadeIn pb-20">
      <div className="flex justify-between items-center pt-4 gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => setView('folders')} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </button>
          <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{isThai ? 'กำลังประกาศขาย' : 'Active Listings'}</h3>
        </div>
        {/* Toggles the asset picker; reads as Cancel while it's open so the
            button is never a silent no-op. */}
        <button
          onClick={() => setIsSelectingForListing(!isSelectingForListing)}
          className={`px-6 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all whitespace-nowrap ${isSelectingForListing
            ? 'glass border border-white/10 text-slate-300'
            : 'bg-brand-cyan text-brand-darker shadow-lg shadow-brand-cyan/10'}`}
        >
          {isSelectingForListing ? t('report.cancel') : (isThai ? 'ประกาศขายใหม่' : 'New Listing')}
        </button>
      </div>

      {isSelectingForListing ? (
        <div className="space-y-4 animate-fadeIn">
          <p className="px-2 text-[9px] text-slate-500 font-black uppercase tracking-widest">{t('vault.selectAsset')}</p>
          <div className="space-y-3">
            {allVaultItems.filter(({ item }) => !item.isListing).length === 0 ? (
              <div className="py-20 text-center glass rounded-[2.5rem] border-dashed border-white/5">
                <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest">{t('vault.noUnlisted')}</p>
              </div>
            ) : (
              allVaultItems.filter(({ item }) => !item.isListing).map(({ colId, item, card }) => (
                <button
                  key={item.id}
                  onClick={() => onListCard(colId, item, card)}
                  className="w-full glass p-4 rounded-3xl flex items-center gap-4 border-white/5 active:scale-[0.98] transition-all text-left group"
                >
                  <div className="w-12 h-16 rounded-xl overflow-hidden bg-white/5 p-1 flex-shrink-0 relative">
                    <Image 
                      src={getThumbnailUrl(card.images?.small || card.imageUrl)} 
                      alt={card.name}
                      fill
                      sizes="48px"
                      className="object-contain"
                      unoptimized={shouldSkipNextOptimization(getThumbnailUrl(card.images?.small || card.imageUrl))}
                    />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white text-sm font-bold group-hover:text-brand-cyan transition-colors">{card.name}</h4>
                    <p className="text-[9px] text-slate-500 uppercase font-black">{item.condition} • {card.set}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-xs font-black">{formatDisplayPrice(card.marketPrice)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : myVaultListings.length === 0 ? (
        <div className="text-center py-32 glass rounded-[2.5rem] border-dashed border-white/5">
          <i className="fa-solid fa-tag text-4xl text-slate-800 mb-6"></i>
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em] px-12 leading-relaxed">{t('vault.noActiveListings')}</p>
          <button
            onClick={() => setIsSelectingForListing(true)}
            className="mt-8 px-8 h-12 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/10 transition-colors"
          >
            {t('vault.startSelling')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {myVaultListings.map(({ colId, item, card }) => (
            <div key={item.id} className="glass p-5 rounded-[2rem] border-white/5 space-y-4">
              <div className="flex gap-4 items-center">
                <div className="w-16 aspect-[3/4] glass rounded-xl overflow-hidden p-1 flex-shrink-0 relative">
                  <Image 
                    src={getThumbnailUrl(card.images?.small || card.imageUrl)} 
                    alt={card.name}
                    fill
                    sizes="64px"
                    className="object-contain"
                    unoptimized={shouldSkipNextOptimization(getThumbnailUrl(card.images?.small || card.imageUrl))}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse"></span>
                    <span className="text-[8px] text-brand-green font-black uppercase tracking-widest">{isThai ? 'วางขายในตลาด' : 'Live on Market'}</span>
                  </div>
                  <h4 className="text-white text-base font-black truncate">{card.name}</h4>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{item.condition} • {item.quantity} {isThai ? 'ใบ' : 'Unit(s)'}</p>
                </div>
                <button onClick={() => startPriceEdit(item)} className="text-right active:scale-95 transition-transform">
                  <p className="text-xl font-black text-brand-cyan">
                    {formatDisplayPrice(item.listingPrice ?? 0)}
                    <i className="fa-solid fa-pen text-[10px] text-slate-500 ml-1.5 align-middle"></i>
                  </p>
                  <p className="text-[8px] text-slate-600 font-black uppercase tracking-widest">{t('card.askPrice')}</p>
                </button>
              </div>
              {editingPriceItemId === item.id ? (
                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{t('vault.newAskPrice')}</p>
                    {card.marketPrice > 0 && (
                      <button
                        onClick={() => setPriceDraft(String(Math.round(card.marketPrice)))}
                        className="text-[9px] text-brand-cyan font-black uppercase tracking-widest"
                      >
                        {t('vault.useMarket')}: ฿{Math.round(card.marketPrice).toLocaleString()}
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-black">฿</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="1"
                        autoFocus
                        value={priceDraft}
                        onChange={(e) => setPriceDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') savePriceEdit(colId, item, card); }}
                        className="w-full h-12 bg-white/5 border border-white/10 focus:border-brand-cyan/50 rounded-xl pl-9 pr-3 text-white text-base font-black outline-none transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => savePriceEdit(colId, item, card)}
                      disabled={isSavingPrice || !isPriceDraftValid}
                      className="px-5 h-12 bg-brand-cyan text-brand-darker rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
                    >
                      {isSavingPrice ? <i className="fa-solid fa-spinner fa-spin"></i> : t('vault.savePrice')}
                    </button>
                    <button
                      onClick={() => setEditingPriceItemId(null)}
                      disabled={isSavingPrice}
                      aria-label={t('report.cancel')}
                      className="w-12 h-12 glass border-white/5 rounded-xl text-slate-400 active:scale-95 transition-all"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => startPriceEdit(item)}
                    className="flex-1 h-10 glass border-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                  >
                    {t('vault.editPrice')}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(isThai ? 'นำประกาศนี้ออกจากตลาดหรือไม่?' : 'Remove this listing from the market?')) {
                        onRemoveListing(colId, item, card);
                      }
                    }}
                    className="flex-1 h-10 glass border-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest text-brand-red/60 hover:text-brand-red transition-colors"
                  >
                    {isThai ? 'ลบ' : 'Remove'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {listingTarget && (
        <ListingForm
          card={listingTarget.card}
          initialCondition={listingTarget.item.condition}
          onClose={onCancelListing}
          onSuccess={async (data) => {
            if (data) {
              await onPublishListing(data);
            }
            setIsSelectingForListing(false);
            setView('listings');
          }}
        />
      )}
    </div>
  );

  const renderWishlist = () => (
    <div className="space-y-6 animate-fadeIn pb-20">
      <div className="flex items-center gap-4 pt-4">
        <button onClick={() => setView('folders')} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
          <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
        </button>
        <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{t('vault.wishlist')}</h3>
      </div>
      <div className="space-y-3">
        {wishlist.length === 0 ? (
          <div className="text-center py-20 opacity-20">
            <i className="fa-solid fa-heart text-4xl mb-4"></i>
            <p className="text-xs font-black uppercase tracking-widest">{t('vault.wishlistEmpty')}</p>
          </div>
        ) : (
          wishlist.map(card => (
            <div
              key={card.id}
              onClick={() => { setViewingCard(card); setViewingItem(null); }}
              className="glass p-4 rounded-3xl flex items-center gap-4 border-white/5 active:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <div className="w-12 h-16 relative flex-shrink-0">
                <Image 
                  src={getThumbnailUrl(card.images?.small || card.imageUrl)} 
                  alt={card.name}
                  fill
                  sizes="48px"
                  className="object-contain"
                  unoptimized={shouldSkipNextOptimization(getThumbnailUrl(card.images?.small || card.imageUrl))}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-white text-sm font-bold truncate">{card.name}</h4>
                <p className="text-[9px] text-slate-500 uppercase font-bold">{card.set} • {card.rarity}</p>
              </div>
              <div className="text-right">
                <p className="text-white text-xs font-black">{formatDisplayPrice(card.marketPrice)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderCollections = () => {
    return (
      <div className="space-y-6 animate-fadeIn pb-20">
        <div className="flex justify-between items-center pt-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setView('folders')} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
              <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
            </button>
            <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{t('vault.collection')}</h3>
          </div>
          <div className="bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{allVaultItems.length} Cards</span>
          </div>
        </div>

        {/* Search & Sort Bar */}
        <div className="flex gap-2">
          <div className="relative group flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-green transition-colors"></i>
            <input
              type="text"
              placeholder={t('vault.searchCards')}
              className="w-full h-12 pl-10 pr-4 bg-[#1e293b] border border-white/10 rounded-xl focus:border-brand-green outline-none text-sm font-medium text-white placeholder:text-slate-500 transition-all shadow-inner"
              value={collectionSearchQuery}
              onChange={(e) => setCollectionSearchQuery(e.target.value)}
            />
          </div>

          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
              className="h-12 w-12 bg-[#1e293b] border border-white/10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:border-brand-green transition-all shadow-inner active:scale-95"
            >
              <i className="fa-solid fa-arrow-up-wide-short text-sm"></i>
            </button>

            {isSortMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fadeIn">
                <div className="p-2 border-b border-white/5 bg-white/[0.02]">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 pl-2">{isThai ? 'จัดเรียงตาม' : 'Sort By'}</span>
                </div>
                <div className="p-1">
                  {[
                    { id: 'date_desc', label: isThai ? 'วางขายล่าสุด' : 'Recently Added' },
                    { id: 'name_asc', label: isThai ? 'ชื่อ (ก-ฮ)' : 'Name (A-Z)' },
                    { id: 'price_desc', label: isThai ? 'ราคา (สูง-ต่ำ)' : 'Price (High-Low)' },
                    { id: 'price_asc', label: isThai ? 'ราคา (ต่ำ-สูง)' : 'Price (Low-High)' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { setSortOption(opt.id as SortOption); setIsSortMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider mb-1 last:mb-0 transition-colors ${sortOption === opt.id
                        ? 'bg-brand-green/10 text-brand-green'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Current Sort Indicator */}
        <div className="flex justify-end -mt-2">
          <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">{isThai ? 'จัดเรียงตาม' : 'Sort By'}: {getSortLabel()}</span>
        </div>

        {/* Card List */}
        <div className="space-y-3">
          {processedItems.length === 0 ? (
            <div className="text-center py-20 opacity-20">
              <i className="fa-solid fa-layer-group text-4xl mb-4"></i>
              <p className="text-xs font-black uppercase tracking-widest">
                {collectionSearchQuery ? t('vault.noMatches') : t('vault.collectionEmpty')}
              </p>
            </div>
          ) : (
            processedItems.map(({ item, card, colId }) => (
              <div
                key={item.id}
                onClick={() => { setViewingCard(card); setViewingItem({ colId, item }); }}
                className="glass p-4 rounded-3xl flex items-center gap-4 border-white/5 group relative overflow-hidden active:bg-white/[0.05] transition-colors cursor-pointer"
              >
                <div className="w-14 h-20 bg-slate-900 rounded-xl overflow-hidden flex-shrink-0 p-1 border border-white/5 relative">
                  <Image 
                    src={getThumbnailUrl(card.images?.small || card.imageUrl)} 
                    alt={card.name}
                    fill
                    sizes="56px"
                    className="object-contain filter drop-shadow-md" 
                    unoptimized={shouldSkipNextOptimization(getThumbnailUrl(card.images?.small || card.imageUrl))}
                  />
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex justify-between items-start">
                    <h4 className="text-white text-sm font-bold truncate pr-2">{card.name}</h4>
                    {item.isListing && (
                      <span className="text-[7px] bg-brand-cyan/20 text-brand-cyan px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-brand-cyan/20">Listed</span>
                    )}
                  </div>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest truncate">{card.set} • #{card.number}</p>

                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex items-center gap-1.5 bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                      <i className="fa-regular fa-clock text-[8px] text-slate-500"></i>
                      <span className="text-[8px] text-slate-400 font-bold">
                        {new Date(item.addedAt).toLocaleDateString(isThai ? 'th-TH' : 'en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">{item.condition}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <p className="text-white text-xs font-black">{formatDisplayPrice(card.marketPrice)}</p>
                  <button
                    onClick={(e) => handleRemoveCard(e, colId, item.id)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/5 hover:bg-brand-red/20 hover:text-brand-red text-slate-600 transition-colors"
                  >
                    <i className="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  if (view === 'wishlist') return (
    <>
      {renderWishlist()}
      {viewingCard && (
        <CardDetails
          card={viewingCard}
          isWishlisted={true} // In wishlist view, it's always true
          onClose={() => { setViewingCard(null); setViewingItem(null); }}
          onToggleWishlist={onToggleWishlist}
          onAddToCollection={onAddToCollection}
          listings={activeListings}
          currency={currency}
          exchangeRate={exchangeRate}
        />
      )}
    </>
  );

  if (view === 'collections') return (
    <>
      {renderCollections()}
      {viewingCard && viewingItem && (
        <CardDetails
          card={viewingCard}
          isWishlisted={wishlist.some(c => c.id === viewingCard.id)}
          onClose={() => { setViewingCard(null); setViewingItem(null); }}
          onToggleWishlist={onToggleWishlist}
          onAddToCollection={onAddToCollection}
          isVaultView={true}
          vaultActionButtons={
            !viewingItem.item.isListing ? (
              <button
                onClick={() => {
                  onListCard(viewingItem.colId, viewingItem.item, viewingCard);
                  setViewingCard(null);
                  setViewingItem(null);
                  setIsSelectingForListing(false);
                  setView('listings');
                }}
                className="w-full h-14 mt-4 bg-brand-cyan text-brand-darker font-black text-[10px] tracking-[0.2em] rounded-xl shadow-lg shadow-brand-cyan/20 active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-tag"></i>
                {t('vault.sellAsset')}
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 text-brand-cyan font-black uppercase tracking-widest text-xs py-4">
                <span className="w-2 h-2 rounded-full bg-brand-cyan animate-pulse"></span>
                {t('vault.currentlyListed')}
              </div>
            )
          }
          listings={activeListings}
          currency={currency}
          exchangeRate={exchangeRate}
        />
      )}
    </>
  );

  if (view === 'listings') return renderListings();
  if (view === 'master-game') return (
    <GamePicker
      onBack={() => setView('folders')}
      onSelectGame={(gameId) => {
        setSelectedGame(gameId);
        // Only games with multiple languages need a region/language step
        // (currently just Pokemon). Single-language games jump straight to sets.
        if (gameHasMultipleLanguages(gameId)) {
          setView('master');
        } else {
          setSelectedRegion(`${gameId}-en`);
          setView('sets');
        }
      }}
    />
  );
  if (view === 'master') return (
    <MasterSetPicker
      game={selectedGame}
      onBack={() => setView('master-game')}
      onSelectGame={(region) => {
        setSelectedRegion(region);
        setView('sets');
      }}
    />
  );
  if (view === 'sets') return (
    <SetBrowser
      region={selectedRegion}
      onBack={() => setView(gameHasMultipleLanguages(selectedGame) ? 'master' : 'master-game')}
      onSelectSet={(set: ApiSet, language: 'en' | 'jp' | 'th') => {
        setSelectedSet(set);
        setSelectedLanguage(language);
        setView('set-detail');
      }}
    />
  );
  if (view === 'set-detail' && selectedSet) {
    return (
      <MasterSetDetail
        set={selectedSet}
        ownedCardIds={ownedCardIds}
        wishlistCardIds={wishlistCardIds}
        onBack={() => setView('sets')}
        onToggleWishlist={onToggleWishlist}
        language={selectedLanguage}
        game={selectedGame}
      />
    );
  }

  return renderFolders();
};

export default Vault;