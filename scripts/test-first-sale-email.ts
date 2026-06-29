/*
 * Unit tests for the first-time seller sale email (lib/courier.ts:sendFirstTimeSaleEmail).
 *
 * No DB or network: a stateful Supabase mock and a fake Courier client are
 * injected via the function's `deps` parameter. The mock reproduces the exact
 * query chains the function issues:
 *   - profiles select (display_name, first_sale_email_sent_at).single()
 *   - orders count: select('id', { count, head }).eq.in
 *   - profiles CAS claim: update().eq().is(null).select('id')
 *   - profiles rollback: update({...: null}).eq().eq(claimedAt)
 *   - auth.admin.getUserById()
 *
 * Run:  npx tsx scripts/test-first-sale-email.ts
 * Exits non-zero if any case fails.
 */

import { sendFirstTimeSaleEmail } from '../lib/courier';

const SELLER = '22222222-2222-2222-2222-222222222222';
const ORDER = 'order-abc-123';

// ── Stateful Supabase mock ───────────────────────────────────────────────────
interface MockState {
    profile: { display_name: string | null; first_sale_email_sent_at: string | null };
    email: string | null;
    validSaleCount: number;
    failClaim: boolean;   // simulate DB error on the CAS claim
    profileError: boolean; // simulate DB error loading the profile
    countError: boolean;   // simulate DB error counting sales
    rolledBack: boolean;   // set by the mock when a rollback update fires
}

function makeState(overrides: Partial<MockState> = {}): MockState {
    return {
        profile: { display_name: 'Somchai Jaidee', first_sale_email_sent_at: null },
        email: 'seller@example.com',
        validSaleCount: 1,
        failClaim: false,
        profileError: false,
        countError: false,
        rolledBack: false,
        ...overrides,
    };
}

function makeSupabaseMock(state: MockState): any {
    class Builder {
        private table: string;
        private op: 'select' | 'update' | null = null;
        private isCount = false;
        private isSingle = false;
        private payload: Record<string, any> | null = null;
        private returning = false;
        constructor(table: string) { this.table = table; }

        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            if (this.op === 'update') { this.returning = true; }
            else { this.op = 'select'; this.isCount = !!(opts && opts.count); }
            return this;
        }
        update(payload: Record<string, any>) { this.op = 'update'; this.payload = payload; return this; }
        eq() { return this; }
        is() { return this; }
        in() { return this; }
        single() { this.isSingle = true; return this; }

        // Thenable so `await builder` resolves the simulated result.
        then(onFulfilled: (v: any) => any) {
            return Promise.resolve(this.resolve()).then(onFulfilled);
        }

        private resolve(): any {
            if (this.table === 'profiles' && this.op === 'select') {
                if (state.profileError) return { data: null, error: { message: 'profile load failed' } };
                return { data: { ...state.profile }, error: null };
            }
            if (this.table === 'orders' && this.op === 'select' && this.isCount) {
                if (state.countError) return { count: null, error: { message: 'count failed' } };
                return { count: state.validSaleCount, data: null, error: null };
            }
            if (this.table === 'profiles' && this.op === 'update') {
                const isRollback = this.payload!.first_sale_email_sent_at === null;
                if (isRollback) {
                    state.profile.first_sale_email_sent_at = null;
                    state.rolledBack = true;
                    return { data: null, error: null };
                }
                // CAS claim
                if (state.failClaim) return { data: null, error: { message: 'claim update failed' } };
                if (state.profile.first_sale_email_sent_at !== null) {
                    return { data: [], error: null }; // lost the race / already set
                }
                state.profile.first_sale_email_sent_at = this.payload!.first_sale_email_sent_at;
                return { data: [{ id: SELLER }], error: null };
            }
            return { data: null, error: null };
        }
    }

    return {
        from: (table: string) => new Builder(table),
        auth: {
            admin: {
                getUserById: async () => ({
                    data: { user: state.email ? { email: state.email } : null },
                    error: null,
                }),
            },
        },
    };
}

