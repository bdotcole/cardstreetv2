
$envContent = Get-Content .env.local -Raw
$anonKey = $envContent | Select-String "NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)" | ForEach-Object { $_.Matches.Groups[1].Value }
$apiUrl = $envContent | Select-String "NEXT_PUBLIC_SUPABASE_URL=(.+)" | ForEach-Object { $_.Matches.Groups[1].Value }
$url = "$apiUrl/functions/v1/daily-market-update"
$headers = @{ "Authorization" = "Bearer $anonKey" }

$targetSet = "me02"
$body = @{ targetSet = $targetSet } | ConvertTo-Json

for ($i = 1; $i -le 50; $i++) {
    Write-Host "Iteration $i (Target: $targetSet)..."
    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -ContentType "application/json" -ErrorAction Stop
        Write-Host "Success: $($response.priced) priced, $($response.mapped) mapped, $($response.failed) failed"
        
        # Stop if no cards are left to price (heuristic: priced=0 and failed=0)
        if ($response.priced -eq 0 -and $response.failed -eq 0) {
            Write-Host "No more cards to update for $targetSet. Stopping."
            break
        }

        Write-Host "Debug Log Entries:"
        if ($response.debug.Count -gt 0) {
            $response.debug | ConvertTo-Json -Depth 5
        }
        else {
            Write-Host "Debug log is empty."
        }
    }
    catch {
        Write-Host "Error: $_"
        Start-Sleep -Seconds 5
    }
    Start-Sleep -Seconds 2
}
