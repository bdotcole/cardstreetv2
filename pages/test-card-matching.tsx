import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Head from 'next/head';

export default function TestCardMatching() {
    const [loading, setLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
    const [stats, setStats] = useState({ mapped: 0, priced: 0, failed: 0 });
    const [showStats, setShowStats] = useState(false);
    const [mappings, setMappings] = useState<any[]>([]);
    const [showMappings, setShowMappings] = useState(false);
    const [isAutoRunning, setIsAutoRunning] = useState(false);
    const [runCount, setRunCount] = useState(0);

    const supabase = createClient();

    const showStatus = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
        setStatusMessage(message);
        setStatusType(type);
    };

    const getConfidenceBadgeClass = (score: number) => {
        if (score >= 0.9) return 'confidence-high';
        if (score < 0.75) return 'confidence-low';
        return 'confidence-medium';
    };

    // Auto-run effect
    useEffect(() => {
        let timeoutId: NodeJS.Timeout;
        if (isAutoRunning && !loading) {
            timeoutId = setTimeout(() => {
                runMatching();
            }, 2000); // 2 second delay between runs
        }
        return () => clearTimeout(timeoutId);
    }, [isAutoRunning, loading, runCount]);

    const runMatching = async () => {
        try {
            setLoading(true);
            showStatus('Triggering Edge Function...', 'info');

            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

            const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/daily-market-update`;

            const response = await fetch(functionUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();

            if (result.success) {
                showStatus(`✓ Matching completed at ${new Date(result.timestamp).toLocaleString()}`, 'success');
                setStats({
                    mapped: (stats.mapped || 0) + (result.mapped || 0),
                    priced: (stats.priced || 0) + (result.priced || 0),
                    failed: (stats.failed || 0) + (result.failed || 0),
                });
                setShowStats(true);
                setRunCount(prev => prev + 1);
                await loadRecentMappings();
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error: any) {
            console.error('Error:', error);
            showStatus(`✗ Error: ${error.message}`, 'error');
            // Stop auto-run on error to prevent infinite error loops
            if (isAutoRunning) setIsAutoRunning(false);
        } finally {
            setLoading(false);
        }
    };

    const loadRecentMappings = async () => {
        try {
            const { data, error } = await supabase
                .from('card_mappings')
                .select(`
                    *,
                    thai_card:card_id_th (name, set_id),
                    english_card:card_id_en (name, set_id)
                `)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;

            if (data && data.length > 0) {
                setMappings(data);
                setShowMappings(true);
            } else {
                showStatus('No mappings found yet. Click "Run Card Matching" to create mappings.', 'info');
            }
        } catch (error: any) {
            console.error('Error loading mappings:', error);
            showStatus(`✗ Error loading mappings: ${error.message}`, 'error');
        }
    };

    const clearResults = () => {
        setStatusMessage('');
        setShowStats(false);
        setShowMappings(false);
        setMappings([]);
        setStats({ mapped: 0, priced: 0, failed: 0 });
    };

    useEffect(() => {
        loadRecentMappings();
    }, []);

    return (
        <>
            <Head>
                <title>Test Card Matching - CardStreet TCG</title>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
            </Head>

            <div className="min-h-screen bg-gradient-to-br from-purple-600 to-purple-800 p-8">
                <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-2xl p-10">
                    <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent">
                        🃏 Card Matching Test Interface
                    </h1>
                    <p className="text-gray-600 mb-8">Test the Thai-to-English card matching Edge Function</p>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
                        <strong>⚠️ Configuration:</strong> This test interface uses your environment&apos;s Supabase credentials.
                    </div>

                    <div className="flex gap-4 mb-8">
                        <button
                            onClick={runMatching}
                            disabled={loading}
                            className="bg-gradient-to-r from-purple-600 to-purple-800 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {loading ? '⏳ Running...' : 'Run Card Matching'}
                        </button>
                        <button
                            onClick={clearResults}
                            className="bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                        >
                            Clear Results
                        </button>
                        <button
                            onClick={() => setIsAutoRunning(!isAutoRunning)}
                            className={`px-6 py-3 rounded-lg font-semibold transition-all ${isAutoRunning
                                    ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                                    : 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'
                                }`}
                        >
                            {isAutoRunning ? '⏹ Stop Asuo-Run' : '▶ Auto-Run (Loop)'}
                        </button>
                    </div>

                    {statusMessage && (
                        <div className={`p-4 rounded-lg mb-8 font-mono text-sm ${statusType === 'error' ? 'bg-red-50 text-red-700 border-l-4 border-red-500' :
                            statusType === 'success' ? 'bg-green-50 text-green-700 border-l-4 border-green-500' :
                                'bg-blue-50 text-blue-700 border-l-4 border-blue-500'
                            }`}>
                            {statusMessage}
                        </div>
                    )}

                    {showStats && (
                        <div className="grid grid-cols-3 gap-4 mb-8">
                            <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl border border-purple-200">
                                <div className="text-sm text-gray-600 font-semibold uppercase tracking-wide mb-2">Mapped</div>
                                <div className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent">
                                    {stats.mapped}
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl border border-purple-200">
                                <div className="text-sm text-gray-600 font-semibold uppercase tracking-wide mb-2">Priced</div>
                                <div className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent">
                                    {stats.priced}
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl border border-purple-200">
                                <div className="text-sm text-gray-600 font-semibold uppercase tracking-wide mb-2">Failed</div>
                                <div className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent">
                                    {stats.failed}
                                </div>
                            </div>
                        </div>
                    )}

                    {showMappings && mappings.length > 0 && (
                        <div>
                            <h2 className="text-2xl font-bold mb-4">Recent Mappings</h2>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-gradient-to-r from-purple-600 to-purple-800 text-white">
                                            <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider">Thai Card</th>
                                            <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider">English Card</th>
                                            <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider">Set</th>
                                            <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider">Confidence</th>
                                            <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider">Method</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mappings.map((m, idx) => (
                                            <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                                                <td className="px-6 py-4">{m.thai_card?.name || 'N/A'}</td>
                                                <td className="px-6 py-4">{m.english_card?.name || 'N/A'}</td>
                                                <td className="px-6 py-4"><strong>{m.english_card?.set_id || 'N/A'}</strong></td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getConfidenceBadgeClass(m.confidence_score) === 'confidence-high' ? 'bg-green-100 text-green-800' :
                                                        getConfidenceBadgeClass(m.confidence_score) === 'confidence-low' ? 'bg-red-100 text-red-800' :
                                                            'bg-yellow-100 text-yellow-800'
                                                        }`}>
                                                        {(m.confidence_score * 100).toFixed(0)}%
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">{m.match_method || 'N/A'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style jsx global>{`
                body {
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                }
            `}</style>
        </>
    );
}
