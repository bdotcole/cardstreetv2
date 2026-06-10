-- Add fcm_token and new preference columns to notification_preferences
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS fcm_token TEXT;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS shipping_invoice_email BOOLEAN DEFAULT true;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS shipping_invoice_push BOOLEAN DEFAULT true;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS shipping_paid_email BOOLEAN DEFAULT true;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS shipping_paid_push BOOLEAN DEFAULT true;

-- Add indices for performance
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON public.notification_preferences(user_id);
