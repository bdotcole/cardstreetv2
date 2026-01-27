// Quick test: Check if TCGdex is accessible and how long it takes
const testUrls = [
    'https://assets.tcgdex.net/en/base/base1/1/high.png',
    'https://assets.tcgdex.net/en/base/base1/4/high.png', // Charizard
];

console.log('🌏 Testing TCGdex accessibility (simulating Thailand location)...\n');

for (const url of testUrls) {
    const startTime = Date.now();
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const endTime = Date.now();
        const loadTime = endTime - startTime;

        console.log(`${response.ok ? '✅' : '❌'} ${url}`);
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Content-Type: ${response.headers.get('content-type')}`);
        console.log(`   Load Time: ${loadTime}ms`);
        console.log(`   Size: ${response.headers.get('content-length')} bytes\n`);

        if (loadTime > 2000) {
            console.log(`   ⚠️  WARNING: Very slow load time (${loadTime}ms) - May be geo-restricted or slow in some regions\n`);
        }
    } catch (error) {
        console.log(`❌ ${url}`);
        console.log(`   Error: ${error.message}\n`);
    }
}

console.log('\n📝 Recommendation:');
console.log('If load times > 2000ms or errors occur, migrate to Supabase Storage for better performance.');
