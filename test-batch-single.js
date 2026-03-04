const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');

const anonMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const url = `${urlMatch[1].trim()}/functions/v1/batch-price-english`;
const anonKey = anonMatch[1].trim();

async function test() {
    console.log("Testing swsh12...");
    const req = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${anonKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ setId: 'swsh12' })
    });
    console.log(await req.text());
}
test('base1');
