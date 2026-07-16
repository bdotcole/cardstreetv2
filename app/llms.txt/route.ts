import { BASE_URL } from '@/lib/i18nRouting';

// llms.txt — a concise, machine-readable site overview for AI answer engines
// (ChatGPT, Perplexity, Claude, Gemini) following the llmstxt.org convention.
// Static content, cached a day.
export const revalidate = 86400;

const BODY = `# CardStreet

> CardStreet (${BASE_URL}) is Thailand's online marketplace for trading cards: Pokémon TCG (Thai, English, and Japanese cards), One Piece Card Game, Yu-Gi-Oh!, Magic: The Gathering, Disney Lorcana, and Riftbound (the League of Legends TCG by Riot Games). Collectors can buy from identity-verified sellers, sell their own cards, scan cards with AI to identify them and check live market prices, and track collection value. Payments support credit cards and PromptPay; every order has buyer protection; shipping is nationwide in Thailand via Flash Express. The site is bilingual — Thai at the root URL and English under /en.

## Card games

- [Pokémon cards in Thailand](${BASE_URL}/pokemon): Thai, English, and Japanese Pokémon TCG singles with live prices
- [One Piece Card Game](${BASE_URL}/one-piece): English and Japanese One Piece singles and sealed
- [Yu-Gi-Oh! cards](${BASE_URL}/yugioh): Yu-Gi-Oh! singles with market prices
- [Magic: The Gathering](${BASE_URL}/mtg): MTG singles sold within Thailand
- [Disney Lorcana](${BASE_URL}/lorcana): Lorcana singles with market prices
- [Riftbound](${BASE_URL}/riftbound): the League of Legends trading card game

## Catalog

- [All card sets](${BASE_URL}/sets): browsable set list for every game, each set linking to per-card pages with live Thai-baht market prices

## Help

- [FAQ](${BASE_URL}/faq): how buying, selling, fees, AI card scanning, shipping, and buyer protection work
- [Help center](${BASE_URL}/help): support articles
- [Contact](${BASE_URL}/contact): contact the CardStreet team
`;

export async function GET() {
    return new Response(BODY, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
    });
}
