#!/bin/bash

# Test script for market data Edge Function
# This tests if the Edge Function is deployed and working

SUPABASE_URL="https://fdxgzddvywtmnqsaqysx.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I"

echo "🧪 Testing Market Data Edge Function..."
echo ""

# Test the Edge Function
echo "📡 Calling Edge Function..."
response=$(curl -s -w "\n%{http_code}" --location --request POST \
  "${SUPABASE_URL}/functions/v1/daily-market-update" \
  --header "Authorization: Bearer ${ANON_KEY}" \
  --header "Content-Type: application/json")

# Split response and status code
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo ""
echo "HTTP Status: $http_code"
echo "Response: $body"
echo ""

if [ "$http_code" = "200" ]; then
    echo "✅ Edge Function is working!"
    echo ""
    echo "Next: Run the SQL queries in test-market-data.sql to verify data was written"
else
    echo "❌ Edge Function failed or not deployed"
    echo ""
    if [ "$http_code" = "404" ]; then
        echo "⚠️  Edge Function not found - you need to deploy it first!"
        echo ""
        echo "To deploy:"
        echo "1. Install Supabase CLI: npm install -g supabase"
        echo "2. Login: supabase login"
        echo "3. Link project: supabase link --project-ref fdxgzddvywtmnqsaqysx"
        echo "4. Deploy: supabase functions deploy daily-market-update"
        echo "5. Set secrets:"
        echo "   supabase secrets set JUSTTCG_API_KEY=tcg_0b676c7d68074ec2ba032430a5868f9a"
        echo "   supabase secrets set RAPIDAPI_KEY=ae75ae125amsh42f1a65bb8f0cfap18177fjsna55d8e193048"
    fi
fi
