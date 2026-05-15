const fs = require('fs');
const path = require('path');
const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const anonKeyMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const anonKey = anonKeyMatch[1].trim();
const url = `${urlMatch[1].trim()}/functions/v1/batch-price-english`;

async function trigger() {
    console.log("Triggering batch-price-english edge function...");
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${anonKey}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}

trigger();
