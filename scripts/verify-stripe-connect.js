require('dotenv').config({ path: '.env.local' });

async function verifyStripeConnect() {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    console.log('=== Stripe Account Verification ===\n');

    // 1. Retrieve the platform account info
    try {
        const account = await stripe.accounts.retrieve();
        console.log('✅ Platform Account:');
        console.log(`   ID: ${account.id}`);
        console.log(`   Business Name: ${account.business_profile?.name || '(not set)'}`);
        console.log(`   Country: ${account.country}`);
        console.log(`   Default Currency: ${account.default_currency}`);
        console.log(`   Charges Enabled: ${account.charges_enabled}`);
        console.log(`   Payouts Enabled: ${account.payouts_enabled}`);
        console.log(`   Capabilities: ${JSON.stringify(account.capabilities || {})}`);
        console.log('');
    } catch (e) {
        console.error('❌ Failed to retrieve account:', e.message);
        return;
    }

    // 2. Check if we can list connected accounts (Connect is enabled)
    try {
        const connectedAccounts = await stripe.accounts.list({ limit: 5 });
        console.log(`✅ Stripe Connect is ACTIVE`);
        console.log(`   Connected Accounts Found: ${connectedAccounts.data.length}`);
        if (connectedAccounts.data.length > 0) {
            connectedAccounts.data.forEach((acc, i) => {
                console.log(`   [${i + 1}] ${acc.id} | ${acc.email || '(no email)'} | Type: ${acc.type} | Country: ${acc.country} | Charges: ${acc.charges_enabled} | Payouts: ${acc.payouts_enabled}`);
            });
        } else {
            console.log('   ℹ️  No connected accounts yet - sellers will need to onboard.');
        }
        console.log('');
    } catch (e) {
        if (e.message.includes('not permitted')) {
            console.error('❌ Stripe Connect is NOT enabled on this account.');
            console.error('   → Go to https://dashboard.stripe.com/test/settings/connect to enable it.');
        } else {
            console.error('❌ Error listing connected accounts:', e.message);
        }
        return;
    }

    // 3. Test creating a transfer (dry run - we don't actually execute)
    console.log('✅ Transfer capability check:');
    try {
        // We can't do a real transfer without a connected account and funds,
        // but we can verify the API endpoint is accessible
        await stripe.transfers.list({ limit: 1 });
        console.log('   Transfers API: Accessible ✅');
    } catch (e) {
        console.log(`   Transfers API: ${e.message}`);
    }

    // 4. Check balance
    try {
        const balance = await stripe.balance.retrieve();
        console.log('\n✅ Current Test Balance:');
        balance.available.forEach(b => {
            console.log(`   Available: ${b.amount / 100} ${b.currency.toUpperCase()}`);
        });
        balance.pending.forEach(b => {
            console.log(`   Pending: ${b.amount / 100} ${b.currency.toUpperCase()}`);
        });
    } catch (e) {
        console.log(`   Balance check: ${e.message}`);
    }

    console.log('\n=== Verification Complete ===');
}

verifyStripeConnect().catch(console.error);
