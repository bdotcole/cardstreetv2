import { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import AdminShell from './_AdminShell'

// Force every /admin/* route to be rendered on demand. Admin pages query
// Supabase via the service-role client at render time; prerendering them at
// build time crashes whenever env vars aren't injected (which is the case for
// any local `next build` without `.env.local`). Vercel injects env vars at
// runtime for server components, so this has no production cost.
export const dynamic = 'force-dynamic'

// Defense in depth behind the middleware admin guard. The middleware
// redirect + adminGuard is the primary control; this ensures that even if a
// future routing change ever lets an /admin request skip adminGuard, these
// pages still never render service-role data to a non-admin. The login page is
// exempt (it must render to signed-out users); middleware forwards the real
// path in x-pathname, overwriting any client-supplied value.
async function assertAdmin() {
    const pathname = (await headers()).get('x-pathname') ?? ''
    if (pathname.startsWith('/admin/login')) return

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/admin/login')

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
    if (!profile || profile.role !== 'admin') redirect('/admin/login?error=not_admin')
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
    await assertAdmin()
    return <AdminShell>{children}</AdminShell>
}
