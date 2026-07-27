import React from 'react';

// Slab chrome drawn around a graded listing's card art so a graded card reads
// as graded at a glance. The label bar mimics each grader's real label layout
// — wordmark left, cert-info lines center, grade descriptor over a big grade
// number right — with brand accents: PSA's red stripe on a white label, BGS's
// metallic silver (gold for a 10), CGC's dark label with a holo strip, TAG's
// black digital look. Everything is CSS-styled text; no trademarked logo
// artwork.
//
// Contract: when `company` is falsy the children render untouched, so call
// sites can wrap unconditionally. When set, the frame fills the nearest
// positioned ancestor (all listing tiles are `relative` aspect boxes) and the
// children render inside the slab's inner window — a next/image `fill` child
// fills that window. Pair with `object-contain` on the image so the whole
// card sits inside the case like a real slab.
//
// The center zone shows the real card name/set (`title`/`subtitle`) at `md`;
// at `sm` those would be sub-6px noise, so it draws faux cert-text bars the
// way a real label reads at thumbnail distance.

type SlabStyle = {
    label: string;      // label background
    border: string;     // label bottom accent
    topStrip?: string;  // thin brand stripe along the label's top edge
    holoStrip?: string; // iridescent stripe along the label's bottom edge
    wordmark: string;
    infoBar: string;    // faux cert-text lines (sm)
    infoText: string;   // real cert text (md)
    descriptor: string;
    grade: string;
};

const SLAB_STYLES: Record<string, SlabStyle> = {
    PSA: {
        label: 'bg-gradient-to-b from-white to-slate-200',
        border: 'border-b-2 border-red-600',
        topStrip: 'bg-red-600',
        wordmark: 'italic text-red-600',
        infoBar: 'bg-slate-400/80',
        infoText: 'text-slate-800',
        descriptor: 'text-slate-900',
        grade: 'text-slate-900',
    },
    // Silver label; a straight 10 swaps to BGS_GOLD below.
    BGS: {
        label: 'bg-gradient-to-b from-slate-100 via-slate-300 to-slate-400',
        border: 'border-b-2 border-slate-500',
        wordmark: 'text-blue-950',
        infoBar: 'bg-slate-600/60',
        infoText: 'text-slate-800',
        descriptor: 'text-blue-950',
        grade: 'text-blue-950',
    },
    CGC: {
        label: 'bg-gradient-to-b from-slate-800 to-slate-950',
        border: 'border-b-2 border-sky-500',
        holoStrip: 'bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500',
        wordmark: 'text-white',
        infoBar: 'bg-slate-500/80',
        infoText: 'text-slate-200',
        descriptor: 'text-sky-300',
        grade: 'text-white',
    },
    TAG: {
        label: 'bg-gradient-to-b from-zinc-900 to-black',
        border: 'border-b-2 border-cyan-400',
        wordmark: 'text-white',
        infoBar: 'bg-zinc-600/80',
        infoText: 'text-zinc-300',
        descriptor: 'text-cyan-300',
        grade: 'text-white',
    },
};

const BGS_GOLD: SlabStyle = {
    label: 'bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500',
    border: 'border-b-2 border-amber-600',
    wordmark: 'text-blue-950',
    infoBar: 'bg-amber-800/50',
    infoText: 'text-amber-950',
    descriptor: 'text-blue-950',
    grade: 'text-blue-950',
};

// SGC/ARS (importable but not offered in the listing form) and anything new.
const FALLBACK_STYLE: SlabStyle = {
    label: 'bg-gradient-to-b from-slate-600 to-slate-800',
    border: 'border-b-2 border-white/40',
    wordmark: 'text-white',
    infoBar: 'bg-slate-400/60',
    infoText: 'text-slate-200',
    descriptor: 'text-slate-200',
    grade: 'text-white',
};

// PSA-style descriptors as the generic scale; per-company overrides where the
// grader's own vocabulary is distinctive.
const GRADE_DESCRIPTORS: Record<string, string> = {
    '10': 'GEM MT', '9.5': 'MINT+', '9': 'MINT', '8.5': 'NM-MT+', '8': 'NM-MT',
    '7.5': 'NM+', '7': 'NM', '6.5': 'EX-MT+', '6': 'EX-MT', '5.5': 'EX+', '5': 'EX',
    '4.5': 'VG-EX+', '4': 'VG-EX', '3.5': 'VG+', '3': 'VG', '2.5': 'GOOD+', '2': 'GOOD',
    '1.5': 'FR', '1': 'PR',
};
const COMPANY_DESCRIPTORS: Record<string, Record<string, string>> = {
    BGS: { '10': 'PRISTINE', '9.5': 'GEM MINT' },
    CGC: { '10': 'GEM MINT' },
    TAG: { '10': 'GEM MINT' },
};

