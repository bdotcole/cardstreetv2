import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendCardRequestFulfilledNotification } from '@/lib/courier';

// nodejs runtime: the notification path pulls the requester's email via the
// Supabase auth admin API and hits Courier — keep it off Edge.
export const runtime = 'nodejs';

const VALID_STATUSES = ['Open', 'Reviewed', 'Added', 'Dismissed'] as const;
type Status = (typeof VALID_STATUSES)[number];

// GET /api/admin/card-requests?status=Open — list user-submitted missing-card
// requests for the Mapping QC panel. Newest first; optional status filter.
export async function GET(request: Request) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabase
        .from('card_requests')
        .select('id, requester_id, search_query, language, notes, status, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(200);

    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
        query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Admin card-requests list error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ requests: data ?? [] });
}

// PATCH /api/admin/card-requests — update a request's status and/or notes.
// When a request first transitions to 'Added', notify the requester that the
// card they asked for is now in the catalog.
export async function PATCH(request: Request) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const supabase = createAdminClient();
    try {
        const body = await request.json();
        const { id, status, notes, notify } = body as {
            id?: string;
            status?: Status;
            notes?: string | null;
            notify?: boolean;
        };

        if (!id) return NextResponse.json({ error: 'Request id is required' }, { status: 400 });
        if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
            return NextResponse.json({ error: `Invalid status "${status}"` }, { status: 400 });
        }

        // Read the current row first so we can tell whether this call is the
        // transition INTO 'Added' (only notify on the edge, never on re-saves).
        const { data: current, error: readErr } = await supabase
            .from('card_requests')
            .select('id, requester_id, search_query, status, notes')
            .eq('id', id)
            .maybeSingle();
        if (readErr) throw readErr;
        if (!current) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

        const update: Record<string, unknown> = {};
        if (status !== undefined) update.status = status;
        if (notes !== undefined) update.notes = notes;
        if (Object.keys(update).length === 0) {
            return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
        }

        const { data: updated, error: updErr } = await supabase
            .from('card_requests')
            .update(update)
            .eq('id', id)
            .select('id, requester_id, search_query, language, notes, status, created_at, updated_at')
            .single();
        if (updErr) throw updErr;

        // Fire-and-await the notification only on the Open/Reviewed -> Added edge.
        // `notify === false` lets the caller suppress it (e.g. a card added long
        // ago that the admin is just now reconciling). Failures are swallowed
        // inside the helper so they never fail the status update.
        const becameAdded = status === 'Added' && current.status !== 'Added';
        let notified = false;
        if (becameAdded && notify !== false && current.requester_id) {
            await sendCardRequestFulfilledNotification(current.requester_id, {
                searchQuery: current.search_query,
            });
            notified = true;
        }

        return NextResponse.json({ request: updated, notified });
    } catch (error: any) {
        console.error('Admin card-requests update error:', error);
        return NextResponse.json({ error: error.message ?? 'Failed to update request' }, { status: 500 });
    }
}
