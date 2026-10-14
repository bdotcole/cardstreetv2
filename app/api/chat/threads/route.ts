/**
 * Chat threads for the signed-in user (20261014_shop_chat.sql).
 *
 *   GET                → { available, threads, unreadCount }   the inbox
 *   GET ?with=<userId> → { available, thread | null }           the conversation with one person
 *
 * Service-role reads scoped to the caller: the tables have no RLS policies,
 * so this route is the only way in. Threads without a message yet are never
 * listed. Fails soft before the migration (available: false).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPublicSellers } from '@/lib/publicProfiles';
import { THREAD_COLUMNS, UUID_RE, findThreadBetween, isMissingSchema, otherOf, summarize, type ThreadRow } from '@/lib/chat.server';

export const dynamic = 'force-dynamic';

const MAX_THREADS = 100;

export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const me = user.id;
    const admin = createAdminClient();
    const headers = { 'Cache-Control': 'no-store' };

    const withId = request.nextUrl.searchParams.get('with');
    if (withId !== null) {
        if (!UUID_RE.test(withId) || withId === me) {
            return NextResponse.json({ error: 'with must be another user id' }, { status: 400 });
        }
        const { data: thread, error } = await findThreadBetween(admin, me, withId);
        if (error) {
            if (isMissingSchema(error)) return NextResponse.json({ available: false, thread: null }, { headers });
            console.error('[chat] thread lookup failed:', error);
            return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 });
        }
        if (!thread?.last_message_at) return NextResponse.json({ available: true, thread: null }, { headers });
        const profiles = await fetchPublicSellers(admin, [withId]);
        return NextResponse.json({ available: true, thread: summarize(thread, me, profiles) }, { headers });
    }

    const { data, error } = await admin
        .from('chat_threads')
        .select(THREAD_COLUMNS)
        .or(`buyer_id.eq.${me},seller_id.eq.${me}`)
        .not('last_message_at', 'is', null)
        .order('last_message_at', { ascending: false })
        .limit(MAX_THREADS);
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json({ available: false, threads: [], unreadCount: 0 }, { headers });
        console.error('[chat] inbox failed:', error);
        return NextResponse.json({ error: 'Failed to load chats' }, { status: 500 });
    }

    const rows = (data ?? []) as ThreadRow[];
    const profiles = await fetchPublicSellers(admin, rows.map((t) => otherOf(t, me)));
    const threads = rows.map((t) => summarize(t, me, profiles));
    return NextResponse.json(
        { available: true, threads, unreadCount: threads.filter((t) => t.unread).length },
        { headers },
    );
}