const SIZES = {
    sm: {
        pad: 'px-1.5 py-1', gap: 'gap-1.5', strip: 'h-[2px]',
        wordmark: 'text-[8px]',
        infoBar: 'h-[2px]', infoGap: 'gap-[2px]', infoText: 'text-[6px]',
        descriptor: 'text-[5px]', grade: 'text-xs',
    },
    md: {
        pad: 'px-2.5 py-1.5', gap: 'gap-2.5', strip: 'h-[3px]',
        wordmark: 'text-sm',
        infoBar: 'h-[3px]', infoGap: 'gap-[3px]', infoText: 'text-[8px]',
        descriptor: 'text-[7px]', grade: 'text-xl',
    },
};

interface GradedSlabFrameProps {
    company?: string | null;
    grade?: number | string | null;
    size?: keyof typeof SIZES;
    /** Card name for the label's cert-text zone (rendered at md only). */
    title?: string;
    /** Set name under the title (rendered at md only). */
    subtitle?: string;
    children: React.ReactNode;
}

const GradedSlabFrame: React.FC<GradedSlabFrameProps> = ({ company, grade, size = 'sm', title, subtitle, children }) => {
    if (!company) return <>{children}</>;

    const key = company.toUpperCase();
    // grade is DECIMAL(3,1): render 10.0 as "10", 9.5 as "9.5".
    const gradeNum = grade == null ? NaN : Number(grade);
    const gradeLabel = Number.isFinite(gradeNum) ? String(gradeNum) : '';
    const style = key === 'BGS' && gradeNum >= 10 ? BGS_GOLD : (SLAB_STYLES[key] ?? FALLBACK_STYLE);
    const sz = SIZES[size];
    const descriptor = gradeLabel
        ? COMPANY_DESCRIPTORS[key]?.[gradeLabel] ?? GRADE_DESCRIPTORS[gradeLabel] ?? null
        : null;

    return (
        <div className="absolute inset-0 flex flex-col bg-slate-950">
            {/* Acrylic-case sheen over the whole slab */}
            <div className="absolute inset-0 z-10 pointer-events-none ring-1 ring-inset ring-white/25 bg-gradient-to-br from-white/10 via-transparent to-white/5" />
            {/* Inner case: label + card window */}
            <div className="relative flex flex-col flex-1 min-h-0 m-[6%] my-[4%] rounded-sm overflow-hidden border border-white/15 shadow-lg shadow-black/60">
                <div className={`relative shrink-0 ${style.label} ${style.border}`}>
                    {style.topStrip && <div className={`${sz.strip} ${style.topStrip}`} />}
                    <div className={`flex items-center ${sz.gap} ${sz.pad}`}>
                        <span className={`font-black tracking-wider leading-none shrink-0 ${sz.wordmark} ${style.wordmark}`}>{key}</span>
                        <div className="flex-1 min-w-0">
                            {size === 'md' && title ? (
                                <div className="flex flex-col leading-tight min-w-0">
                                    <span className={`truncate font-bold uppercase tracking-wide ${sz.infoText} ${style.infoText}`}>{title}</span>
                                    {subtitle && (
                                        <span className={`truncate font-semibold uppercase tracking-wide opacity-70 ${sz.infoText} ${style.infoText}`}>{subtitle}</span>
                                    )}
                                </div>
                            ) : (
                                <div className={`flex flex-col ${sz.infoGap}`}>
                                    <div className={`rounded-full w-4/5 ${sz.infoBar} ${style.infoBar}`} />
                                    <div className={`rounded-full w-1/2 ${sz.infoBar} ${style.infoBar}`} />
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col items-end leading-none shrink-0">
                            {descriptor && (
                                <span className={`font-bold tracking-wider ${sz.descriptor} ${style.descriptor}`}>{descriptor}</span>
                            )}
                            <span className={`font-black ${sz.grade} ${style.grade}`}>{gradeLabel}</span>
                        </div>
                    </div>
                    {style.holoStrip && <div className={`${sz.strip} ${style.holoStrip}`} />}
                </div>
                <div className="relative flex-1 min-h-0 bg-slate-950">{children}</div>
            </div>
        </div>
    );
};

export default GradedSlabFrame;
