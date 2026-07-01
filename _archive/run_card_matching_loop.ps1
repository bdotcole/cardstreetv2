$Url = "https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update"
# Never hard-code the service-role key — set SUPABASE_SERVICE_ROLE_KEY (see .env.local).
$AnonKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $AnonKey) { throw "Set SUPABASE_SERVICE_ROLE_KEY in the environment" }
$Headers = @{ 
    "Authorization" = "Bearer $AnonKey"
    "Content-Type"  = "application/json"
}

Write-Host "Starting card matching loop (30 iterations)..."

for ($i = 1; $i -le 50; $i++) {
    Write-Host "Run #$i..."
    try {
        $response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers
        Write-Host "Success: $($response | ConvertTo-Json -Depth 2)"
    }
    catch {
        Write-Host "Error: $_"
    }
    Start-Sleep -Seconds 2
}

Write-Host "Matching loop completed."
