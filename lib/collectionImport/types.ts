import { CardCondition } from '@/types';

// Shapes shared by the client importer UI and the bulk-resolve / bulk-import
// routes. Pure types only — this module is imported from both a 'use client'
// component and server routes, so it must stay free of server-only imports.

export const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'ARS', 'TAG'] as const;
export type GradingCompany = (typeof GRADING_COMPANIES)[number];

// One inventory line as parsed from the pasted CSV/TSV, before catalog resolution.
export interface ParsedRow {
  rowIndex: number; // 1-based data-line number, for error messages
  set: string;
  number: string;
  name?: string;
  condition: CardCondition;
  quantity: number;
  isGraded: boolean;
  gradingCompany?: GradingCompany;
  grade?: number;
  purchasePrice?: number;
  language?: string;
  game?: string;
  // Sealed products (booster boxes, ETBs, ...) are resolved against sealed_products
  // by set + product_type, not by collector number. A `type` cell makes a row sealed.
  isSealed: boolean;
  productType?: string;
  parseError?: string; // set when the line can't be used (missing set/number, etc.)
}

// A candidate catalog card for a parsed row (a set+number can hit several print variants).
export interface ResolvedCandidate {
  id: string;
  name: string;
  set: string;
  number: string;
  image: string; // small thumbnail URL
  language: string;
  marketPrice: number; // ungraded catalog value, THB
  value: number; // per-unit value to book into the collection (graded-aware), THB
}

export type ResolveStatus = 'matched' | 'ambiguous' | 'unmatched' | 'error';

// A parsed row after catalog resolution, returned to the review UI.
export interface ResolvedRow {
  rowIndex: number;
  input: ParsedRow;
  status: ResolveStatus;
  candidates: ResolvedCandidate[];
  message?: string;
}

// One confirmed line the review UI sends to the import route.
export interface ImportRow {
  cardId: string;
  quantity: number;
  condition: CardCondition;
  isGraded: boolean;
  gradingCompany?: GradingCompany;
  grade?: number;
  purchasePrice?: number;
  isSealed?: boolean; // resolve the card_id against sealed_products, not pokemon_cards
}
