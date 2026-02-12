# Daily Market Update Edge Function

Automated market data aggregation for Thai Pokemon cards.

## Environment Variables Required

Set these in Supabase Dashboard > Edge Functions > Secrets:

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JUSTTCG_API_KEY=tcg_0b676c7d68074ec2ba032430a5868f9a
RAPIDAPI_KEY=ae75ae125amsh42f1a65bb8f0cfap18177fjsna55d8e193048
```

## What It Does

1. Fetches Thai cards without mappings (50 per run)
2. Matches them to English/Japanese counterparts using fuzzy matching
3. Calculates market prices:
   - Thai = 0.6x English price (from JustTCG + PokeData++)
   - Thai = 0.8x Japanese price (from JustTCG, fallback)
4. Stores results in `market_values` table

## Testing Locally

```bash
supabase functions serve daily-market-update
```

Then call:
```bash
curl -i --location --request POST 'http://localhost:54321/functions/v1/daily-market-update' \
  --header 'Authorization: Bearer YOUR_ANON_KEY'
```

## Deploying

```bash
supabase functions deploy daily-market-update
```
