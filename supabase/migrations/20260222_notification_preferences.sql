-- Create notification preferences table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    sold_email BOOLEAN NOT NULL DEFAULT true,
    sold_push BOOLEAN NOT NULL DEFAULT true,
    label_email BOOLEAN NOT NULL DEFAULT true,
    label_push BOOLEAN NOT NULL DEFAULT true,
    shipped_email BOOLEAN NOT NULL DEFAULT true,
    shipped_push BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- RLS Policies
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notification preferences"
    ON public.notification_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification preferences"
    ON public.notification_preferences FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification preferences"
    ON public.notification_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can read notification preferences"
    ON public.notification_preferences FOR SELECT
    USING (true); -- Required for edge functions/backend to read preferences

-- Trigger to create default preferences on profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user_preferences()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to ensure default preferences are created
DROP TRIGGER IF EXISTS on_auth_user_created_preferences ON public.profiles;
CREATE TRIGGER on_auth_user_created_preferences
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_preferences();

-- Insert default preferences for existing users
INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
