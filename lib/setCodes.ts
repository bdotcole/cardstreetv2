// Set-page title parts: the printed set code and the catalog language.
//
// Twin sets share a name across languages — OP-01 Romance Dawn exists in English
// and Japanese, MA6 (Thai) and M6a (Japanese) are both "30th CELEBRATION" — so
// titles built from the name alone collided: 77 groups, 155 set pages, measured
// 2026-09-25. Code plus language makes every set title in the catalog unique.

interface SetIdentity {
    id: string;
    name: string;
    game: string;
    language: string;
}

// The code printed on a card (MA6, SV8a, OP-09, AGOV) is how collectors search for
// a set, but no set name in the catalog contains it. Returns null where the id is
// not a printed code: English Pokemon (pokemontcg.io ids like swsh10.5), vintage
// and promo rows, Yu-Gi-Oh prize-card years, and games whose ids are internal.
export function printedSetCode(set: Pick<SetIdentity, 'id' | 'game' | 'language'>): string | null {
    if (set.game === 'onepiece') {
        const m = set.id.match(/^op-(op|eb|st|prb)-(\d{2})(?:-jp)?$/i);
        return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
    }
    if (set.game === 'yugioh') {
        const m = set.id.match(/^ygo-([a-z0-9]{2,6})(?:-jp)?$/i);
        return m && !/^\d{4}$/.test(m[1]) ? m[1].toUpperCase() : null;
    }
    if (set.game === 'pokemon' && (set.language === 'th' || set.language === 'ja')) {
        const code = set.id.replace(/-th$/i, '');
        if (/^(E\d|neo\d|PCG\d|PMCG\d|VS\d|web\d)/i.test(code) || /-P$/i.test(code)) return null;
        return code.charAt(0).toUpperCase() + code.slice(1);
    }
    return null;
}

/** "MA6 30th CELEBRATION", "OP-01 Romance Dawn": the set name led by its printed code. */
export function setTitleName(set: SetIdentity): string {
    const code = printedSetCode(set);
    return code && !set.name.toLowerCase().includes(code.toLowerCase()) ? `${code} ${set.name}` : set.name;
}

// English is the untagged default: only Thai and Japanese sets say which catalog
// they are, so an English twin and its Japanese twin never read the same.
const TH_LANGUAGE: Record<string, string> = { th: 'ภาษาไทย', ja: 'ภาษาญี่ปุ่น', jp: 'ภาษาญี่ปุ่น' };
const EN_LANGUAGE: Record<string, string> = { th: 'Thai', ja: 'Japanese', jp: 'Japanese' };

/** "การ์ดโปเกมอนภาษาไทย": Thai joins Thai with no space; a Latin label keeps one. */
export function withThaiLanguage(label: string, language: string): string {
    const lang = TH_LANGUAGE[language];
    if (!lang) return label;
    return /[฀-๿]$/.test(label) ? `${label}${lang}` : `${label} ${lang}`;
}

/** "Japanese Pokémon": the English label led by its language; English untagged. */
export function withEnglishLanguage(label: string, language: string): string {
    const lang = EN_LANGUAGE[language];
    return lang ? `${lang} ${label}` : label;
}
