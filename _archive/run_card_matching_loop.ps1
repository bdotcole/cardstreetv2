$Url = "https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update"
$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU"
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
