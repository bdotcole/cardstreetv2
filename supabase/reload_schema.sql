-- Run this in the Supabase SQL Editor if you continue to see "table not found" errors
-- This reloads the PostgREST schema cache

NOTIFY pgrst, 'reload schema';
