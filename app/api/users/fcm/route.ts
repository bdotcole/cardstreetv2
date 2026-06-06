import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// FCM tokens are opaque strings, ~140-180 chars in practice. Cap at 4kB to
// keep abuse small but not reject valid future-format tokens.
const FcmBodySchema = z.object({
    fcmToken: z.string().min(20).max(4096),
});

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = FcmBodySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'FCM token is required' }, { status: 400 });
        }
        const { fcmToken } = parsed.data;

        const { error: upsertError } = await supabase
            .from('notification_preferences')
            .upsert({ 
                user_id: user.id,
                fcm_token: fcmToken,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (upsertError) {
            console.error('Failed to save FCM token:', upsertError);
            return NextResponse.json({ error: 'Failed to save FCM token' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('API Error saving FCM token:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
