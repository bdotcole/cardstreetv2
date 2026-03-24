'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminSetsPage() {
    const supabase = createClientComponentClient()
    const router = useRouter()
    
    const [bridges, setBridges] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    // Modal state
    const [showModal, setShowModal] = useState(false)
    const [newThaiSetId, setNewThaiSetId] = useState('')
    const [newEnSetId, setNewEnSetId] = useState('')
    const [newJtcgSlug, setNewJtcgSlug] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        loadSets()
    }, [])

    async function loadSets() {
        setLoading(true)
        // Load set_bridge combined with marketplace_configs
        const { data: bData } = await supabase
            .from('set_bridge')
            .select(`
                id, thai_set_id, english_set_id, jp_set_id
            `)
            .order('created_at', { ascending: false })

        const { data: mData } = await supabase
            .from('marketplace_configs')
            .select('*')

        const mapConfig = new Map(mData?.map(m => [m.set_id, m.justtcg_slug]))

        const mapped = (bData || []).map(b => ({
            ...b,
            justtcg_slug: mapConfig.get(b.english_set_id) || 'Missing',
        }))

        setBridges(mapped)
        setLoading(false)
    }

    async function handleAddSet(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)

        try {
            // Insert config
            await supabase.from('marketplace_configs').upsert({
                set_id: newEnSetId,
                justtcg_slug: newJtcgSlug
            })

            // Insert bridge
            await supabase.from('set_bridge').upsert({
                thai_set_id: newThaiSetId,
                english_set_id: newEnSetId
            }, { onConflict: 'thai_set_id' })

            setShowModal(false)
            setNewThaiSetId('')
            setNewEnSetId('')
            setNewJtcgSlug('')
            loadSets()
        } catch (err) {
            alert('Failed to save set mapping')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Set Management</h1>
                    <p className="text-slate-500 text-sm mt-1">Configure automated pricing bridges</p>
                </div>
                <button 
                    onClick={() => setShowModal(true)}
                    className="bg-brand-cyan text-black px-4 py-2 rounded-xl text-sm font-bold shadow-lg shadow-brand-cyan/20 hover:scale-105 transition-transform"
                >
                    <i className="fa-solid fa-plus mr-2" /> Add Match
                </button>
            </div>

            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="text-xs uppercase bg-[#0f1419] border-b border-white/10 italic tracking-wider">
                            <tr>
                                <th className="px-6 py-4 font-black">Thai Set ID</th>
                                <th className="px-6 py-4 font-black">English Set ID</th>
                                <th className="px-6 py-4 font-black w-1/3">JustTCG Slug</th>
                                <th className="px-6 py-4 font-black text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">Loading...</td>
                                </tr>
                            ) : bridges.map((row) => (
                                <tr key={row.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="px-6 py-4 font-bold text-white">{row.thai_set_id}</td>
                                    <td className="px-6 py-4">{row.english_set_id}</td>
                                    <td className="px-6 py-4 font-mono text-xs text-brand-cyan/80">
                                        {row.justtcg_slug}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="text-slate-500 hover:text-white transition">
                                            <i className="fa-solid fa-ellipsis-vertical" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-[#0f1419] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                            <h2 className="text-lg font-black text-white italic">Add Set Match</h2>
                            <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white">
                                <i className="fa-solid fa-xmark" />
                            </button>
                        </div>
                        <form onSubmit={handleAddSet} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">Thai Set ID (e.g. MA4)</label>
                                <input 
                                    required 
                                    value={newThaiSetId}
                                    onChange={e => setNewThaiSetId(e.target.value)}
                                    className="w-full bg-[#0a0d12] border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-brand-cyan" 
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">English Set ID (e.g. sv11)</label>
                                <input 
                                    required 
                                    value={newEnSetId}
                                    onChange={e => setNewEnSetId(e.target.value)}
                                    className="w-full bg-[#0a0d12] border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-brand-cyan" 
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">JustTCG Slug</label>
                                <input 
                                    required 
                                    value={newJtcgSlug}
                                    onChange={e => setNewJtcgSlug(e.target.value)}
                                    className="w-full bg-[#0a0d12] border border-white/10 rounded-xl px-4 py-2 text-white font-mono text-xs focus:outline-none focus:border-brand-cyan" 
                                />
                            </div>
                            <div className="pt-4 flex items-center justify-end gap-3">
                                <button 
                                    type="button" 
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    disabled={saving}
                                    className="bg-brand-cyan text-black px-6 py-2 rounded-xl text-sm font-black disabled:opacity-50 hover:bg-cyan-400 transition-colors"
                                >
                                    {saving ? 'Saving...' : 'Save Match'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
