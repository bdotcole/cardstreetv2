import { Card, Rarity, CollectionFolder } from './types';

export const THAI_SETS = [
  "Wild Force (ไวลด์ฟอร์ซ)",
  "Shadow Birth (เงาแห่งพงไพร)",
  "VMAX Rising (VMAX ไรซิง)",
  "Sky Legend (สกาย เลเจนด์)",
  "First Impact (เฟิรสท์ อิมแพค)"
];

export const COLLECTION_FOLDERS: CollectionFolder[] = [
  { id: 'collections', name: 'Collection', icon: 'fa-boxes-stacked', count: 0 },
  { id: 'listings', name: 'Listings', icon: 'fa-tag', count: 0 },
  { id: 'wishlist', name: 'Wishlist', icon: 'fa-heart', count: 0 },
  { id: 'master', name: 'Master Sets', icon: 'fa-book-bookmark', count: 142 }
];

export const ONE_PIECE_SETS = [
  "Romance Dawn",
  "Paramount War",
  "Pillars of Strength",
  "Kingdoms of Intrigue",
  "Awakening of the New Era",
  "Wings of the Captain",
  "500 Years in the Future",
  "Memorial Collection"
];

export const JAPANESE_SETS = [
  "Cyber Judge",
  "Wild Force",
  "Shiny Treasure ex",
  "Ancient Roar",
  "Future Flash",
  "Ruler of the Black Flame",
  "Pokemon Card 151",
  "Clay Burst",
  "Snow Hazard",
  "Triplet Beat",
  "Violet ex",
  "Scarlet ex"
];

export const EXCHANGE_RATES: Record<string, number> = {
  THB: 1,      // Base
  USD: 0.028,
  EUR: 0.026,
  JPY: 4.15,
  CNY: 0.20,
  RM: 0.13,    // MYR
  IDR: 440,
  SGD: 0.038,
  PHP: 1.58,
  HKD: 0.22,
  TWD: 0.88
};

export const AC_CURRENCIES = Object.keys(EXCHANGE_RATES);

export const CURRENCY_SYMBOLS: Record<string, string> = {
  THB: '฿',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  CNY: '¥',
  RM: 'RM',
  IDR: 'Rp',
  SGD: 'S$',
  PHP: '₱',
  HKD: 'HK$',
  TWD: 'NT$'
};

export const MOCK_CARDS: Card[] = [
  {
    id: 'p1',
    name: 'Charizard ex',
    thaiName: 'ลิซาร์ดอน ex',
    set: 'Wild Force',
    number: '054/071',
    rarity: Rarity.SAR,
    imageUrl: 'https://images.pokemontcg.io/sv4pt5/234_hires.png',
    marketPrice: 4500,
    change7d: 12.5,
    priceHistory: [
      { date: '1D', price: 4400 },
      { date: '7D', price: 4000 },
      { date: '1M', price: 3800 },
      { date: '3M', price: 4200 },
      { date: '6M', price: 4500 },
    ]
  },
  {
    id: 'p2',
    name: 'Pikachu',
    thaiName: 'ปิกาจู',
    set: 'Shadow Birth',
    number: '023/071',
    rarity: Rarity.SR,
    imageUrl: 'https://images.pokemontcg.io/swsh4/44_hires.png',
    marketPrice: 1200,
    change7d: -2.1,
    priceHistory: [
      { date: '1D', price: 1200 },
      { date: '7D', price: 1220 },
      { date: '1M', price: 1100 },
      { date: '3M', price: 1250 },
      { date: '6M', price: 1200 },
    ]
  },
  {
    id: 'p3',
    name: 'Iono',
    thaiName: 'นันจาโม',
    set: 'Clay Burst',
    number: '091/071',
    rarity: Rarity.SAR,
    imageUrl: 'https://images.pokemontcg.io/sv2/269_hires.png',
    marketPrice: 8500,
    change7d: 5.4,
    priceHistory: [
      { date: '1D', price: 8400 },
      { date: '7D', price: 8200 },
      { date: '1M', price: 8000 },
      { date: '3M', price: 7800 },
      { date: '6M', price: 8500 },
    ]
  },
  {
    id: 'p4',
    name: 'Mewtwo V',
    thaiName: 'มิวทู V',
    set: 'Pokemon GO',
    number: '072/071',
    rarity: Rarity.SAR,
    imageUrl: 'https://images.pokemontcg.io/pgo/72_hires.png',
    marketPrice: 2200,
    change7d: 1.2,
    priceHistory: [
      { date: '1D', price: 2150 },
      { date: '7D', price: 2100 },
      { date: '1M', price: 2200 },
      { date: '3M', price: 2250 },
      { date: '6M', price: 2200 },
    ]
  }
];

