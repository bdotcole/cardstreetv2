'use client';

import React, { useMemo, useRef, useState } from 'react';
import { CardCondition } from '@/types';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { formatTHB } from '@/components/desktop/DesktopMarketplace';
import { parseInventoryText, TEMPLATE_CSV } from '@/lib/collectionImport/parse';
import type { ResolvedRow, ResolvedCandidate, ImportRow } from '@/lib/collectionImport/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  collections: { id: string; name: string }[];
  defaultCollectionId?: string;
  onImported: () => void;
}

type Step = 'input' | 'review' | 'done';

// Per-row review state, keyed by rowIndex.
interface RowChoice {
  include: boolean;
  candidateId: string; // chosen print variant
  quantity: number;
  condition: CardCondition;
}

const CONDITIONS: CardCondition[] = [
  CardCondition.NM, CardCondition.LP, CardCondition.MP, CardCondition.HP, CardCondition.DMG, CardCondition.Sealed,
];

export default function BulkImportModal({ isOpen, onClose, collections, defaultCollectionId, onImported }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('input');
  const [rawText, setRawText] = useState('');
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [rows, setRows] = useState<ResolvedRow[]>([]);
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});
  const [target, setTarget] = useState(defaultCollectionId || collections[0]?.id || '');
  const [importing, setImporting] = useState(false);
  const [doneMsg, setDoneMsg] = useState<{ imported: number; failed: number; gradedMissing: boolean } | null>(null);

  const reset = () => {
    setStep('input'); setRawText(''); setHeaderError(null); setRows([]); setChoices({}); setDoneMsg(null);
  };
  const close = () => { reset(); onClose(); };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cardstreet-inventory-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runResolve = async () => {
    setHeaderError(null);
    const parsed = parseInventoryText(rawText);
    if (!parsed.headerFound) {
      setHeaderError(t('desktop.collection.bulkImport.noHeader'));
      return;
    }
    if (parsed.rows.length === 0) {
      setHeaderError(t('desktop.collection.bulkImport.noRows'));
      return;
    }
    setResolving(true);
    try {
      const res = await fetch('/api/collection/bulk-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsed.rows }),
      });
      if (res.status === 403) { showToast(t('desktop.collection.bulkImport.notPartner'), 'error'); return; }
      if (!res.ok) { showToast(t('desktop.collection.bulkImport.resolveFailed'), 'error'); return; }
      const data = await res.json();
      const resolved: ResolvedRow[] = data.rows || [];
      setRows(resolved);
      // Initialize per-row choices. Matched/ambiguous default to included.
      const init: Record<number, RowChoice> = {};
      for (const r of resolved) {
        const first = r.candidates[0];
        init[r.rowIndex] = {
          include: r.status === 'matched' || r.status === 'ambiguous',
          candidateId: first?.id || '',
          quantity: r.input.quantity || 1,
          condition: r.input.condition || CardCondition.NM,
        };
      }
      setChoices(init);
      setStep('review');
    } catch {
      showToast(t('desktop.collection.bulkImport.resolveFailed'), 'error');
    } finally {
      setResolving(false);
    }
  };

  const candidateFor = (r: ResolvedRow): ResolvedCandidate | undefined => {
    const c = choices[r.rowIndex];
    return r.candidates.find((x) => x.id === c?.candidateId) || r.candidates[0];
  };

  const includable = rows.filter((r) => r.candidates.length > 0);
  const includedRows = includable.filter((r) => choices[r.rowIndex]?.include);

  const { totalCards, totalValue } = useMemo(() => {
    let cards = 0, value = 0;
    for (const r of includedRows) {
      const c = choices[r.rowIndex];
      const cand = candidateFor(r);
      if (!cand) continue;
      cards += c.quantity;
      value += cand.value * c.quantity;
    }
    return { totalCards: cards, totalValue: value };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedRows, choices, rows]);

  const runImport = async () => {
    if (!target) { showToast(t('desktop.collection.bulkImport.pickVault'), 'error'); return; }
    const items: ImportRow[] = [];
    for (const r of includedRows) {
      const c = choices[r.rowIndex];
      const cand = candidateFor(r);
      if (!cand) continue;
      items.push({
        cardId: cand.id,
        quantity: c.quantity,
        condition: r.input.isSealed ? CardCondition.Sealed : c.condition,
        isGraded: !!r.input.isGraded,
        gradingCompany: r.input.gradingCompany,
        grade: r.input.grade,
        purchasePrice: r.input.purchasePrice,
        isSealed: !!r.input.isSealed,
      });
    }
    if (items.length === 0) { showToast(t('desktop.collection.bulkImport.nothingSelected'), 'error'); return; }

    setImporting(true);
    try {
      const res = await fetch('/api/collection/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId: target, items }),
      });
      if (!res.ok) { showToast(t('desktop.collection.bulkImport.importFailed'), 'error'); return; }
      const data = await res.json();
      setDoneMsg({ imported: data.imported || 0, failed: (data.failed || []).length, gradedMissing: !!data.gradedColumnsMissing });
      setStep('done');
      onImported();
    } catch {
      showToast(t('desktop.collection.bulkImport.importFailed'), 'error');
    } finally {
      setImporting(false);
    }
  };

  const setChoice = (rowIndex: number, patch: Partial<RowChoice>) =>
    setChoices((prev) => ({ ...prev, [rowIndex]: { ...prev[rowIndex], ...patch } }));

  const summary = useMemo(() => {
    const s = { matched: 0, ambiguous: 0, unmatched: 0, error: 0 };
    for (const r of rows) (s as any)[r.status] += 1;
    return s;
  }, [rows]);

  // Early-out after all hooks so hook order stays stable across renders.
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-4xl my-8 bg-brand-dark border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <h2 className="text-lg font-black text-white">{t('desktop.collection.bulkImport.title')}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{t('desktop.collection.bulkImport.subtitle')}</p>
          </div>
          <button onClick={close} className="w-8 h-8 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="p-6">
          {step === 'input' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-sm font-bold px-4 py-2 rounded-xl transition-colors">
                  <i className="fa-solid fa-file-arrow-up text-xs"></i>{t('desktop.collection.bulkImport.chooseFile')}
                </button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={onPickFile} className="hidden" />
                <button onClick={downloadTemplate} className="inline-flex items-center gap-2 text-brand-cyan hover:text-cyan-300 text-sm font-bold transition-colors">
                  <i className="fa-solid fa-download text-xs"></i>{t('desktop.collection.bulkImport.downloadTemplate')}
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">{t('desktop.collection.bulkImport.pasteLabel')}</label>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  placeholder={'set,number,condition,quantity,grade,price\nsv4pt5,234,NM,1,,\nMA3,087,NM,3,,'}
                  className="w-full bg-brand-darker border border-white/10 rounded-xl p-3 text-sm text-white font-mono placeholder:text-slate-600 outline-none focus:border-brand-cyan/50 transition-colors"
                />
                <p className="text-[11px] text-slate-500 mt-1.5">{t('desktop.collection.bulkImport.columnsHelp')}</p>
              </div>

              {headerError && (
                <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{headerError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={close} className="text-sm font-bold text-slate-400 hover:text-white px-4 py-2 transition-colors">{t('desktop.collection.bulkImport.cancel')}</button>
                <button
                  onClick={runResolve}
                  disabled={resolving || !rawText.trim()}
                  className="inline-flex items-center gap-2 bg-brand-cyan hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-brand-darker text-sm font-black px-5 py-2 rounded-xl transition-colors"
                >
                  {resolving ? <><i className="fa-solid fa-circle-notch fa-spin text-xs"></i>{t('desktop.collection.bulkImport.resolving')}</> : <>{t('desktop.collection.bulkImport.continue')}<i className="fa-solid fa-arrow-right text-xs"></i></>}
                </button>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="text-emerald-400">{summary.matched} {t('desktop.collection.bulkImport.matched')}</span>
                {summary.ambiguous > 0 && <span className="text-amber-400">· {summary.ambiguous} {t('desktop.collection.bulkImport.toReview')}</span>}
                {(summary.unmatched + summary.error) > 0 && <span className="text-slate-500">· {summary.unmatched + summary.error} {t('desktop.collection.bulkImport.unmatched')}</span>}
              </div>

              <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-white/5 divide-y divide-white/5">
                {rows.map((r) => {
                  const c = choices[r.rowIndex];
                  const cand = candidateFor(r);
                  const noMatch = r.candidates.length === 0;
                  return (
                    <div key={r.rowIndex} className={`flex items-start gap-3 p-3 ${noMatch ? 'opacity-60' : ''}`}>
                      <input
                        type="checkbox"
                        checked={!noMatch && !!c?.include}
                        disabled={noMatch}
                        onChange={(e) => setChoice(r.rowIndex, { include: e.target.checked })}
                        className="mt-1 accent-brand-cyan"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {cand ? <img src={cand.image} alt="" loading="lazy" className="w-10 h-14 object-cover rounded bg-brand-darker shrink-0" /> : <div className="w-10 h-14 rounded bg-brand-darker shrink-0 flex items-center justify-center"><i className="fa-solid fa-question text-slate-600 text-xs"></i></div>}

                      <div className="min-w-0 flex-1">
                        {cand ? (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-white truncate">{cand.name}</span>
                              {r.input.isGraded && (
                                <span className="text-[9px] font-black uppercase tracking-wide bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">{r.input.gradingCompany} {r.input.grade}</span>
                              )}
                              {r.input.isSealed && (
                                <span className="text-[9px] font-black uppercase tracking-wide bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded">Sealed</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate">{cand.set} · #{cand.number} · {cand.language.toUpperCase()}</p>
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-bold text-slate-300">{r.input.set} · #{r.input.number}{r.input.name ? ` · ${r.input.name}` : ''}</span>
                            <p className="text-[11px] text-rose-400/80 font-bold uppercase tracking-wide">{r.message || t('desktop.collection.bulkImport.unmatched')}</p>
                          </>
                        )}

                        {/* Variant picker for ambiguous rows */}
                        {r.status === 'ambiguous' && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {r.candidates.map((cc) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <button
                                key={cc.id}
                                onClick={() => setChoice(r.rowIndex, { candidateId: cc.id })}
                                title={`${cc.name} · ${cc.set} #${cc.number}`}
                                className={`rounded border-2 transition-colors ${c?.candidateId === cc.id ? 'border-brand-cyan' : 'border-transparent hover:border-white/20'}`}
                              >
                                <img src={cc.image} alt="" loading="lazy" className="w-8 h-11 object-cover rounded-sm bg-brand-darker" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {cand && (
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            value={c?.condition}
                            disabled={r.input.isSealed}
                            onChange={(e) => setChoice(r.rowIndex, { condition: e.target.value as CardCondition })}
                            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-brand-cyan/50 disabled:opacity-50 [&>option]:bg-brand-dark"
                          >
                            {CONDITIONS.map((cond) => <option key={cond} value={cond}>{cond}</option>)}
                          </select>
                          <input
                            type="number"
                            min={1}
                            value={c?.quantity}
                            onChange={(e) => setChoice(r.rowIndex, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                            className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-brand-cyan/50"
                          />
                          <span className="w-20 text-right text-xs font-black text-brand-cyan">{formatTHB(cand.value * (c?.quantity || 1))}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">{t('desktop.collection.bulkImport.targetVault')}</label>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-brand-cyan/50 [&>option]:bg-brand-dark"
                  >
                    {collections.map((col) => <option key={col.id} value={col.id}>{col.name}</option>)}
                  </select>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500 font-bold">{totalCards} {t('desktop.collection.bulkImport.cards')} · {formatTHB(totalValue)}</p>
                </div>
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <button onClick={() => setStep('input')} className="inline-flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-white px-4 py-2 transition-colors">
                  <i className="fa-solid fa-arrow-left text-xs"></i>{t('desktop.collection.bulkImport.back')}
                </button>
                <button
                  onClick={runImport}
                  disabled={importing || includedRows.length === 0}
                  className="inline-flex items-center gap-2 bg-brand-cyan hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-brand-darker text-sm font-black px-5 py-2 rounded-xl transition-colors"
                >
                  {importing ? <><i className="fa-solid fa-circle-notch fa-spin text-xs"></i>{t('desktop.collection.bulkImport.importing')}</> : <><i className="fa-solid fa-vault text-xs"></i>{t('desktop.collection.bulkImport.importBtn')} ({includedRows.length})</>}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && doneMsg && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/15 mb-4">
                <i className="fa-solid fa-check text-2xl text-emerald-400"></i>
              </div>
              <h3 className="text-white font-black text-lg">{doneMsg.imported} {t('desktop.collection.bulkImport.doneImported')}</h3>
              {doneMsg.failed > 0 && <p className="text-slate-400 text-sm mt-1">{doneMsg.failed} {t('desktop.collection.bulkImport.doneFailed')}</p>}
              {doneMsg.gradedMissing && <p className="text-amber-400/80 text-xs mt-2 max-w-md mx-auto">{t('desktop.collection.bulkImport.gradedColumnsMissing')}</p>}
              <div className="mt-6">
                <button onClick={close} className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-6 py-2 rounded-xl transition-colors">{t('desktop.collection.bulkImport.done')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
