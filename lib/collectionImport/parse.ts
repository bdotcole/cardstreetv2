import { CardCondition } from '@/types';
import { GRADING_COMPANIES, GradingCompany, ParsedRow } from './types';

// Pure parser for a partner's pasted inventory sheet. Shared by the importer UI
// (immediate preview) and the bulk-resolve route (defensive re-validation), so it
// must have no side effects and no server-only imports.

// Header aliases -> canonical field. Case-insensitive; covers the labels a POS or a
// hand-kept spreadsheet is likely to use.
const HEADER_ALIASES: Record<string, keyof ColumnFields> = {
  set: 'set', 'set code': 'set', setcode: 'set', set_id: 'set', 'set id': 'set', expansion: 'set',
  number: 'number', 'card number': 'number', card_number: 'number', 'card no': 'number',
  no: 'number', 'no.': 'number', num: 'number', collector: 'number', 'collector number': 'number', '#': 'number',
  name: 'name', card: 'name', 'card name': 'name', title: 'name',
  condition: 'condition', cond: 'condition', grade_condition: 'condition',
  quantity: 'quantity', qty: 'quantity', count: 'quantity', amount: 'quantity', stock: 'quantity',
  grade: 'grade',
  'grading company': 'gradingCompany', 'grading_company': 'gradingCompany', company: 'gradingCompany', grader: 'gradingCompany',
  price: 'purchasePrice', 'purchase price': 'purchasePrice', 'purchase_price': 'purchasePrice',
  cost: 'purchasePrice', paid: 'purchasePrice', 'buy price': 'purchasePrice',
  // Asking price, kept separate from `price`/`cost`. A bare `price` column has
  // always meant what the shop PAID here, and silently re-reading it as an
  // asking price would list a shop's whole inventory at cost. A sheet that
  // wants to create listings has to name the column unambiguously.
  'list price': 'listPrice', 'listing price': 'listPrice', list_price: 'listPrice',
  'sell price': 'listPrice', 'selling price': 'listPrice', sell: 'listPrice',
  'sale price': 'listPrice', ask: 'listPrice', 'asking price': 'listPrice',
  'retail price': 'listPrice', retail: 'listPrice',
  language: 'language', lang: 'language',
  game: 'game',
  type: 'productType', product: 'productType', 'product type': 'productType', 'product_type': 'productType', producttype: 'productType', sealed: 'productType',
};

interface ColumnFields {
  set: string; number: string; name: string; condition: string; quantity: string;
  grade: string; gradingCompany: string; purchasePrice: string; listPrice: string; language: string; game: string; productType: string;
}

// Normalize a `type` cell to a sealed_products.product_type. Anything non-empty but
// unrecognized becomes 'other' (still treated as sealed; the resolver then matches by
// set alone and lets the partner pick the variant).
export function normalizeProductType(v: string): string {
  const s = (v || '').toLowerCase().trim().replace(/[_-]+/g, ' ');
  if (!s) return '';
  if (['booster box', 'box', 'bb'].includes(s)) return 'booster_box';
  if (['etb', 'elite trainer box', 'elite trainer'].includes(s)) return 'etb';
  if (['booster pack', 'pack', 'packs'].includes(s)) return 'booster_pack';
  if (['bundle', 'booster bundle'].includes(s)) return 'bundle';
  if (['collection', 'collection box'].includes(s)) return 'collection';
  return 'other';
}

export function normalizeCondition(v: string): CardCondition {
  const s = (v || '').toLowerCase().trim();
  if (!s) return CardCondition.NM;
  if (['nm', 'near mint', 'near-mint', 'm', 'mint', 'nm-mt', 'nmmt'].includes(s)) return CardCondition.NM;
  if (['lp', 'lightly played', 'light played', 'ex', 'excellent'].includes(s)) return CardCondition.LP;
  if (['mp', 'moderately played', 'moderate', 'vg', 'good'].includes(s)) return CardCondition.MP;
  if (['hp', 'heavily played', 'heavy', 'played', 'poor'].includes(s)) return CardCondition.HP;
  if (['dmg', 'damaged', 'damage', 'd'].includes(s)) return CardCondition.DMG;
  if (['sealed', 'new', 'factory sealed'].includes(s)) return CardCondition.Sealed;
  return CardCondition.NM;
}

