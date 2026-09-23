/**
 * Canonical-id guesses for a /card/<id> URL that no longer resolves.
 *
 * WHY THIS EXISTS: the catalog has re-keyed cards twice and never told Google.
 * The 2026-08-13 Yu-Gi-Oh dedupe (dd70c0e) deleted 755 `ygo-<set>-en<NNN>`
 * rows whose bare twin `ygo-<set>-<NNN>` survived, and Destined Rivals was
 * re-ingested with zero-padded numbers (`sv10-40` became `sv10-040`). Google
 * still holds the old URLs - they were 89% and 10% of the 661 "Not found (404)"
 * pages in Search Console on 2026-09-23 - and every one of them has a live page
 * it should have been redirected to. This turns those misses into 308s.
 *
 * Pure so it can be reasoned about without a database: it only proposes ids,
 * ordered by how confident the rule is, and the caller checks which exist.
 * NO case-folding rule on purpose - pokemon_cards holds 98 ids that differ only
 * by case (English `sv10-008` beside Japanese `SV10-008`), so a case-insensitive
 * match would redirect between different cards.
 */
export function cardAliasCandidates(cardId: string): string[] {
    const out: string[] = [];
    const push = (id: string) => {
        if (id && id !== cardId && !out.includes(id)) out.push(id);
    };

    // 1. Deleted Yu-Gi-Oh duplicate: the `en` printing prefix was the only difference.
    const ygo = cardId.match(/^(ygo-[a-z0-9]+-)en(\d{3,})$/);
    if (ygo) push(`${ygo[1]}${ygo[2]}`);

    // 2. Old unpadded number from a set that now uses three digits.
    const num = cardId.match(/^(.+-)(\d{1,2})$/);
    if (num) push(`${num[1]}${num[2].padStart(3, '0')}`);

    // 3. A withdrawn variant print (`MA3-061-c`) whose base card still exists.
    const variant = cardId.match(/^(.+-\d+)-[a-z]$/);
    if (variant) push(variant[1]);

    return out;
}
