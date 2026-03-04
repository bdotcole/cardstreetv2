const fs = require('fs');

const oldMap = {
    // Scarlet & Violet era
    'sv8pt5': 'prismatic-evolutions-pokemon',
    'sv08pt5': 'surging-sparks-pokemon',
    'sv08': 'surging-sparks-pokemon',
    'sv09': 'sv09-journey-together-pokemon',
    'sv10': 'sv10-destined-rivals-pokemon',
    'sv10.5b': 'sv-black-bolt-pokemon',
    'sv10.5w': 'sv-white-flare-pokemon',
    'sv07': 'stellar-crown-pokemon',
    'sv06': 'twilight-masquerade-pokemon',
    'sv05': 'temporal-forces-pokemon',
    'sv04.5': 'paldean-fates-pokemon',
    'sv04': 'paradox-rift-pokemon',
    'sv03.5': 'pokemon-151-pokemon',
    'sv03': 'obsidian-flames-pokemon',
    'sv02': 'paldea-evolved-pokemon',
    'sv01': 'scarlet-violet-base-set-pokemon',
    // Sword & Shield era
    'swsh12.5': 'crown-zenith-pokemon',
    'swsh12': 'silver-tempest-pokemon',
    'swsh11': 'lost-origin-pokemon',
    'swsh10.5': 'pokemon-go-pokemon',
    'swsh10': 'astral-radiance-pokemon',
    'swsh9': 'brilliant-stars-pokemon',
    'swsh8': 'fusion-strike-pokemon',
    'swsh7': 'evolving-skies-pokemon',
    'swsh6': 'chilling-reign-pokemon',
    'swsh5': 'battle-styles-pokemon',
    'swsh4.5': 'shining-fates-pokemon',
    'swsh4': 'vivid-voltage-pokemon',
    'swsh35': 'champions-path-pokemon',
    'swsh3': 'darkness-ablaze-pokemon',
    'swsh2': 'rebel-clash-pokemon',
    'swsh1': 'sword-shield-pokemon',
    // Celebrations
    'cel25': 'celebrations-pokemon',
    // Sun & Moon era
    'sm12': 'cosmic-eclipse-pokemon',
    'sm11': 'unified-minds-pokemon',
    'sm10': 'unbroken-bonds-pokemon',
    'sm9': 'team-up-pokemon',
    'sm8': 'lost-thunder-pokemon',
    'sm75': 'dragon-majesty-pokemon',
    'sm7': 'celestial-storm-pokemon',
    'sm6': 'forbidden-light-pokemon',
    'sm5': 'ultra-prism-pokemon',
    'sm4': 'crimson-invasion-pokemon',
    'sm35': 'shining-legends-pokemon',
    'sm3': 'burning-shadows-pokemon',
    'sm2': 'guardians-rising-pokemon',
    'sm1': 'sun-moon-pokemon',
    // XY era
    'xy12': 'evolutions-pokemon',
    'xy11': 'steam-siege-pokemon',
    'xy10': 'fates-collide-pokemon',
    'xy9': 'breakpoint-pokemon',
    'xy8': 'breakthrough-pokemon',
    'xy75': 'ancient-origins-pokemon',
    'xy7': 'roaring-skies-pokemon',
    'xy6': 'primal-clash-pokemon',
    'xy4': 'phantom-forces-pokemon',
    'xy3': 'furious-fists-pokemon',
    'xy2': 'flashfire-pokemon',
    'xy1': 'xy-base-set-pokemon',
    // Black & White era
    'bw11': 'legendary-treasures-pokemon',
    'bw10': 'plasma-blast-pokemon',
    'bw9': 'plasma-freeze-pokemon',
    'bw8': 'plasma-storm-pokemon',
    'bw7': 'boundaries-crossed-pokemon',
    'bw6': 'dragons-exalted-pokemon',
    'bw5': 'dark-explorers-pokemon',
    'bw4': 'next-destinies-pokemon',
    'bw3': 'noble-victories-pokemon',
    'bw2': 'emerging-powers-pokemon',
    'bw1': 'black-white-pokemon',
    // HeartGold & SoulSilver
    'hgss4': 'triumphant-pokemon',
    'hgss3': 'undaunted-pokemon',
    'hgss2': 'unleashed-pokemon',
    'hgss1': 'heartgold-soulsilver-pokemon',
    // Platinum era
    'pl4': 'arceus-pokemon',
    'pl3': 'supreme-victors-pokemon',
    'pl2': 'rising-rivals-pokemon',
    'pl1': 'platinum-pokemon',
    // Diamond & Pearl
    'dp7': 'stormfront-pokemon',
    'dp6': 'legends-awakened-pokemon',
    'dp5': 'majestic-dawn-pokemon',
    'dp4': 'great-encounters-pokemon',
    'dp3': 'secret-wonders-pokemon',
    'dp2': 'mysterious-treasures-pokemon',
    'dp1': 'diamond-pearl-pokemon',
    // Base era
    'base1': 'base-set-pokemon',
    'base2': 'jungle-pokemon',
    'base3': 'fossil-pokemon',
    'base4': 'base-set-2-pokemon',
    'base5': 'team-rocket-pokemon',
    'base6': 'gym-heroes-pokemon',
    'base7': 'gym-challenge-pokemon',
    // Neo
    'neo1': 'neo-genesis-pokemon',
    'neo2': 'neo-discovery-pokemon',
    'neo3': 'neo-revelation-pokemon',
    'neo4': 'neo-destiny-pokemon',
};

const sets = JSON.parse(fs.readFileSync('jtcg-sets.json', 'utf8'));
const newMap = {};

for (const [dbId, oldJtcgId] of Object.entries(oldMap)) {
    // try exact match first
    let match = sets.find(s => s.id === oldJtcgId);
    if (!match) {
        // JustTCG recently prepended tags like "swsh03-" to darkness ablaze, or "sm-", or "xy-"
        // Search for partial matches
        const searchTerms = oldJtcgId.replace('-pokemon', '').split('-');

        // Find best match in new api
        const scores = sets.map(s => {
            let score = 0;
            const target = s.id.toLowerCase();
            for (const t of searchTerms) {
                if (target.includes(t)) score++;
            }
            return { id: s.id, score, name: s.name };
        }).sort((a, b) => b.score - a.score);

        match = scores[0];
    }

    newMap[dbId] = match.id;
}

console.log(JSON.stringify(newMap, null, 4));
