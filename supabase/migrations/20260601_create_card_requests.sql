-- Requests from users for cards missing from the catalog (registry search returned no match)
CREATE TABLE IF NOT EXISTS public.card_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    search_query TEXT NOT NULL,
    -- App locale at request time (EN/TH) — hints which language catalog the card belongs to
    language TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Reviewed', 'Added', 'Dismissed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.card_requests ENABLE ROW LEVEL SECURITY;

-- Users can create their own requests
CREATE POLICY "Users can insert their own card requests" ON public.card_requests
    FOR INSERT WITH CHECK (auth.uid() = requester_id);

-- Users can see the requests they submitted
CREATE POLICY "Users can view their own card requests" ON public.card_requests
    FOR SELECT USING (auth.uid() = requester_id);

-- Admins manage all requests
CREATE POLICY "Admins can view and edit all card requests" ON public.card_requests
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.card_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
