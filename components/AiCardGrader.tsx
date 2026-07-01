'use client';

import React, { useRef, useState } from 'react';

/**
 * AI Card Grader (premium).
 *
 * Guided multi-angle capture -> POST /api/grade -> estimated PSA-style grade.
 * Self-contained: posts to the server route (which holds the authoritative
 * premium gate) and needs no app-shell providers, so it can mount on its own
 * page. Optional card context (cardId/cardName/game) lets it be launched from
 * an already-identified card later.
 */

type Angle = 'front' | 'back' | 'surface';

interface AiCardGraderProps {
  cardId?: string;
  cardName?: string;
  game?: string;
}

interface GradeResult {
  id: string | null;
  overall: number;
  label: string;
  centering: number;
  corners: number;
  edges: number;
  surface: number;
  confidence: number;
  notes: {
    centering: string;
    corners: string;
    edges: string;
    surface: string;
    summary: string;
    imageQuality: 'good' | 'fair' | 'poor';
  };
  disclaimer: string;
}

const SLOTS: { angle: Angle; label: string; hint: string; required: boolean }[] = [
  { angle: 'front', label: 'Front', hint: 'Straight on, fills the frame', required: true },
  { angle: 'back', label: 'Back', hint: 'Improves centering accuracy', required: false },
  { angle: 'surface', label: 'Surface', hint: 'Slight angle under light, catches scratches', required: false },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Downscale on-device before upload: keeps the request small and snappy while
// leaving enough detail for the model to read corners/edges/surface.
async function fileToDataUrl(file: File, max = 1400, quality = 0.9): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function gradeColor(v: number): string {
  if (v >= 9) return 'text-emerald-400';
  if (v >= 7) return 'text-brand-cyan';
  if (v >= 5) return 'text-amber-400';
  return 'text-rose-400';
}
function barColor(v: number): string {
  if (v >= 9) return 'bg-emerald-400';
  if (v >= 7) return 'bg-brand-cyan';
  if (v >= 5) return 'bg-amber-400';
  return 'bg-rose-400';
}

const SubGradeRow: React.FC<{ label: string; value: number; note: string }> = ({ label, value, note }) => (
  <div>
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{label}</span>
      <span className={`text-sm font-black ${gradeColor(value)}`}>{value.toFixed(1)}</span>
    </div>
    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
      <div className={`h-full rounded-full ${barColor(value)}`} style={{ width: `${value * 10}%` }} />
    </div>
    {note && <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{note}</p>}
  </div>
);

const AiCardGrader: React.FC<AiCardGraderProps> = ({ cardId, cardName, game }) => {
  const [images, setImages] = useState<Partial<Record<Angle, string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const inputs = useRef<Partial<Record<Angle, HTMLInputElement | null>>>({});

  const onPick = async (angle: Angle, file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      setImages((prev) => ({ ...prev, [angle]: dataUrl }));
    } catch {
      setError('Could not read that photo. Try another.');
    }
  };

  const canGrade = !!images.front && !loading;

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const payloadImages = (['front', 'back', 'surface'] as Angle[])
        .filter((a) => images[a])
        .map((a) => ({ angle: a, image: images[a]! }));

      const res = await fetch('/api/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: payloadImages, cardId, cardName, game }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Grading failed');
      setResult(data as GradeResult);
    } catch (e: any) {
      setError(e.message || 'Grading failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setImages({});
    setResult(null);
    setError(null);
  };

  if (result) {
    const conf = Math.round(result.confidence * 100);
    return (
      <div className="w-full max-w-[440px] mx-auto">
        <div className="glass rounded-[2rem] border-white/10 p-7">
          <div className="flex flex-col items-center text-center">
            <span className="text-[9px] text-slate-500 font-black uppercase tracking-[0.3em] mb-3">Estimated Grade</span>
            <div className="w-28 h-28 rounded-full border-4 border-white/10 flex items-center justify-center mb-3">
              <span className={`text-5xl font-black ${gradeColor(result.overall)}`}>{result.overall.toFixed(1)}</span>
            </div>
            <h3 className="text-xl font-black text-white tracking-tight uppercase italic skew-x-[-10deg]">{result.label}</h3>
            {cardName && <p className="text-xs text-slate-400 mt-1">{cardName}</p>}
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">Confidence {conf}%</span>
          </div>

          {result.notes.summary && (
            <p className="text-sm text-slate-300 leading-relaxed text-center mt-5">{result.notes.summary}</p>
          )}

          <div className="space-y-4 mt-6">
            <SubGradeRow label="Centering" value={result.centering} note={result.notes.centering} />
            <SubGradeRow label="Corners" value={result.corners} note={result.notes.corners} />
            <SubGradeRow label="Edges" value={result.edges} note={result.notes.edges} />
            <SubGradeRow label="Surface" value={result.surface} note={result.notes.surface} />
          </div>

          {result.notes.imageQuality !== 'good' && (
            <div className="mt-5 flex items-start gap-2 rounded-2xl bg-amber-400/10 border border-amber-400/20 p-3">
              <i className="fa-solid fa-triangle-exclamation text-amber-400 text-xs mt-0.5"></i>
              <p className="text-[11px] text-amber-200/90 leading-snug">
                Photo quality was {result.notes.imageQuality}. Brighter, sharper, glare-free shots give a more reliable estimate.
              </p>
            </div>
          )}

          <div className="mt-5 rounded-2xl bg-white/5 border border-white/5 p-3">
            <p className="text-[10px] text-slate-500 leading-snug">{result.disclaimer}</p>
          </div>
        </div>

        <button
          onClick={reset}
          className="mt-5 w-full h-14 rounded-2xl bg-brand-cyan text-brand-darker font-black text-[11px] uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <i className="fa-solid fa-rotate"></i> Grade Another Card
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[440px] mx-auto">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-4">
          <i className="fa-solid fa-wand-magic-sparkles text-brand-cyan text-xl"></i>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight uppercase italic skew-x-[-10deg]">AI Card Grader</h2>
        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">Snap a few angles for an estimated grade</p>
      </div>

      <div className="space-y-3">
        {SLOTS.map(({ angle, label, hint, required }) => {
          const captured = images[angle];
          return (
            <div key={angle}>
              <input
                ref={(el) => { inputs.current[angle] = el; }}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onPick(angle, e.target.files?.[0])}
              />
              <button
                onClick={() => inputs.current[angle]?.click()}
                className="w-full glass rounded-3xl border-white/10 p-4 flex items-center gap-4 text-left active:scale-95 transition-all"
              >
                <div className="w-16 h-[5.5rem] rounded-xl overflow-hidden bg-white/5 flex-shrink-0 flex items-center justify-center">
                  {captured ? (
                    <img src={captured} alt={label} className="w-full h-full object-cover" />
                  ) : (
                    <i className="fa-solid fa-camera text-slate-600"></i>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-bold">{label}</span>
                    {required ? (
                      <span className="text-[8px] bg-brand-cyan/10 text-brand-cyan font-black uppercase px-2 py-0.5 rounded-full tracking-widest">Required</span>
                    ) : (
                      <span className="text-[8px] bg-white/5 text-slate-500 font-black uppercase px-2 py-0.5 rounded-full tracking-widest">Optional</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{hint}</p>
                </div>
                <i className={`fa-solid ${captured ? 'fa-circle-check text-emerald-400' : 'fa-chevron-right text-slate-600'}`}></i>
              </button>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-rose-500/10 border border-rose-500/20 p-3">
          <i className="fa-solid fa-triangle-exclamation text-rose-400 text-xs mt-0.5"></i>
          <p className="text-[11px] text-rose-200/90 leading-snug">{error}</p>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!canGrade}
        className="mt-5 w-full h-14 rounded-2xl bg-brand-cyan text-brand-darker font-black text-[11px] uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:active:scale-100"
      >
        {loading ? (
          <><i className="fa-solid fa-circle-notch animate-spin"></i> Grading…</>
        ) : (
          <><i className="fa-solid fa-wand-magic-sparkles"></i> Grade My Card</>
        )}
      </button>

      <p className="text-[10px] text-slate-600 text-center leading-snug mt-4 px-4">
        Estimate only — not an official PSA, BGS, or CGC grade.
      </p>
    </div>
  );
};

export default AiCardGrader;