export const MOCK_SELLERS = [
  { id: 'u1', name: 'PokeMaster99', avatar: 'https://i.pravatar.cc/150?u=u1', rating: 4.9 },
  { id: 'u2', name: 'CardSharkTH', avatar: 'https://i.pravatar.cc/150?u=u2', rating: 4.5 },
  { id: 'u3', name: 'CollectorJane', avatar: 'https://i.pravatar.cc/150?u=u3', rating: 5.0 }
];

export const MOCK_REVIEWS = [
  {
    id: 'r1',
    reviewerId: 'u5',
    reviewerName: 'Pawat T.',
    reviewerAvatar: 'https://i.pravatar.cc/150?u=u5',
    rating: 5,
    comment: 'Card arrived in perfect condition. Packaging was insane! bubble wrap inside a box inside another box.',
    date: '2 days ago',
    verifiedPurchase: true,
    itemName: 'Charizard ex (SAR)'
  },
  {
    id: 'r2',
    reviewerId: 'u6',
    reviewerName: 'Sarah J.',
    reviewerAvatar: 'https://i.pravatar.cc/150?u=u6',
    rating: 4,
    comment: 'Good communication, shipping took a bit longer than expected but card is nice.',
    date: '1 week ago',
    verifiedPurchase: true,
    itemName: 'Pikachu (Promo)'
  },
  {
    id: 'r3',
    reviewerId: 'u7',
    reviewerName: 'CryptoKing',
    reviewerAvatar: 'https://i.pravatar.cc/150?u=u7',
    rating: 5,
    comment: 'Legit seller. Will buy again.',
    date: '2 weeks ago',
    verifiedPurchase: false
  }
];

export const MOCK_MARKET_LISTINGS = [
  {
    id: 'l1',
    card_id: 'p1',
    card_data: MOCK_CARDS[0],
    price: 4300,
    condition: 'NM',
    seller: MOCK_SELLERS[0],
    created_at: new Date().toISOString()
  },
  {
    id: 'l2',
    card_id: 'p1',
    card_data: MOCK_CARDS[0],
    price: 4500,
    condition: 'NM',
    seller: MOCK_SELLERS[1],
    created_at: new Date().toISOString()
  },
  {
    id: 'l3',
    card_id: 'p1',
    card_data: MOCK_CARDS[0],
    price: 3900,
    condition: 'LP',
    seller: MOCK_SELLERS[2],
    created_at: new Date().toISOString()
  },
  {
    id: 'l4',
    card_id: 'p2',
    card_data: MOCK_CARDS[1],
    price: 1100,
    condition: 'NM',
    seller: MOCK_SELLERS[1],
    created_at: new Date().toISOString()
  },
  {
    id: 'l5',
    card_id: 'p2',
    card_data: MOCK_CARDS[1],
    price: 1050,
    condition: 'LP',
    seller: MOCK_SELLERS[0],
    created_at: new Date().toISOString()
  },
  {
    id: 'l6',
    card_id: 'p3',
    card_data: MOCK_CARDS[2],
    price: 8500,
    condition: 'NM',
    seller: MOCK_SELLERS[0],
    created_at: new Date().toISOString()
  },
  {
    id: 'l7',
    card_id: 'p3',
    card_data: MOCK_CARDS[2],
    price: 8200,
    condition: 'LP',
    seller: MOCK_SELLERS[1],
    created_at: new Date().toISOString()
  },
  {
    id: 'l8',
    card_id: 'p3',
    card_data: MOCK_CARDS[2],
    price: 8000,
    condition: 'MP',
    seller: MOCK_SELLERS[2],
    created_at: new Date().toISOString()
  },
  {
    id: 'l9',
    card_id: 'p4',
    card_data: MOCK_CARDS[3],
    price: 2200,
    condition: 'NM',
    seller: MOCK_SELLERS[2],
    created_at: new Date().toISOString()
  },
  {
    id: 'l10',
    card_id: 'p4',
    card_data: MOCK_CARDS[3],
    price: 2100,
    condition: 'LP',
    seller: MOCK_SELLERS[0],
    created_at: new Date().toISOString()
  }
];
