// Promote specific user to admin by email
// Usage: node scripts/promote-admin.js arisa.rukhajee@gmail.com

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.local') })

const email = process.argv[2]
if (!email) { console.error('Usage: node scripts/promote-admin.js <email>'); process.exit(1) }

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
)

const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
if (error) { console.error('Failed to list users:', error.message); process.exit(1) }

const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
if (!target) { console.error(`No user found with email: ${email}`); process.exit(1) }

const { error: updateErr } = await supabase
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', target.id)

if (updateErr) { console.error('Update failed:', updateErr.message); process.exit(1) }

const { data: profile } = await supabase.from('profiles').select('display_name, role').eq('id', target.id).single()
console.log(`✅ ${profile?.display_name ?? email} (${email}) is now role: ${profile?.role}`)
