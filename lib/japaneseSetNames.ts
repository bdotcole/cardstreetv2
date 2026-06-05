// English display names for Japanese-exclusive Pokemon sets.
//
// Most modern JP sets have no international release, so TCGdex/pokemontcg.io
// carry no English name for them. The app is English-first, so we surface a
// curated English/romaji name for the high-value (image-complete) SV-era sets.
// Older e-Card/PCG/PMCG sets are left in Japanese (low traffic, no card images
// upstream, and their English naming is ambiguous). Keyed by pokemon_sets.id.
export const JP_SET_NAMES: Record<string, string> = {
  SV7: 'Stellar Miracle',
  SV7a: 'Paradise Dragona',
  SV9: 'Battle Partners',
  SV9a: 'Heat Wave Arena',
  SV10: 'Glory of Team Rocket',
  SV11W: 'White Flare',
  SVK: 'Deck Build Box: Stellar Miracle',
  SVLN: 'Starter Set: Terastal Sylveon ex',
  SVLS: 'Starter Set: Terastal Ceruledge ex',
};

/** English name for a JP set id, falling back to the original name. */
export function englishJpSetName(setId: string | null | undefined, fallback: string): string {
  if (!setId) return fallback;
  return JP_SET_NAMES[setId] || fallback;
}
