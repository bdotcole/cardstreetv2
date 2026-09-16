/**
 * Server helpers for multistreaming a live break to social channels.
 *
 * Model: the room-composite egress that records the VOD ALSO pushes to N
 * RTMP(S) destinations (LiveKit StreamOutput). Destinations are the seller's
 * saved endpoints (stream_destinations; keys encrypted, see
 * lib/streamKeyCrypto.ts). Each show records which destinations it pushed to
 * and how each fared (stream_simulcast_targets), fed by the LiveKit webhook's
 * per-output streamResults and the console's status poll.
 *
 * Full RTMP URLs (server + key) exist only transiently in memory here and in
 * the LiveKit request: never logged, never returned to a client, matched by
 * SHA-256 (url_hash) everywhere else.
 *
 * Everything degrades softly before 20260916_stream_destinations.sql is
 * applied: lists come back empty + `unavailable`, writes no-op with a warning,
 * and going live proceeds exactly as it did before (VOD only).
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTableError } from '@/lib/liveBreaks';
import { decryptStreamKey, hashStreamUrl } from '@/lib/streamKeyCrypto';
import { composeStreamUrl, type DestinationPlatform } from '@/lib/streamDestinationPresets';
import { getAppBaseUrl } from '@/lib/stripe';

/**
 * The branded egress template (app/live/overlay) the social feeds and the VOD
 * are composed from. LiveKit's cloud egress loads it in its own headless
 * Chrome, so it must be a public https URL: a localhost dev server is
 * unreachable from there, and falling back to LiveKit's built-in grid beats
 * an egress that fails to start.
 */
export function overlayTemplateUrl(): string | null {
    const base = getAppBaseUrl();
    if (!/^https:\/\//i.test(base) || /localhost|127\.0\.0\.1/i.test(base)) return null;
    return `${base.replace(/\/+$/, '')}/live/overlay`;
}

export interface DestinationRow {
    id: string;
    seller_id: string;
    platform: DestinationPlatform;
    label: string;
    rtmp_url: string;
    stream_key_enc: string;
    key_hint: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

export const DESTINATION_COLS =
    'id, seller_id, platform, label, rtmp_url, stream_key_enc, key_hint, enabled, created_at, updated_at';

/** What the console sees — never the key, never the ciphertext. */
export interface DestinationPublic {
    id: string;
    platform: DestinationPlatform;
    label: string;
    rtmp_url: string;
    key_hint: string;
    enabled: boolean;
    created_at: string;
    /** The saved key can't be decrypted (secret rotated) — needs re-entry. */
    key_unreadable: boolean;
}

export function toPublicDestination(row: DestinationRow): DestinationPublic {
    return {
        id: row.id,
        platform: row.platform,
        label: row.label,
        rtmp_url: row.rtmp_url,
        key_hint: row.key_hint,
        enabled: row.enabled,
        created_at: row.created_at,
        key_unreadable: decryptStreamKey(row.stream_key_enc) === null,
    };
}

export async function listDestinations(
    sellerId: string,
): Promise<{ rows: DestinationRow[]; unavailable: boolean }> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('stream_destinations')
        .select(DESTINATION_COLS)
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: true })
        .returns<DestinationRow[]>();
    if (error) {
        if (!isMissingTableError(error)) {
            console.error('[StreamDestinations] list failed:', error.message);
        }
        return { rows: [], unavailable: isMissingTableError(error) };
    }
    return { rows: data ?? [], unavailable: false };
}

export interface ResolvedTarget {
    destination: DestinationRow;
    /** Full RTMP URL including the key — handle like a password. */
    url: string;
    urlHash: string;
}

/** Decrypt one destination into a pushable URL; null when the key is unreadable. */
export function resolveTarget(destination: DestinationRow): ResolvedTarget | null {
    const key = decryptStreamKey(destination.stream_key_enc);
    if (!key) {
        console.warn(
            `[StreamDestinations] key unreadable for destination ${destination.id} (${destination.platform}) — skipped`,
        );
        return null;
    }
    const url = composeStreamUrl(destination.rtmp_url, key);
    return { destination, url, urlHash: hashStreamUrl(url) };
}

/** The seller's ENABLED destinations, resolved. Unreadable keys are skipped, never fatal. */
export async function resolveEnabledTargets(sellerId: string): Promise<ResolvedTarget[]> {
    const { rows } = await listDestinations(sellerId);
    return rows
        .filter((r) => r.enabled)
        .map(resolveTarget)
        .filter((t): t is ResolvedTarget => t !== null);
}

export type SimulcastStatus = 'starting' | 'live' | 'ended' | 'failed' | 'removed';

export interface SimulcastTargetRow {
    id: string;
    stream_id: string;
    destination_id: string | null;
    platform: string;
    label: string;
    url_hash: string;
    status: SimulcastStatus;
    error: string | null;
    started_at: string | null;
    ended_at: string | null;
    updated_at: string;
}