function makeCourier(opts: { failSend?: boolean } = {}) {
    const sent: any[] = [];
    return {
        client: {
            send: {
                message: async (payload: any) => {
                    sent.push(payload);
                    if (opts.failSend) throw new Error('Courier send boom');
                    return { requestId: 'req_test_123' };
                },
            },
        },
        sent,
    };
}

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
    if (cond) {
        console.log(`  ✅ ${name}`);
    } else {
        failures++;
        console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

async function run() {
    // Ensure env doesn't leak a template ID into the assertion below.
    delete process.env.COURIER_FIRST_TIME_SALE_TEMPLATE_ID;
    delete process.env.YOUTUBE_PACKAGING_GUIDE_URL;

    // 1. First valid sale → email sends.
    {
        console.log('\n[1] First valid sale → sends');
        const state = makeState();
        const courier = makeCourier();
        const result = await sendFirstTimeSaleEmail(
            SELLER, { orderId: ORDER },
            { courier: courier.client, supabaseAdmin: makeSupabaseMock(state) },
        );
        check('returns "sent"', result === 'sent', `got "${result}"`);
        check('exactly one message sent', courier.sent.length === 1, `got ${courier.sent.length}`);
        check('timestamp now set (claimed)', state.profile.first_sale_email_sent_at !== null);
        const msg = courier.sent[0]?.message;
        check('uses event-alias template fallback', msg?.template === 'seller_first_sale', msg?.template);
        check('sent to seller email', msg?.to?.email === 'seller@example.com');
        check('routes to email channel', JSON.stringify(msg?.routing?.channels) === '["email"]');
        check('seller_first_name = first token of display_name', msg?.data?.seller_first_name === 'Somchai', msg?.data?.seller_first_name);
        check('order_number = orderId', msg?.data?.order_number === ORDER);
        check('order_link points at /profile', String(msg?.data?.order_link).endsWith('/profile'), msg?.data?.order_link);
        check('support_email present', !!msg?.data?.support_email);
        check('youtube link omitted when unset', msg?.data?.youtube_packaging_link === undefined);
    }

    // 2. Same order status update runs again → does NOT send again.
    {
        console.log('\n[2] Re-run after a successful send (duplicate webhook) → no second send');
        const state = makeState();
        const courier = makeCourier();
        const deps = { courier: courier.client, supabaseAdmin: makeSupabaseMock(state) };
        const first = await sendFirstTimeSaleEmail(SELLER, { orderId: ORDER }, deps);
        const second = await sendFirstTimeSaleEmail(SELLER, { orderId: ORDER }, deps);
        check('first run sends', first === 'sent', first);
        check('second run skips', second === 'skipped', second);
        check('only one message total', courier.sent.length === 1, `got ${courier.sent.length}`);
    }

    // 3. Seller's SECOND valid sale → does NOT send.
    {
        console.log('\n[3] Second valid sale (count = 2) → no send');
        const state = makeState({ validSaleCount: 2 });
        const courier = makeCourier();
        const result = await sendFirstTimeSaleEmail(
            SELLER, { orderId: ORDER },
            { courier: courier.client, supabaseAdmin: makeSupabaseMock(state) },
        );
        check('returns "skipped"', result === 'skipped', result);
        check('nothing sent', courier.sent.length === 0, `got ${courier.sent.length}`);
    }

    // 4. first_sale_email_sent_at already set → does NOT send.
    {
        console.log('\n[4] Column already stamped → no send');
        const state = makeState();
        state.profile.first_sale_email_sent_at = '2026-06-01T00:00:00.000Z';
        const courier = makeCourier();
        const result = await sendFirstTimeSaleEmail(
            SELLER, { orderId: ORDER },
            { courier: courier.client, supabaseAdmin: makeSupabaseMock(state) },
        );
        check('returns "skipped"', result === 'skipped', result);
        check('nothing sent', courier.sent.length === 0, `got ${courier.sent.length}`);
    }

    // 5. Courier send fails → error returned, no crash, claim rolled back.
    {
        console.log('\n[5] Courier failure → error handled + claim rolled back');
        const state = makeState();
        const courier = makeCourier({ failSend: true });
        const result = await sendFirstTimeSaleEmail(
            SELLER, { orderId: ORDER },
            { courier: courier.client, supabaseAdmin: makeSupabaseMock(state) },
        );
        check('returns "error"', result === 'error', result);
        check('send was attempted once', courier.sent.length === 1, `got ${courier.sent.length}`);
        check('claim rolled back', state.rolledBack === true);
        check('timestamp cleared for retry', state.profile.first_sale_email_sent_at === null);
    }

    // 6. Seller email missing → does NOT send, warns.
    {
        console.log('\n[6] Missing seller email → no send');
        const state = makeState({ email: null });
        const courier = makeCourier();
        const result = await sendFirstTimeSaleEmail(
            SELLER, { orderId: ORDER },
            { courier: courier.client, supabaseAdmin: makeSupabaseMock(state) },
        );
        check('returns "skipped"', result === 'skipped', result);
        check('nothing sent', courier.sent.length === 0, `got ${courier.sent.length}`);
        check('slot NOT claimed (no email)', state.profile.first_sale_email_sent_at === null);
    }

    // 7. Bonus: a DB error on the CAS claim → "error", never sends.
    {
        console.log('\n[7] Claim DB error → no send');
        const state = makeState({ failClaim: true });
        const courier = makeCourier();
        const result = await sendFirstTimeSaleEmail(
            SELLER, { orderId: ORDER },
            { courier: courier.client, supabaseAdmin: makeSupabaseMock(state) },
        );
        check('claim DB error returns "error"', result === 'error', result);
        check('nothing sent', courier.sent.length === 0, `got ${courier.sent.length}`);
    }

    console.log('\n────────────────────────────────────────');
    if (failures === 0) {
        console.log('✅ All first-sale-email cases passed.');
        process.exit(0);
    } else {
        console.error(`❌ ${failures} assertion(s) failed.`);
        process.exit(1);
    }
}

run().catch((e) => { console.error('Test harness crashed:', e); process.exit(1); });
