// Admin setup script: runs migration + promotes first user to admin
// Usage: node scripts/setup-admin.js

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
)

async function main() {
    console.log('\n📋 Step 1: Listing all users...\n')

    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 100 })
    if (listErr) { console.error('❌ Failed to list users:', listErr.message); process.exit(1) }

    if (!users.length) { console.error('❌ No users found!'); process.exit(1) }

    // Print all users
    users.forEach((u, i) => {
        console.log(`  [${i}] ${u.email ?? '(no email)'} | id: ${u.id} | created: ${u.created_at}`)
    })

    // Pick the earliest created user (most likely the owner/admin)
    const sorted = [...users].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const targetUser = sorted[0]

    console.log(`\n🎯 Promoting to admin: ${targetUser.email} (${targetUser.id})\n`)

    // Upsert profile with role = admin (in case profile doesn't exist yet)
    const { error: updateErr } = await supabase
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', targetUser.id)

    if (updateErr) {
        console.error('❌ Failed to update profile role:', updateErr.message)
        console.log('\n💡 The migration SQL may not have run yet (role column missing).')
        console.log('   Please run the browser migration first, then re-run this script.\n')
        process.exit(1)
    }

    // Verify
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, display_name, role')
        .eq('id', targetUser.id)
        .single()

    if (profile?.role === 'admin') {
        console.log(`✅ Success! ${profile.display_name ?? targetUser.email} is now an admin.`)
        console.log(`   User ID: ${targetUser.id}`)
        console.log(`   Role: ${profile.role}\n`)
    } else {
        console.error('❌ Role update did not persist. Check migration status.\n')
        process.exit(1)
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
