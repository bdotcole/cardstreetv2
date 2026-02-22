const { execSync } = require('child_process');

const envs = {
    NEXT_PUBLIC_OMISE_PUBLIC_KEY: 'pkey_test_66dszputjckcbp2srfs',
    OMISE_SECRET_KEY: 'skey_test_66dszpwchwhfz9qhr4r',
    CRON_SECRET: 'portfolio_cron_2026_secure_key_xyz789',
    JUSTTCG_API_KEY: 'tcg_321c4596652b46d19de533a7518912ca',
    RAPIDAPI_KEY: 'ae75ae125amsh42f1a65bb8f0cfap18177fjsna55d8e193048'
};

for (const [key, value] of Object.entries(envs)) {
    console.log('Adding ' + key + ' to Vercel production...');
    try {
        execSync('npx.cmd vercel env rm ' + key + ' production -y', { stdio: 'ignore' });
    } catch (e) { /* ignore if not exists */ }

    try {
        execSync('npx.cmd vercel env add ' + key + ' production', { input: value });
        console.log('Successfully added ' + key);
    } catch (e) {
        console.error('Failed to add ' + key, e.message);
    }
}
