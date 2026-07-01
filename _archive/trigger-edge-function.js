const url = "https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update";
// Never hard-code the service-role key — set SUPABASE_SERVICE_ROLE_KEY (see .env.local).
const anonKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in the environment');

async function trigger() {
    console.log("Triggering edge function...");
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
