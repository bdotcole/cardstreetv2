-- Add fcm_token to notification_preferences
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS fcm_token TEXT;
