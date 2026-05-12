import { ReactNode } from 'react'
import AdminShell from './_AdminShell'

// Force every /admin/* route to be rendered on demand. Admin pages query
// Supabase via the service-role client at render time; prerendering them at
// build time crashes whenever env vars aren't injected (which is the case for
// any local `next build` without `.env.local`). Vercel injects env vars at
// runtime for server components, so this has no production cost.
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: ReactNode }) {
    return <AdminShell>{children}</AdminShell>
}
