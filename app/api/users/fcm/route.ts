import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { fcmToken } = await req.json();

        if (!fcmToken || typeof fcmToken !== 'string') {
            return NextResponse.json({ error: 'FCM token is required' }, { status: 400 });
        }

        const { error: updateError } = await supabase
            .from('notification_preferences')
            .update({ fcm_token: fcmToken })
            .eq('user_id', user.id);

        if (updateError) {
            console.error('Failed to save FCM token:', updateError);
            return NextResponse.json({ error: 'Failed to save FCM token' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('API Error saving FCM token:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
