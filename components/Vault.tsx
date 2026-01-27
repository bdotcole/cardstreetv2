import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CustomCollection, Card, UserCollectionItem } from '../types';
import { COLLECTION_FOLDERS, MOCK_CARDS } from '../constants';
import ListingForm from './ListingForm';
import MasterSetPicker from './MasterSetPicker';
import SetBrowser from './SetBrowser';
import MasterSetDetail from './MasterSetDetail';
import { ApiSet } from '../services/pokemonService';
import CardDetails from './CardDetails';
import PriceChart from './PriceChart';

interface VaultProps {
  customCollections: CustomCollection[];
  wishlist: Card[];
  onUpdateCollections: (collections: CustomCollection[]) => void;
  onAddToCollection: (card: Card) => void;
  onToggleWishlist: (card: Card) => void;
  onListCard: (colId: string, item: UserCollectionItem, card: Card) => void;
  listingTarget: { colId: string, item: UserCollectionItem, card: Card } | null;
  onCancelListing: () => void;
  onPublishListing: (data: any) => void;
  activeListings?: any[];
  totalValue: number;
  currencySymbol: string;
}

type VaultView = 'folders' | 'wishlist' | 'listings' | 'collections' | 'master' | 'sets' | 'set-detail';
type SortOption = 'date_desc' | 'date_asc' | 'price_desc' | 'price_asc' | 'name_asc';

