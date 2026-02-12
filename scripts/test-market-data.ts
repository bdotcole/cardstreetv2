/**
 * Market Data Test Script
 * Tests the market data aggregation system with sample cards
 */

import { marketDataAggregator } from '../services/marketData/aggregator';
import { fuzzyMatcher } from '../services/marketData/fuzzyMatcher';
import { pricingCalculator } from '../services/marketData/pricingCalculator';
import { justTCGClient } from '../services/marketData/justTCGClient';
import { pokeDataClient } from '../services/marketData/pokeDataClient';

async function testAPIClients() {
    console.log('\n🧪 Testing API Clients...\n');

    // Test JustTCG
    console.log('📡 Testing JustTCG API...');
    const justTcgPrice = await justTCGClient.getAverageMarketPrice('Charizard ex', 'en');
    console.log(`  ✓ Charizard ex (EN): $${justTcgPrice?.toFixed(2) || 'N/A'}`);

    // Test PokeData++
    console.log('\n📡 Testing PokeData++ API...');
    const pokeDataPrice = await pokeDataClient.getMarketPrice('Pikachu VMAX');
    console.log(`  ✓ Pikachu VMAX: $${pokeDataPrice?.toFixed(2) || 'N/A'}`);
}

async function testPricingCalculator() {
    console.log('\n🧪 Testing Pricing Calculator...\n');

    console.log('💰 Fetching English market price for Charizard ex...');
    const enSnapshot = await pricingCalculator.fetchEnglishMarketPrice('Charizard ex');

    if (enSnapshot) {
        console.log(`  ✓ Market Average: $${enSnapshot.marketAvg.toFixed(2)}`);
        console.log(`  ✓ Sources: ${enSnapshot.sources.map(s => s.source).join(', ')}`);
        console.log(`  ✓ Calculation:`);
        console.log(`     - Raw prices: ${enSnapshot.calculationBreakdown.rawPrices.map(p => `$${p.toFixed(2)}`).join(', ')}`);
        console.log(`     - After outlier removal: ${enSnapshot.calculationBreakdown.afterOutlierRemoval.map(p => `$${p.toFixed(2)}`).join(', ')}`);
        console.log(`     - Weighted average: $${enSnapshot.calculationBreakdown.weightedAverage.toFixed(2)}`);
    } else {
        console.log('  ✗ Failed to fetch price');
    }
}

async function testThaiPricing() {
    console.log('\n🧪 Testing Thai Price Calculation...\n');

    // Example: If Charizard ex is $100 in EN, Thai should be $60
    const enPrice = 100;
    const thaiPrice = enPrice * 0.6;

    console.log(`💡 Example Calculation:`);
    console.log(`  English Charizard ex: $${enPrice}`);
    console.log(`  Thai Charizard ex (0.6x): $${thaiPrice}`);

    // Example: If Pikachu V is ¥5000 in JP, Thai should be ¥4000
    const jpPrice = 5000;
    const thaiFromJp = jpPrice * 0.8;

    console.log(`\n  Japanese Pikachu V: ¥${jpPrice}`);
    console.log(`  Thai Pikachu V (0.8x): ¥${thaiFromJp}`);
}

async function runTests() {
    console.log('🚀 Market Data Aggregation System - Test Suite');
    console.log('='.repeat(60));

    try {
        await testAPIClients();
        await testPricingCalculator();
        await testThaiPricing();

        console.log('\n' + '='.repeat(60));
        console.log('✅ All tests completed!');
        console.log('\nNext Steps:');
        console.log('1. Run database migration: npm run supabase:migrate');
        console.log('2. Test full aggregation: npm run test:aggregator');
        console.log('3. Set up Supabase Edge Function for daily cron');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
    }
}

runTests();
