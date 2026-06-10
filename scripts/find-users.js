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

async function findUsers() {
    const { data: users, error } = await supabase.auth.admin.listUsers();
    if (error) {
        console.error('Error fetching users:', error);
        return;
    }
    
    // Pick first two users
    if (users.users.length >= 2) {
        const u1 = users.users[0];
        const u2 = users.users[1];
        
        console.log('User 1:', u1.email, u1.id);
        console.log('User 2:', u2.email, u2.id);
        
        // Reset password to password123
        await supabase.auth.admin.updateUserById(u1.id, { password: 'password123' });
        await supabase.auth.admin.updateUserById(u2.id, { password: 'password123' });
        
        // Ensure User 1 is a partner
        await supabase.from('profiles').update({ role: 'partner', partner_level: 'gold' }).eq('id', u1.id);
        
        console.log('Passwords reset and roles updated!');
    } else {
        console.log('Not enough users found.');
    }
}

findUsers();