const Vault: React.FC<VaultProps> = ({
  customCollections,
  wishlist,
  onUpdateCollections,
  onAddToCollection,
  onToggleWishlist,
  onListCard,
  listingTarget,
  onCancelListing,
  onPublishListing,
  activeListings = [],
  totalValue,
  currencySymbol
}) => {
  const [view, setView] = useState<VaultView>('folders');
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [selectedSet, setSelectedSet] = useState<ApiSet | null>(null);
  const [isSelectingForListing, setIsSelectingForListing] = useState(false);
  const [timeframe, setTimeframe] = useState('1M');

  // Chart Logic - Mocking portfolio history based on current value for visual
  const chartData = useMemo(() => {
    // Generate specific curve based on timeframe
    const points = timeframe === '1D' ? 24 : timeframe === '1W' ? 7 : 30;
    const variance = totalValue * 0.05;

    return Array.from({ length: points }).map((_, i) => ({
      date: i.toString(),
      price: totalValue - (variance * Math.cos(i / 5)) // Fake fancy curve
    }));
  }, [totalValue, timeframe]);

  // Card Details Popup State
  const [viewingCard, setViewingCard] = useState<Card | null>(null);
  const [viewingItem, setViewingItem] = useState<{ colId: string, item: UserCollectionItem } | null>(null);

  // Collection View State
  const [collectionSearchQuery, setCollectionSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('date_desc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

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

  const deleteCollection = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this collection and all items inside it?")) {
      onUpdateCollections(customCollections.filter(c => c.id !== id));
    }
  };

  const getSortLabel = () => {
    switch (sortOption) {
      case 'price_desc': return 'Price: High to Low';
      case 'price_asc': return 'Price: Low to High';
      case 'name_asc': return 'Name: A-Z';
      default: return 'Recently Added';
    }
  };

  const renderFolders = () => (
    <div className="space-y-6 animate-fadeIn pb-32">
      {/* Portfolio Header */}
      <div className="pt-6 relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-brand-cyan to-brand-green opacity-20 blur-3xl rounded-full"></div>

        <div className="flex justify-between items-end mb-1 px-2">
          <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg]">My Portfolio</p>
          <div className="flex items-center gap-1.5 bg-brand-green/10 px-2 py-1 rounded-md border border-brand-green/20">
            <i className="fa-solid fa-arrow-trend-up text-brand-green text-[10px]"></i>
            <span className="text-brand-green text-[10px] font-black">+4.2%</span>
          </div>
        </div>

        <h2 className="px-2 text-6xl font-black text-white tracking-tighter leading-none italic skew-x-[-6deg] drop-shadow-lg mb-6">
          {currencySymbol}{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </h2>

        {/* Chart Card */}
        <div className="glass-panel rounded-2xl p-0.5 border-brand-cyan/20 overflow-hidden shadow-2xl mb-8 mx-1">
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

            const targetView = folder.id === 'collections' ? 'collections' : folder.id as VaultView;

            return (
              <div
                key={folder.id}
                onClick={() => setView(targetView)}
                className="glass p-6 rounded-[2.5rem] border-white/5 active:scale-95 transition-all group cursor-pointer hover:border-brand-cyan/20"
              >
                <div className="w-12 h-12 rounded-2xl glass border-white/10 flex items-center justify-center mb-4 group-hover:border-white/20 transition-colors">
                  <i className={`fa-solid ${folder.icon} ${iconColor} group-hover:scale-110 transition-transform`}></i>
                </div>
                <h4 className="text-white text-sm font-bold tracking-tight mb-1">{folder.name}</h4>
                <p className="text-[9px] text-slate-600 font-black uppercase tracking-widest">{count} Items</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderListings = () => (
    <div className="space-y-6 animate-fadeIn pb-20">
      <div className="flex justify-between items-center pt-4 gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => setView('folders')} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </button>
          <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Active Listings</h3>
        </div>
        <button
          onClick={() => setIsSelectingForListing(true)}
          className="px-6 h-10 bg-brand-cyan text-brand-darker rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-brand-cyan/10 whitespace-nowrap"
        >
          New Listing
        </button>
      </div>

      {isSelectingForListing ? (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between px-2">
            <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Select an Asset from your Vault</p>
            <button onClick={() => setIsSelectingForListing(false)} className="text-[9px] text-brand-red font-black uppercase tracking-widest">Cancel</button>
          </div>
          <div className="space-y-3">
            {allVaultItems.filter(({ item }) => !item.isListing).length === 0 ? (
              <div className="py-20 text-center glass rounded-[2.5rem] border-dashed border-white/5">
                <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest">No unlisted assets available</p>
              </div>
            ) : (
              allVaultItems.filter(({ item }) => !item.isListing).map(({ colId, item, card }) => (
                <button
                  key={item.id}
                  onClick={() => onListCard(colId, item, card)}
                  className="w-full glass p-4 rounded-3xl flex items-center gap-4 border-white/5 active:scale-[0.98] transition-all text-left group"
                >
                  <div className="w-12 h-16 rounded-xl overflow-hidden bg-white/5 p-1 flex-shrink-0">
                    <img src={card.imageUrl} className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white text-sm font-bold group-hover:text-brand-cyan transition-colors">{card.name}</h4>
                    <p className="text-[9px] text-slate-500 uppercase font-black">{item.condition} • {card.set}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-xs font-black">฿{card.marketPrice.toLocaleString()}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : myVaultListings.length === 0 ? (
        <div className="text-center py-32 glass rounded-[2.5rem] border-dashed border-white/5">
          <i className="fa-solid fa-tag text-4xl text-slate-800 mb-6"></i>
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em] px-12 leading-relaxed">You currently have no active sales listings in the CardStreet market.</p>
          <button
            onClick={() => setIsSelectingForListing(true)}
            className="mt-8 px-8 h-12 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/10 transition-colors"
          >
            Start Selling
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {myVaultListings.map(({ colId, item, card }) => (
            <div key={item.id} className="glass p-5 rounded-[2rem] border-white/5 space-y-4">
              <div className="flex gap-4 items-center">
                <div className="w-16 aspect-[3/4] glass rounded-xl overflow-hidden p-1 flex-shrink-0">
                  <img src={card.imageUrl} className="w-full h-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse"></span>
                    <span className="text-[8px] text-brand-green font-black uppercase tracking-widest">Live on Market</span>
                  </div>
                  <h4 className="text-white text-base font-black truncate">{card.name}</h4>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{item.condition} • {item.quantity} Unit(s)</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-brand-cyan">฿{item.listingPrice?.toLocaleString()}</p>
                  <p className="text-[8px] text-slate-600 font-black uppercase tracking-widest">Asking Price</p>
                </div>
              </div>
              <div className="flex gap-2 pt-2">

                <button
                  onClick={() => {
                    // Re-open listing form with current data
                    onListCard(colId, item, card);
                    setIsSelectingForListing(false);
                  }}
                  className="flex-1 h-10 glass border-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                >
                  Edit Listing
                </button>
                <button
                  onClick={() => {
                    onUpdateCollections(customCollections.map(col => {
                      if (col.id === colId) {
                        return {
                          ...col,
                          items: col.items.map(it => it.id === item.id ? { ...it, isListing: false, listingPrice: undefined } : it)
                        };
                      }
                      return col;
                    }));
                  }}
                  className="flex-1 h-10 glass border-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest text-brand-red/60 hover:text-brand-red transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {listingTarget && (
        <ListingForm
          card={listingTarget.card}
          initialCondition={listingTarget.item.condition}
          onClose={onCancelListing}
          onSuccess={(data) => {
            if (data) {
              onPublishListing(data);
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
        <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Wishlist</h3>
      </div>
      <div className="space-y-3">
        {wishlist.length === 0 ? (
          <div className="text-center py-20 opacity-20">
            <i className="fa-solid fa-heart text-4xl mb-4"></i>
            <p className="text-xs font-black uppercase tracking-widest">Wishlist is Empty</p>
          </div>
        ) : (
          wishlist.map(card => (
            <div
              key={card.id}
              onClick={() => { setViewingCard(card); setViewingItem(null); }}
              className="glass p-4 rounded-3xl flex items-center gap-4 border-white/5 active:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <img src={card.imageUrl} className="w-12 h-16 object-contain" />
              <div className="flex-1 min-w-0">
                <h4 className="text-white text-sm font-bold truncate">{card.name}</h4>
                <p className="text-[9px] text-slate-500 uppercase font-bold">{card.set} • {card.rarity}</p>
              </div>
              <div className="text-right">
                <p className="text-white text-xs font-black">฿{card.marketPrice.toLocaleString()}</p>
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
            <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">My Collection</h3>
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
              placeholder="Search your cards..."
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
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 pl-2">Sort By</span>
                </div>
                <div className="p-1">
                  {[
                    { id: 'date_desc', label: 'Recently Added' },
                    { id: 'name_asc', label: 'Name (A-Z)' },
                    { id: 'price_desc', label: 'Price (High-Low)' },
                    { id: 'price_asc', label: 'Price (Low-High)' },
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
          <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">Sorted by: {getSortLabel()}</span>
        </div>

        {/* Card List */}
        <div className="space-y-3">
          {processedItems.length === 0 ? (
            <div className="text-center py-20 opacity-20">
              <i className="fa-solid fa-layer-group text-4xl mb-4"></i>
              <p className="text-xs font-black uppercase tracking-widest">
                {collectionSearchQuery ? 'No matches found' : 'Collection is Empty'}
              </p>
            </div>
          ) : (
            processedItems.map(({ item, card, colId }) => (
              <div
                key={item.id}
                onClick={() => { setViewingCard(card); setViewingItem({ colId, item }); }}
                className="glass p-4 rounded-3xl flex items-center gap-4 border-white/5 group relative overflow-hidden active:bg-white/[0.05] transition-colors cursor-pointer"
              >
                <div className="w-14 h-20 bg-slate-900 rounded-xl overflow-hidden flex-shrink-0 p-1 border border-white/5">
                  <img src={card.imageUrl} className="w-full h-full object-contain filter drop-shadow-md" alt={card.name} />
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
                        {new Date(item.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">{item.condition}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <p className="text-white text-xs font-black">฿{card.marketPrice.toLocaleString()}</p>
                  <button
                    onClick={(e) => deleteCollection(e, colId)}
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
          actionButtons={
            !viewingItem.item.isListing ? (
              <div className="fixed bottom-0 left-0 w-full p-6 bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 z-[60]">
                <button
                  onClick={() => {
                    onListCard(viewingItem.colId, viewingItem.item, viewingCard);
                    setViewingCard(null);
                    setViewingItem(null);
                    setIsSelectingForListing(false);
                    setView('listings');
                  }}
                  className="w-full h-14 bg-brand-cyan text-brand-darker font-black text-[10px] tracking-[0.2em] rounded-xl shadow-lg shadow-brand-cyan/20 active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-tag"></i>
                  Sell Asset
                </button>
              </div>
            ) : (
              <div className="fixed bottom-0 left-0 w-full p-6 bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 z-20 text-center">
                <div className="flex items-center justify-center gap-2 text-brand-cyan font-black uppercase tracking-widest text-xs">
                  <span className="w-2 h-2 rounded-full bg-brand-cyan animate-pulse"></span>
                  Currently Listed on Market
                </div>
              </div>
            )
          }
          listings={activeListings}
        />
      )}
    </>
  );

  if (view === 'listings') return renderListings();
  if (view === 'master') return (
    <MasterSetPicker
      onBack={() => setView('folders')}
      onSelectGame={(game) => {
        setSelectedRegion(game);
        setView('sets');
      }}
    />
  );
  if (view === 'sets') return (
    <SetBrowser
      region={selectedRegion}
      onBack={() => setView('master')}
      onSelectSet={(set: ApiSet) => {
        setSelectedSet(set);
        setView('set-detail');
      }}
    />
  );
  if (view === 'set-detail' && selectedSet) return (
    <MasterSetDetail
      set={selectedSet}
      ownedCardIds={ownedCardIds}
      onBack={() => setView('sets')}
    />
  );

  return renderFolders();
};

export default Vault;