export const SIMULCAST_TARGET_COLS =
    'id, stream_id, destination_id, platform, label, url_hash, status, error, started_at, ended_at, updated_at';

/**
 * Record (or re-arm) the per-show rows for targets just handed to LiveKit.
 * Upsert on (stream_id, url_hash): a mid-show "start again" flips a removed /
 * failed row back to 'starting' instead of stacking history.
 */
export async function recordSimulcastTargets(
    streamId: string,
    targets: ResolvedTarget[],
): Promise<void> {
    if (targets.length === 0) return;
    const admin = createAdminClient();
    const { error } = await admin.from('stream_simulcast_targets').upsert(
        targets.map((t) => ({
            stream_id: streamId,
            destination_id: t.destination.id,
            platform: t.destination.platform,
            label: t.destination.label,
            url_hash: t.urlHash,
            status: 'starting',
            error: null,
            started_at: null,
            ended_at: null,
        })),
        { onConflict: 'stream_id,url_hash' },
    );
    if (error && !isMissingTableError(error)) {
        console.error('[StreamDestinations] record targets failed:', error.message);
    }
}

export async function listSimulcastTargets(
    streamId: string,
): Promise<{ rows: SimulcastTargetRow[]; unavailable: boolean }> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('stream_simulcast_targets')
        .select(SIMULCAST_TARGET_COLS)
        .eq('stream_id', streamId)
        .order('updated_at', { ascending: true })
        .returns<SimulcastTargetRow[]>();
    if (error) {
        if (!isMissingTableError(error)) {
            console.error('[StreamDestinations] list targets failed:', error.message);
        }
        return { rows: [], unavailable: isMissingTableError(error) };
    }
    return { rows: data ?? [], unavailable: false };
}

/** Strip anything that looks like a stream URL (it carries the key) from text bound for a table or a log. */
export function redactStreamUrls(text: string): string {
    return text.replace(/rtmps?:\/\/\S+/gi, '<rtmp url>').slice(0, 300);
}

export async function markSimulcastTarget(
    streamId: string,
    urlHash: string,
    status: SimulcastStatus,
    error?: string | null,
): Promise<void> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
        status,
        error: error ? redactStreamUrls(error) : null,
    };
    if (status === 'live') patch.started_at = now;
    if (status === 'ended' || status === 'failed' || status === 'removed') patch.ended_at = now;
    const { error: err } = await admin
        .from('stream_simulcast_targets')
        .update(patch)
        .eq('stream_id', streamId)
        .eq('url_hash', urlHash);
    if (err && !isMissingTableError(err)) {
        console.error('[StreamDestinations] mark target failed:', err.message);
    }
}

/** LiveKit StreamInfo.status values (livekit.StreamInfo.Status). */
const STREAM_ACTIVE = 0;
const STREAM_FINISHED = 1;
const STREAM_FAILED = 2;

export interface EgressStreamResult {
    url: string;
    status: number;
    error?: string;
}

/**
 * Fold LiveKit's per-output results into the target rows. Called from the
 * webhook (egress_updated / egress_ended) and from the console's status poll.
 * `egressOver` marks every still-pending row as ended — LiveKit reports no
 * result for an output that never connected once the egress is gone.
 */
export async function syncSimulcastTargetsFromEgress(
    streamId: string,
    results: EgressStreamResult[],
    egressOver: boolean,
): Promise<SimulcastTargetRow[]> {
    const { rows, unavailable } = await listSimulcastTargets(streamId);
    if (unavailable || rows.length === 0) return rows;

    const byHash = new Map(rows.map((r) => [r.url_hash, r]));
    const seen = new Set<string>();
    for (const result of results) {
        if (!result?.url) continue;
        const hash = hashStreamUrl(result.url);
        const row = byHash.get(hash);
        if (!row) continue;
        seen.add(hash);
        // A removed output still shows up in results as FINISHED — keep the
        // seller's explicit 'removed' over LiveKit's generic 'ended'.
        const next: SimulcastStatus | null =
            result.status === STREAM_ACTIVE
                ? 'live'
                : result.status === STREAM_FAILED
                  ? 'failed'
                  : result.status === STREAM_FINISHED
                    ? row.status === 'removed'
                        ? null
                        : 'ended'
                    : null;
        if (!next || next === row.status) continue;
        await markSimulcastTarget(streamId, hash, next, result.error);
        row.status = next;
        row.error = result.error ? redactStreamUrls(result.error) : null;
    }
    if (egressOver) {
        for (const row of rows) {
            if (seen.has(row.url_hash)) continue;
            if (row.status === 'starting' || row.status === 'live') {
                await markSimulcastTarget(streamId, row.url_hash, 'ended');
                row.status = 'ended';
            }
        }
    }
    return rows;
}
