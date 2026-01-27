@echo off
echo ========================================
echo Pokemon TCG to Supabase Migration
echo ========================================
echo.

echo Step 1: Applying SQL Schema to Supabase
echo ----------------------------------------
echo Please complete this step manually:
echo 1. Open https://supabase.com/dashboard in your browser
echo 2. Navigate to your project (fdxgzddvywtmnqsaqysx)
echo 3. Click "SQL Editor" in the left sidebar
echo 4. Click "New query"
echo 5. Open: supabase\migrations\20260126_pokemontcg_data.sql
echo 6. Copy all content and paste into SQL Editor
echo 7. Click "Run"
echo.
echo Press any key once you've completed Step 1...
pause >nul

echo.
echo Step 2: Running Data Migration
echo ----------------------------------------
echo Starting migration with your API key...
echo.

node scripts\migrate-pokemon-data-fetch.mjs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Migration completed successfully!
    echo ========================================
    echo.
    echo Next steps:
    echo 1. Verify data in Supabase dashboard
    echo 2. Switch to new implementation (see MIGRATION_GUIDE.md)
) else (
    echo.
    echo ========================================
    echo Migration encountered errors
    echo ========================================
    echo.
    echo If Pokemon API is down, you can:
    echo - Wait and try again later
    echo - Check MIGRATION_GUIDE.md for alternatives
)

echo.
pause
