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
  language: 'language', lang: 'language',
  game: 'game',
};

interface ColumnFields {
  set: string; number: string; name: string; condition: string; quantity: string;
  grade: string; gradingCompany: string; purchasePrice: string; language: string; game: string;
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

  const m = g.match(/^(PSA|BGS|CGC|SGC|ARS)?\s*(\d+(?:\.\d)?)$/i);
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
  const headerFound = recognized.includes('set') && recognized.includes('number');

  if (!headerFound) {
    return { rows: [], headerFound: false, recognizedColumns: recognized, unrecognizedHeaders };
  }

  const rows: ParsedRow[] = [];
  for (let li = 1; li < lines.length && rows.length < MAX_ROWS; li++) {
    const cells = splitLine(lines[li], delim);
    const f: ColumnFields = {
      set: '', number: '', name: '', condition: '', quantity: '',
      grade: '', gradingCompany: '', purchasePrice: '', language: '', game: '',
    };
    fieldByCol.forEach((field, ci) => {
      if (field) f[field] = cells[ci] ?? '';
    });

    const rowIndex = li; // 1-based data line
    const set = f.set.trim();
    const number = f.number.trim();
    const grade = parseGrade(f.grade, f.gradingCompany);
    const qtyNum = parseInt(f.quantity.replace(/[^0-9]/g, ''), 10);
    const priceNum = parseFloat(f.purchasePrice.replace(/[^0-9.]/g, ''));

    const row: ParsedRow = {
      rowIndex,
      set,
      number,
      name: f.name.trim() || undefined,
      condition: normalizeCondition(f.condition),
      quantity: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1,
      isGraded: grade.isGraded,
      gradingCompany: grade.gradingCompany,
      grade: grade.grade,
      purchasePrice: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : undefined,
      language: f.language.trim().toLowerCase() || undefined,
      game: f.game.trim().toLowerCase() || undefined,
    };

    if (!set || !number) row.parseError = 'Missing set code or card number';
    rows.push(row);
  }

  return { rows, headerFound: true, recognizedColumns: recognized, unrecognizedHeaders };
}

// Sample sheet offered as a downloadable template in the importer UI.
export const TEMPLATE_CSV = [
  'set,number,name,condition,quantity,grade,company,price',
  'sv4pt5,234,Charizard ex,NM,1,,,',
  'sv4pt5,234,Charizard ex,NM,1,10,PSA,',
  'MA3,087,,NM,3,,,',
  'swsh3,20,Drednaw,LP,2,,,45',
].join('\n');
