import React from 'react';

// Slab chrome drawn around a graded listing's card art so a graded card reads
// as graded at a glance: an acrylic-case border plus a company-colored label
// bar (company left, grade right). Colors evoke each grader's real label —
// PSA's red-on-white, Beckett's gold-on-black, CGC's blue, TAG's cyan digital
// look — but everything is CSS-styled text; no trademarked logo artwork.
//
// Contract: when `company` is falsy the children render untouched, so call
// sites can wrap unconditionally. When set, the frame fills the nearest
// positioned ancestor (all listing tiles are `relative` aspect boxes) and the
// children render inside the slab's inner window — a next/image `fill` child
// fills that window. Pair with `object-contain` on the image so the whole
// card sits inside the case like a real slab.

type SlabStyle = {
    label: string;   // label-bar background
    company: string; // company wordmark text
    grade: string;   // grade text
};

const SLAB_STYLES: Record<string, SlabStyle> = {
    PSA: {
        label: 'bg-gradient-to-b from-white to-slate-200 border-b-2 border-red-600',
        company: 'text-red-600',
        grade: 'text-slate-900',
    },
    BGS: {
        label: 'bg-gradient-to-b from-neutral-800 to-black border-b-2 border-amber-400',
        company: 'text-amber-400',
        grade: 'text-amber-300',
    },
    CGC: {
        label: 'bg-gradient-to-b from-slate-700 to-slate-900 border-b-2 border-sky-500',
        company: 'text-sky-400',
        grade: 'text-white',
    },
    TAG: {
        label: 'bg-gradient-to-b from-zinc-800 to-black border-b-2 border-cyan-400',
        company: 'text-cyan-300',
        grade: 'text-white',
    },
};

// SGC/ARS (importable but not offered in the listing form) and anything new.
const FALLBACK_STYLE: SlabStyle = {
    label: 'bg-gradient-to-b from-slate-600 to-slate-800 border-b-2 border-white/40',
    company: 'text-white',
    grade: 'text-white',
};

const SIZES = {
    sm: { label: 'px-1.5 py-[3px]', company: 'text-[8px]', grade: 'text-[9px]' },
    md: { label: 'px-3 py-1.5', company: 'text-xs', grade: 'text-sm' },
};

interface GradedSlabFrameProps {
    company?: string | null;
    grade?: number | string | null;
    size?: keyof typeof SIZES;
    children: React.ReactNode;
}

const GradedSlabFrame: React.FC<GradedSlabFrameProps> = ({ company, grade, size = 'sm', children }) => {
    if (!company) return <>{children}</>;

    const key = company.toUpperCase();
    const style = SLAB_STYLES[key] ?? FALLBACK_STYLE;
    const sz = SIZES[size];
    // grade is DECIMAL(3,1): render 10.0 as "10", 9.5 as "9.5".
    const gradeNum = grade == null ? NaN : Number(grade);
    const gradeLabel = Number.isFinite(gradeNum) ? String(gradeNum) : '';

    return (
        <div className="absolute inset-0 flex flex-col bg-slate-950">
            {/* Acrylic-case sheen over the whole slab */}
            <div className="absolute inset-0 z-10 pointer-events-none ring-1 ring-inset ring-white/25 bg-gradient-to-br from-white/10 via-transparent to-white/5" />
            {/* Inner case: label bar + card window */}
            <div className="relative flex flex-col flex-1 min-h-0 m-[6%] my-[4%] rounded-sm overflow-hidden border border-white/15 shadow-lg shadow-black/60">
                <div className={`flex items-center justify-between gap-1 ${sz.label} ${style.label}`}>
                    <span className={`font-black italic tracking-wider leading-none ${sz.company} ${style.company}`}>{key}</span>
                    {gradeLabel && <span className={`font-black leading-none ${sz.grade} ${style.grade}`}>{gradeLabel}</span>}
                </div>
                <div className="relative flex-1 min-h-0 bg-slate-950">{children}</div>
            </div>
        </div>
    );
};

export default GradedSlabFrame;
