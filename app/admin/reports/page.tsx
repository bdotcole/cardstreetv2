import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

async function getReports() {
    const supabase = createAdminClient();
    const { data } = await supabase
        .from('reports')
        .select(`
            *,
            reporter:profiles!reports_reporter_id_fkey(display_name, email)
        `)
        .order('created_at', { ascending: false });
    
    return data || [];
}

const STATUS_COLORS: Record<string, string> = {
    'Open': 'bg-brand-purple/20 text-brand-purple border border-brand-purple/30',
    'Reviewed': 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30',
    'Resolved': 'bg-brand-green/20 text-brand-green border border-brand-green/30',
    'Dismissed': 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
};

export default async function AdminReportsPage() {
    const reports = await getReports();

    // Server actions
    const updateStatus = async (formData: FormData) => {
        'use server';
        const id = formData.get('id') as string;
        const status = formData.get('status') as string;

        const supabase = createAdminClient();
        await supabase
            .from('reports')
            .update({ status })
            .eq('id', id);

        revalidatePath('/admin/reports');
        revalidatePath('/admin');
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div>
                <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">User Reports</h1>
                <p className="text-slate-500 text-sm mt-1">Review and manage reports submitted by users</p>
            </div>

            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/10 bg-black/20 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <th className="p-4">Date</th>
                                <th className="p-4">Reporter</th>
                                <th className="p-4">Target Type</th>
                                <th className="p-4">Target Reason & Details</th>
                                <th className="p-4 text-center">Status</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {reports.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-10 text-center text-slate-500 font-semibold">
                                        No reports found.
                                    </td>
                                </tr>
                            ) : reports.map((report) => (
                                <tr key={report.id} className="hover:bg-white/5 transition-colors">
                                    <td className="p-4 align-top">
                                        <p className="text-xs text-slate-300 font-mono">
                                            {new Date(report.created_at).toLocaleDateString()}
                                        </p>
                                    </td>
                                    <td className="p-4 align-top">
                                        <p className="text-sm font-bold text-white">{(report.reporter as any)?.display_name || 'Anonymous'}</p>
                                        <p className="text-[10px] text-slate-500 truncate max-w-[120px]">{(report.reporter as any)?.email}</p>
                                    </td>
                                    <td className="p-4 align-top">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] uppercase tracking-widest font-black text-brand-cyan bg-brand-cyan/10 px-2 py-0.5 rounded">
                                                {report.entity_type}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 font-mono mt-1 break-all max-w-[120px]">{report.entity_id}</p>
                                    </td>
                                    <td className="p-4 align-top max-w-sm">
                                        <p className="text-sm font-bold text-brand-red mb-1">{report.reason}</p>
                                        <p className="text-xs text-slate-400 leading-relaxed bg-black/40 p-3 rounded-xl border border-white/5">
                                            {report.description || 'No additional details provided.'}
                                        </p>
                                        {report.entity_name && (
                                            <p className="text-[10px] text-slate-500 mt-2 font-bold uppercase">
                                                Target: <span className="text-slate-300 normal-case font-normal">{report.entity_name}</span>
                                            </p>
                                        )}
                                    </td>
                                    <td className="p-4 align-top text-center">
                                        <span className={`inline-block text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${STATUS_COLORS[report.status] || STATUS_COLORS['Open']}`}>
                                            {report.status}
                                        </span>
                                    </td>
                                    <td className="p-4 align-top text-right space-y-2">
                                        <form action={updateStatus}>
                                            <input type="hidden" name="id" value={report.id} />
                                            <input type="hidden" name="status" value="Resolved" />
                                            <button 
                                                disabled={report.status === 'Resolved'}
                                                className="w-full text-left px-3 py-1.5 text-xs font-bold text-brand-green hover:bg-brand-green/10 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                                            >
                                                Mark Resolved
                                            </button>
                                        </form>
                                        <form action={updateStatus}>
                                            <input type="hidden" name="id" value={report.id} />
                                            <input type="hidden" name="status" value="Dismissed" />
                                            <button 
                                                disabled={report.status === 'Dismissed'}
                                                className="w-full text-left px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                                            >
                                                Dismiss
                                            </button>
                                        </form>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
