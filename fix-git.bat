# Quick Fix Script for Git Repository Issue
# Run this in Command Prompt

@echo off
echo ========================================
echo Fixing Git Repository Configuration
echo ========================================
echo.

echo Step 1: Creating .gitignore in home directory to prevent tracking everything...
cd /d C:\Users\brand
echo * > .gitignore
echo !Downloads/ >> .gitignore
echo DONE
echo.

echo Step 2: Removing git from home directory (if exists)...
if exist .git (
    rmdir /s /q .git
    echo Git removed from home directory
) else (
    echo No git in home directory
)
echo.

echo Step 3: Initializing git in project directory...
cd /d C:\Users\brand\Downloads\cardstreet-tcg
git init
echo.

echo Step 4: Adding all files...
git add .
echo.

echo Step 5: Creating first commit...
git commit -m "Initial commit: Supabase migration with Japanese support"
echo.

echo Step 6: Setting up branch...
git branch -M main
echo.

echo ========================================
echo Git repository is now properly configured!
echo ========================================
echo.
echo Next steps:
echo 1. Create a GitHub repository at https://github.com/new
echo 2. Run: git remote add origin YOUR_GITHUB_URL
echo 3. Run: git push -u origin main
echo 4. Connect Vercel to your GitHub repo
echo.
pause
