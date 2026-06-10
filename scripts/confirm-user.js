const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
    }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];
const supabase = createClient(supabaseUrl, supabaseKey);

async function confirmUser(email) {
    const { data: users, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;
    const user = users.users.find(u => u.email === email);
    if (!user) {
        console.log('User not found:', email);
        return;
    }
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    if (updateError) throw updateError;
    console.log('Confirmed user:', email);
    
    // Also make sure they have a partner role if it's the seller
    if (email.includes('seller')) {
        await supabase.from('profiles').update({ role: 'partner', partner_level: 'gold' }).eq('id', user.id);
        console.log('Made user partner:', email);
    }
}

confirmUser(process.argv[2]);
