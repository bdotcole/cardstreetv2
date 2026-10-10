/**
 * Admin Collector Pass settings: the editable earn values (check-in, daily
 * challenges, per-action and Journey awards, rank-up bonus) plus the tracking
 * numbers the console shows beside them.
 *
 * GET — { config, defaults, stored, updatedAt, updatedByName, migrationApplied,
 *         history, stats }
 * PUT — { sections: Partial<RewardConfig>, note?, baseUpdatedAt }
 *       Merges the given sections over the saved document, validates the
 *       whole result (lib/rewardConfig.ts checkRewardConfig — cross-section
 *       rules such as a challenge needing its action switched on), then
 *       compare-and-sets on updated_at so two admins editing at once can't
 *       silently overwrite each other (409 STALE). Every save is appended to
 *       reward_config_history.
 *
 * The award RPCs read the row directly, so a save is live for every award
 * immediately; the TS routes catch up within lib/rewardConfig.server.ts's
 * cache window.
 */

import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    REWARD_CONFIG_SECTIONS, checkRewardConfig, defaultRewardConfig,
    type RewardConfig, type RewardConfigSection,
} from '@/lib/rewardConfig';
import { primeRewardConfigCache, readRewardConfigRow } from '@/lib/rewardConfig.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HistoryRow {
    id: number;
    sections: string[] | null;
    note: string | null;
    changed_by: string | null;
    created_at: string;
    config: unknown;
}

export async function GET() {
    const gate = await requireAdminUser();
    if (gate instanceof NextResponse) return gate;

    const admin = createAdminClient();
    let row;
    try {
        row = await readRewardConfigRow(admin);
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message || 'Config unavailable' }, { status: 500 });
    }

    const [historyRes, statsRes] = await Promise.all([
        row.tableMissing
            ? Promise.resolve({ data: [] as HistoryRow[] })
            : admin
                .from('reward_config_history')
                .select('id, sections, note, changed_by, created_at, config')
                .order('created_at', { ascending: false })
                .limit(15),
        admin.rpc('admin_reward_rule_stats'),
    ]);
    const history = ((historyRes.data ?? []) as HistoryRow[]);

    const ids = [...new Set([row.updatedBy, ...history.map((h) => h.changed_by)].filter((v): v is string => !!v))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
        const { data: people } = await admin.from('profiles').select('id, display_name, username').in('id', ids);
        for (const p of (people ?? []) as { id: string; display_name: string | null; username: string | null }[]) {
            names.set(p.id, p.display_name || p.username || p.id.slice(0, 8));
        }
    }

    return NextResponse.json({
        config: row.config,
        defaults: defaultRewardConfig(),
        stored: row.stored,
        updatedAt: row.updatedAt,
        updatedByName: row.updatedBy ? names.get(row.updatedBy) ?? null : null,
        migrationApplied: !row.tableMissing,
        history: history.map((h) => ({
            id: h.id,
            sections: h.sections ?? [],
            note: h.note,
            changedByName: h.changed_by ? names.get(h.changed_by) ?? null : null,
            createdAt: h.created_at,
            config: checkRewardConfig(h.config).config,
        })),
        // null while the 20261010 migration is unapplied.
        stats: statsRes.error ? null : statsRes.data,
    }, { headers: { 'Cache-Control': 'no-store' } });
}

const STALE = {
    error: 'Someone else saved rewards settings since you opened this page. Reload to see their changes, then edit again.',
    code: 'STALE',
};

export async function PUT(req: Request) {
    const gate = await requireAdminUser();
    if (gate instanceof NextResponse) return gate;
    const { user: adminUser } = gate;

    try {
        const body = await req.json().catch(() => ({}));
        const sectionsIn = body?.sections;
        if (typeof sectionsIn !== 'object' || sectionsIn === null || Array.isArray(sectionsIn)) {
            return NextResponse.json({ error: 'sections required' }, { status: 400 });
        }
        const keys = Object.keys(sectionsIn).filter((k): k is RewardConfigSection =>
            (REWARD_CONFIG_SECTIONS as readonly string[]).includes(k));
        if (keys.length === 0) {
            return NextResponse.json({ error: 'Nothing to save' }, { status: 400 });
        }
        const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : '';
        const baseUpdatedAt = typeof body?.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;

        const admin = createAdminClient();
        const row = await readRewardConfigRow(admin);
        if (row.tableMissing) {
            return NextResponse.json(
                { error: 'Run supabase/migrations/20261010_reward_config.sql first.', code: 'MIGRATION' },
                { status: 503 },
            );
        }
        if ((row.updatedAt ?? null) !== baseUpdatedAt) {
            return NextResponse.json(STALE, { status: 409 });
        }

        const merged: Record<string, unknown> = { ...row.config };
        for (const k of keys) {
            // Rules merge per key, so a page that only knows some rules can
            // never reset the others to their defaults.
            merged[k] = k === 'rules'
                ? { ...row.config.rules, ...(sectionsIn.rules as Record<string, unknown>) }
                : sectionsIn[k];
        }
        const { config, errors } = checkRewardConfig(merged);
        if (errors.length > 0) {
            return NextResponse.json({ error: 'Some values need fixing before they can go live.', errors }, { status: 400 });
        }

        const now = new Date().toISOString();
        if (!row.stored) {
            const { error } = await admin
                .from('reward_config')
                .insert({ id: 1, config, updated_at: now, updated_by: adminUser.id });
            if (error) {
                if (error.code === '23505') return NextResponse.json(STALE, { status: 409 });
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
        } else {
            const { data, error } = await admin
                .from('reward_config')
                .update({ config, updated_at: now, updated_by: adminUser.id })
                .eq('id', 1)
                .eq('updated_at', row.updatedAt!)
                .select('id');
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            if (!data || data.length === 0) return NextResponse.json(STALE, { status: 409 });
        }

        const { error: histErr } = await admin.from('reward_config_history').insert({
            config,
            sections: keys,
            note: note || null,
            changed_by: adminUser.id,
        });
        if (histErr) console.warn('[Admin/RewardsConfig] history write failed:', histErr.message);

        primeRewardConfigCache(config as RewardConfig);
        return NextResponse.json({ ok: true, config, updatedAt: now });
    } catch (err) {
        console.error('[Admin/RewardsConfig] error:', err);
        return NextResponse.json({ error: 'Save failed' }, { status: 500 });
    }
}
