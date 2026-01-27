import { createClient } from '@/lib/supabase/server'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data, error } = await supabase.from('profiles').select('count', { count: 'exact', head: true })

        if (error) throw error

        return Response.json({ status: 'connected', total_profiles: data || 0 })
    } catch (error: any) {
        return Response.json({
            status: 'error',
            message: error.message,
            hint: 'Check if NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local'
        }, { status: 500 })
    }
}
