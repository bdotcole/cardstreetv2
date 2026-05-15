# Quick Deploy Script
# Copy this entire updated index.ts file content and paste into Supabase dashboard

Write-Host "=" * 60
Write-Host "DEPLOYMENT INSTRUCTIONS"
Write-Host "=" * 60
Write-Host ""
Write-Host "1. Open: https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/functions/daily-market-update"
Write-Host "2. Click 'Code' tab"
Write-Host "3. Select all code and delete"
Write-Host "4. Open: supabase\functions\daily-market-update\index.ts"
Write-Host "5. Copy all (Ctrl+A, Ctrl+C)"
Write-Host "6. Paste into Supabase editor"
Write-Host "7. Click 'Deploy'"
Write-Host ""
Write-Host "=" * 60
Write-Host "KEY CHANGES:"
Write-Host "=" * 60
Write-Host "- Now fetches mappings and checks each English card's set_id individually"
Write-Host "- Explicitly skips MA2/MA/Thai sets with logging"  
Write-Host "- Processes only first 50 international cards"
Write-Host "- Will log: 'Skipping MA2 mapping' for filtered cards"
Write-Host ""
Write-Host "After deploying, trigger with SQL:"
Write-Host ""
Write-Host "SELECT net.http_post("
Write-Host "  url:='https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update',"
Write-Host "  headers:='{\"Authorization\": \"Bearer eyJhbG...I6I\"}'::jsonb"
Write-Host ");"
Write-Host ""
Write-Host "Logs will now show which cards are skipped and which are priced!"
