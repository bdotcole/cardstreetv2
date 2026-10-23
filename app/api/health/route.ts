import { createClient } from '@/lib/supabase/server'

// Vercel only lets us choose the Node.js major; it rolls minor/patch (security)
// updates out itself, and nothing else tells us which patch the deployed functions
// run. Disclosing the exact version publicly would hand attackers a version to
// target, so it is only returned to a caller holding CRON_SECRET.
function runtimeInfo(request: Request): { node?: string } {
    const secret = process.env.CRON_SECRET
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return {}
    return { node: process.version }
}

export async function GET(request: Request) {
    const runtime = runtimeInfo(request)
    try {
        const supabase = await createClient()
        const { data, error } = await supabase.from('profiles').select('count', { count: 'exact', head: true })

        if (error) throw error

        return Response.json({ status: 'connected', total_profiles: data || 0, ...runtime })
    } catch (error: any) {
        return Response.json({
            status: 'error',
            message: error.message,
            hint: 'Check if NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local',
            ...runtime
        }, { status: 500 })
    }
}
