
export enum CardCondition {
  NM = 'Near Mint',
  LP = 'Lightly Played',
  MP = 'Moderately Played',
  HP = 'Heavily Played',
  DMG = 'Damaged'
}

export enum Rarity {
  C = 'C',
  U = 'U',
  R = 'R',
  RR = 'RR',
  RRR = 'RRR',
  SR = 'SR',
  AR = 'AR',
  SAR = 'SAR',
  UR = 'UR',
  PB = 'PB',
  EH = 'EH',
  MA = 'MA',
  MUR = 'MUR',
}

export interface CardPrices {
  market: number;
  low: number;
  mid: number;
  high: number;
  lastUpdated: string;
}

export interface Card {
  id: string;
  name: string;
  thaiName: string;
  set: string;
  number: string;
  rarity: Rarity;
  imageUrl: string;
  images?: { small: string; large: string };
  marketPrice: number;
  prices?: CardPrices;
  tcgplayerUrl?: string;
  change7d?: number;
  priceHistory: { date: string; price: number }[];
  language?: string;
}

export interface UserCollectionItem {
  id: string;
  cardId: string;
  card?: Card; // Added to store snapshot of API data
  cardData?: any;
  quantity: number;
  condition: CardCondition;
  purchasePrice: number;
  addedAt: string;
  isListing?: boolean;
  listingPrice?: number;
  isGraded?: boolean;
  gradingCompany?: string;
  grade?: number;
}

export interface CustomCollection {
  id: string;
  name: string;
  items: UserCollectionItem[];
  includeInPortfolio: boolean;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  provider: 'google' | 'line' | 'guest';
  isPartner?: boolean;
  partnerStats?: PartnerStats;
  rating?: number;
  reviewCount?: number;
  totalSales?: number;
  bio?: string;
  joinedAt?: string;
  badges?: string[];
  phone?: string;
  address?: string;
  district?: string;
  state?: string;
  province?: string;
  postcode?: string;
}

export interface Review {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerAvatar: string;
  rating: number;
  comment: string;
  date: string;
  verifiedPurchase?: boolean;
  itemName?: string;
}

export interface PartnerStats {
  totalDownloads: number;
  totalEarnings: number;
  currentFee: number;
  referralCode: string;
  level: number;
}

export interface CollectionFolder {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface CartItem {
  id: string; // Listing ID
  cardId: string; // Actual card ID
  card: Card;
  price: number;
  sellerId: string;
  sellerName: string;
  condition: string;
}
