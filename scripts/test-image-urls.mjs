// Test if TC Gdex URLs are accessible
const testUrls = [
    'https://assets.tcgdex.net/en/base/base1/1/high',
    'https://assets.tcgdex.net/en/base/base1/1/low',
    'https://assets.tcgdex.net/en/base/base1/4/high', // Charizard
];

console.log('🧪 Testing TCGdex Image URLs...\n');

for (const url of testUrls) {
    try {
        const response = await fetch(url, {
            method: 'HEAD', // Just check headers, don't download full image
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        console.log(`✅ ${url}`);
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Content-Type: ${response.headers.get('content-type')}`);
        console.log(`   CORS: ${response.headers.get('access-control-allow-origin') || 'Not set'}\n`);
    } catch (error) {
        console.log(`❌ ${url}`);
        console.log(`   Error: ${error.message}\n`);
    }
}
