
export enum CardCondition {
  NM = 'Near Mint',
  LP = 'Lightly Played',
  MP = 'Moderately Played',
  HP = 'Heavily Played',
  DMG = 'Damaged',
  // Sealed products only — excluded from single-card condition pickers.
  Sealed = 'Sealed'
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
  // Pseudo-rarity for sealed products (they have no card rarity).
  Sealed = 'Sealed',
}

export interface CardPrices {
  market: number;
  low: number;
  mid: number;
  high: number;
  // null when there's no real market-data timestamp (no market_values row and no
  // embedded tcgplayer updatedAt). The mapper deliberately does NOT synthesize
  // now() here, so consumers can treat a present value as genuine freshness.
  lastUpdated: string | null;
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
  game?: string;
  // Sealed products (booster boxes, ETBs, ...) reuse the Card shape so they
  // flow through the same collection/listing snapshot pipeline as cards.
  isSealed?: boolean;
  productType?: string | null;
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

// ─── OBO Best-Offer ──────────────────────────────────────────────────────────
export type OfferStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'countered'
  | 'expired'
  | 'withdrawn';

export type OfferActorRole = 'buyer' | 'seller';

export interface Offer {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: OfferStatus;
  actor_role: OfferActorRole;
  counter_of?: string | null;
  accepted_order_id?: string | null;
  message?: string | null;
  stripe_region?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  // Client-enrichment fields from GET /api/offers (not DB columns):
  viewerRole?: OfferActorRole;
  listing?: {
    price: number;
    status: string;
    card_data: Card;
  } | null;
}

export type ReportStatus = 'Open' | 'Reviewed' | 'Resolved' | 'Dismissed';
export type ReportEntityType = 'listing' | 'seller' | 'other';

export interface Report {
  id: string;
  reporter_id: string;
  entity_type: ReportEntityType;
  entity_id: string;
  entity_name?: string;
  reason: string;
  description?: string;
  status: ReportStatus;
  created_at: string;
  updated_at: string;
  
  // Joined fields
  reporter_details?: {
    display_name?: string;
    avatar_url?: string;
  };
}

