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

async function seed() {
    console.log('Seeding QC users...');

    const users = [
        { email: 'qc_buyer@example.com', password: 'password123', name: 'QC Buyer', username: 'qc_buyer' },
        { email: 'qc_seller@example.com', password: 'password123', name: 'QC Seller', username: 'qc_seller' }
    ];

    for (const u of users) {
        console.log('Creating', u.email);
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: u.email,
            password: u.password,
            email_confirm: true,
            user_metadata: {
                full_name: u.name,
                username: u.username
            }
        });

        if (authError) {
            console.error('Error creating user:', authError.message);
            // It might already exist, try to get ID
            const { data: existingUser } = await supabase.from('profiles').select('id').eq('username', u.username).single();
            if (existingUser) {
                console.log('User already exists:', u.email, existingUser.id);
                // Make sure seller is partner if needed
                if (u.username === 'qc_seller') {
                    await supabase.from('profiles').update({ role: 'partner', partner_level: 'gold' }).eq('id', existingUser.id);
                }
            }
            continue;
        }

        console.log('Created auth user:', authData.user.id);
        
        // Wait briefly for triggers to create profile
        await new Promise(r => setTimeout(r, 1000));

        // Update profile
        if (u.username === 'qc_seller') {
            await supabase.from('profiles').update({ role: 'partner', partner_level: 'gold' }).eq('id', authData.user.id);
        }
    }

    console.log('Done!');
}

seed();
