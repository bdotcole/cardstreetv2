'use client';

/**
 * Shared poll rendering: the option rows with live percentage bars, used by
 * both the viewer's compact poll card and the console's poll panel. Voting is
 * opt-in via onVote — the console renders read-only bars.
 */

import React from 'react';
import { pollTotalVotes, type LivePollRow } from '@/components/live/shared';

export function PollOptionBars({
    poll,
    myVote = null,
    onVote,
    disabled = false,
}: {
    poll: LivePollRow;
    myVote?: string | null;
    onVote?: (key: string) => void;
    disabled?: boolean;
}) {
    const tallies = poll.tallies ?? {};
    const total = pollTotalVotes(poll);
    const maxCount = Math.max(0, ...(poll.options ?? []).map((o) => tallies[o.key] ?? 0));
    const votable = !!onVote && !disabled && poll.status === 'open';

    return (
        <div className="space-y-1.5">
            {(poll.options ?? []).map((opt) => {
                const count = tallies[opt.key] ?? 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const mine = myVote === opt.key;
                const winning = poll.status === 'closed' && total > 0 && count === maxCount;
                return (
                    <button
                        key={opt.key}
                        onClick={() => votable && onVote?.(opt.key)}
                        disabled={!votable}
                        aria-pressed={mine}
                        className={`relative w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-all ${
                            mine || winning
                                ? 'border-brand-cyan/60 bg-brand-cyan/5'
                                : 'border-white/10 bg-black/20'
                        } ${votable ? 'active:scale-[0.98]' : 'cursor-default'}`}
                    >
                        <span
                            className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${
                                mine || winning ? 'bg-brand-cyan/25' : 'bg-white/10'
                            }`}
                            style={{ width: `${pct}%` }}
                        />
                        <span className="relative flex items-center gap-2">
                            <span
                                className={`flex-1 min-w-0 truncate text-xs font-bold ${
                                    mine || winning ? 'text-brand-cyan' : 'text-white/90'
                                }`}
                            >
                                {opt.label}
                            </span>
                            {mine && <i className="fa-solid fa-circle-check text-brand-cyan text-[10px] shrink-0"></i>}
                            <span className="shrink-0 text-[10px] font-black tabular-nums text-slate-300">
                                {pct}%
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