// Derive graded fields from a `grade` cell (+ optional company cell). Accepts
// "PSA 10", "psa10", "BGS 9.5", or a bare "10" with a separate company column.
// A bare number with no company defaults to PSA (the dominant grader) — the review
// UI surfaces the resulting badge so the partner can catch a wrong default.
export function parseGrade(gradeCell: string, companyCell: string): Pick<ParsedRow, 'isGraded' | 'gradingCompany' | 'grade'> {
  const g = (gradeCell || '').trim();
  let company = (companyCell || '').trim().toUpperCase();
  if (!g && !company) return { isGraded: false };

  const m = g.match(/^(PSA|BGS|CGC|SGC|ARS|TAG)?\s*(\d+(?:\.\d)?)$/i);
  if (!m) return { isGraded: false }; // company-only or unparseable -> treat as raw
  if (m[1]) company = m[1].toUpperCase();
  const num = parseFloat(m[2]);
  if (isNaN(num) || num < 1 || num > 10) return { isGraded: false };
  if (!company) company = 'PSA';
  if (!(GRADING_COMPANIES as readonly string[]).includes(company)) return { isGraded: false };
  return { isGraded: true, gradingCompany: company as GradingCompany, grade: num };
}

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

// Split one line honoring double-quoted fields (RFC-4180-ish: "" is a literal quote).
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface ParseResult {
  rows: ParsedRow[];
  headerFound: boolean; // true only when both `set` and `number` columns were recognized
  recognizedColumns: string[];
  unrecognizedHeaders: string[];
}

const MAX_ROWS = 1000;

export function parseInventoryText(text: string): ParseResult {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], headerFound: false, recognizedColumns: [], unrecognizedHeaders: [] };
  }

  const delim = detectDelimiter(lines[0]);
  const headerCells = splitLine(lines[0], delim).map((h) => h.toLowerCase());
  const fieldByCol = headerCells.map((h) => HEADER_ALIASES[h] ?? null);
  const recognized = [...new Set(fieldByCol.filter(Boolean) as string[])];
  const unrecognizedHeaders = headerCells.filter((_h, i) => fieldByCol[i] === null);
  // A singles sheet needs set + number; a sealed sheet needs set + a product `type`.
  const headerFound = recognized.includes('set') && (recognized.includes('number') || recognized.includes('productType'));

  if (!headerFound) {
    return { rows: [], headerFound: false, recognizedColumns: recognized, unrecognizedHeaders };
  }

  const rows: ParsedRow[] = [];
  for (let li = 1; li < lines.length && rows.length < MAX_ROWS; li++) {
    const cells = splitLine(lines[li], delim);
    const f: ColumnFields = {
      set: '', number: '', name: '', condition: '', quantity: '',
      grade: '', gradingCompany: '', purchasePrice: '', listPrice: '', language: '', game: '', productType: '',
    };
    fieldByCol.forEach((field, ci) => {
      if (field) f[field] = cells[ci] ?? '';
    });

    const rowIndex = li; // 1-based data line
    const set = f.set.trim();
    const number = f.number.trim();
    const productType = normalizeProductType(f.productType);
    const isSealed = !!productType;
    const grade = parseGrade(f.grade, f.gradingCompany);
    const qtyNum = parseInt(f.quantity.replace(/[^0-9]/g, ''), 10);
    const priceNum = parseFloat(f.purchasePrice.replace(/[^0-9.]/g, ''));
    const listNum = parseFloat(f.listPrice.replace(/[^0-9.]/g, ''));

    const row: ParsedRow = {
      rowIndex,
      set,
      number,
      name: f.name.trim() || undefined,
      // Sealed rows carry no condition/grade of their own.
      condition: isSealed ? CardCondition.Sealed : normalizeCondition(f.condition),
      quantity: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1,
      isGraded: isSealed ? false : grade.isGraded,
      gradingCompany: isSealed ? undefined : grade.gradingCompany,
      grade: isSealed ? undefined : grade.grade,
      purchasePrice: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : undefined,
      listPrice: Number.isFinite(listNum) && listNum > 0 ? listNum : undefined,
      language: f.language.trim().toLowerCase() || undefined,
      game: f.game.trim().toLowerCase() || undefined,
      isSealed,
      productType: productType || undefined,
    };

    // Sealed needs only a set (matched by product type); singles need set + number.
    if (!set) row.parseError = 'Missing set code';
    else if (!isSealed && !number) row.parseError = 'Missing card number';
    rows.push(row);
  }

  return { rows, headerFound: true, recognizedColumns: recognized, unrecognizedHeaders };
}

// Sample sheet offered as a downloadable template in the importer UI. The `type`
// column is what makes a row a sealed product (booster_box / etb / booster_pack /
// bundle / collection); leave it blank for singles.
// `price` is what you PAID; `list price` is what you want for it. Only the
// latter creates a listing — see the HEADER_ALIASES note.
export const TEMPLATE_CSV = [
  'set,number,name,condition,quantity,grade,company,type,price,list price',
  'sv4pt5,234,Charizard ex,NM,1,,,,,',
  'sv4pt5,234,Charizard ex,NM,1,10,PSA,,,',
  'MA3,087,,NM,3,,,,,',
  'swsh3,20,Drednaw,LP,2,,,,45,120',
  'sv4pt5,,,,1,,,booster_box,,',
  'sv4pt5,,,,2,,,etb,,',
].join('\n');
