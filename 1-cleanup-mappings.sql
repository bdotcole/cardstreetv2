-- Step 1: Clean up all existing mappings (we'll recreate with better algorithm)
DELETE FROM card_mappings;

-- Step 2: Verify cleanup
SELECT COUNT(*) as remaining_mappings FROM card_mappings;
-- Should return 0

-- Step 3: Ready for matching!
-- After running this, deploy the updated Edge Function and trigger it
