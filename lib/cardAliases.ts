import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { cardAliasCandidates } from '@/lib/cardAliasCandidates';

/**
 * The live card id a dead /card/<id> URL should redirect to, or null when the
 * page is genuinely gone. Runs only on the miss path, so the extra round-trip
 * costs nothing on a normal card view. One `.in()` on the primary key, and the
 * first candidate (most confident rule) that exists wins.
 */
export async function resolveCardAlias(cardId: string): Promise<string | null> {
    const candidates = cardAliasCandidates(cardId);
    if (candidates.length === 0) return null;

    const supabase = await createClient();
    const { data } = await supabase.from('pokemon_cards').select('id').in('id', candidates);
    const live = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    return candidates.find((c) => live.has(c)) ?? null;
}
