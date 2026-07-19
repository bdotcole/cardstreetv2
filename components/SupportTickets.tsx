'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, MessageSquare, ChevronDown, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import CustomSelect from './CustomSelect';

interface SupportTicket {
    id: string;
    subject: string;
    description: string;
    category: string;
    status: string;
    admin_reply: string | null;
    replied_at: string | null;
    created_at: string;
}

// Values must match the DB CHECK constraint on support_tickets.category —
// labels are localized, but the stored value stays English.
const CATEGORIES = ['General', 'Technical', 'Billing', 'Card Valuation'] as const;

const CATEGORY_KEYS: Record<string, string> = {
    'General': 'general',
    'Technical': 'technical',
    'Billing': 'billing',
    'Card Valuation': 'cardValuation',
};

const STATUS_KEYS: Record<string, string> = {
    'Open': 'open',
    'In Progress': 'inProgress',
    'Resolved': 'resolved',
};

const STATUS_COLORS: Record<string, string> = {
    'Open': 'bg-brand-red/20 text-brand-red border-brand-red/30',
    'In Progress': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'Resolved': 'bg-brand-green/20 text-brand-green border-brand-green/30',
};

// Rendered inside Profile's Support panel, which is only reachable when a
// session exists — so no logged-out state is handled here. Reads go straight
// through the browser Supabase client (RLS scopes rows to the owner); writes
// go through POST /api/admin/tickets, which takes user_id from the session.
const SupportTickets: React.FC = () => {
    const { t } = useTranslation();
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const [formOpen, setFormOpen] = useState(false);
    const [subject, setSubject] = useState('');
    const [category, setCategory] = useState<string>(CATEGORIES[0]);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const fetchTickets = useCallback(async () => {
        try {
            const supabase = createClient();
            const { data, error } = await supabase
                .from('support_tickets')
                .select('id, subject, description, category, status, admin_reply, replied_at, created_at')
                .order('created_at', { ascending: false });
            if (!error) setTickets(data ?? []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTickets(); }, [fetchTickets]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!subject.trim() || !description.trim()) return;
        setSubmitting(true);
        setErrorMessage('');
        try {
            const res = await fetch('/api/admin/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject: subject.trim(), description: description.trim(), category }),
            });
            if (res.ok) {
                const { ticket } = await res.json();
                setTickets(prev => [ticket, ...prev]);
                setSubject('');
                setDescription('');
                setCategory(CATEGORIES[0]);
                setFormOpen(false);
                setSuccessMessage(t('supportTickets.successMessage'));
                setTimeout(() => setSuccessMessage(''), 4000);
            } else {
                setErrorMessage(t('supportTickets.failed'));
            }
        } catch {
            setErrorMessage(t('supportTickets.failed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('supportTickets.title')}</h3>
                {!formOpen && (
                    <button
                        onClick={() => { setFormOpen(true); setSuccessMessage(''); }}
                        className="flex items-center gap-1.5 text-xs font-bold text-brand-cyan hover:brightness-110 transition-all"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {t('supportTickets.newTicket')}
                    </button>
                )}
            </div>

            {successMessage && (
                <div className="text-xs font-bold text-brand-green bg-brand-green/10 p-3 rounded-xl border border-brand-green/20">
                    {successMessage}
                </div>
            )}

            {formOpen && (
                <form onSubmit={handleSubmit} className="glass rounded-2xl border border-white/5 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black text-white uppercase tracking-widest">{t('supportTickets.newTicket')}</p>
                        <button
                            type="button"
                            onClick={() => { setFormOpen(false); setErrorMessage(''); }}
                            className="p-1 text-slate-500 hover:text-white transition-colors"
                            aria-label={t('supportTickets.cancel')}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {errorMessage && (
                        <div className="text-xs font-bold text-brand-red bg-brand-red/10 p-3 rounded-xl border border-brand-red/20">
                            {errorMessage}
                        </div>
                    )}

                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                            {t('supportTickets.category')}
                        </label>
                        <CustomSelect
                            ariaLabel={t('supportTickets.category')}
                            value={category}
                            onChange={setCategory}
                            options={CATEGORIES.map(c => ({
                                value: c,
                                label: t(`supportTickets.categories.${CATEGORY_KEYS[c]}`),
                            }))}
                        />
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                            {t('supportTickets.subject')}
                        </label>
                        <input
                            type="text"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            maxLength={200}
                            required
                            placeholder={t('supportTickets.subjectPlaceholder')}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-cyan"
                        />
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                            {t('supportTickets.description')}
                        </label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            maxLength={5000}
                            required
                            placeholder={t('supportTickets.descriptionPlaceholder')}
                            className="w-full h-28 bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-cyan resize-none"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black text-xs uppercase tracking-widest rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('supportTickets.submit')}
                    </button>
                </form>
            )}

            <div className="glass rounded-2xl border border-white/5 overflow-hidden divide-y divide-white/5">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                    </div>
                ) : tickets.length === 0 ? (
                    <p className="px-4 py-8 text-center text-slate-500 text-xs">{t('supportTickets.noTickets')}</p>
                ) : tickets.map(ticket => {
                    const expanded = expandedId === ticket.id;
                    return (
                        <div key={ticket.id}>
                            <button
                                onClick={() => setExpandedId(expanded ? null : ticket.id)}
                                className="w-full text-left p-4 hover:bg-white/[0.02] transition-colors"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-white truncate">{ticket.subject}</p>
                                        <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                                            {t(`supportTickets.categories.${CATEGORY_KEYS[ticket.category] ?? 'general'}`)}
                                            {' · '}{new Date(ticket.created_at).toLocaleDateString()}
                                            {ticket.admin_reply && <MessageSquare className="w-3 h-3 text-brand-cyan" />}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${STATUS_COLORS[ticket.status] ?? ''}`}>
                                            {t(`supportTickets.status.${STATUS_KEYS[ticket.status] ?? 'open'}`)}
                                        </span>
                                        <ChevronDown className={`w-3.5 h-3.5 text-slate-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                                    </div>
                                </div>
                            </button>
                            {expanded && (
                                <div className="px-4 pb-4 space-y-3">
                                    <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap bg-black/30 p-3 rounded-xl border border-white/5">
                                        {ticket.description}
                                    </p>
                                    {ticket.admin_reply && (
                                        <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-3 space-y-1.5">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-brand-cyan">
                                                {t('supportTickets.adminReply')}
                                            </p>
                                            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{ticket.admin_reply}</p>
                                            {ticket.replied_at && (
                                                <p className="text-[9px] text-slate-600">{new Date(ticket.replied_at).toLocaleString()}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SupportTickets;
