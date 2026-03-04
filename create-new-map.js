const fs = require('fs');

const oldMap = {
    // Scarlet & Violet era
    'sv8pt5': 'prismatic-evolutions-pokemon', // -> sv-prismatic-evolutions-pokemon
    'sv08pt5': 'surging-sparks-pokemon', // -> sv08-surging-sparks-pokemon
    'sv08': 'surging-sparks-pokemon',
    'sv09': 'sv09-journey-together-pokemon',
    'sv10': 'sv10-destined-rivals-pokemon',
    'sv10.5b': 'sv-black-bolt-pokemon',
    'sv10.5w': 'sv-white-flare-pokemon',
    'sv07': 'stellar-crown-pokemon', // -> sv07-stellar-crown-pokemon
    'sv06': 'twilight-masquerade-pokemon', // -> sv06-twilight-masquerade-pokemon
    'sv05': 'temporal-forces-pokemon', // -> sv05-temporal-forces-pokemon
    'sv04.5': 'paldean-fates-pokemon', // -> sv-paldean-fates-pokemon
    'sv04': 'paradox-rift-pokemon', // -> sv04-paradox-rift-pokemon
    'sv03.5': 'pokemon-151-pokemon', // -> sv-scarlet-violet-151-pokemon
    'sv03': 'obsidian-flames-pokemon', // -> sv03-obsidian-flames-pokemon
    'sv02': 'paldea-evolved-pokemon', // -> sv02-paldea-evolved-pokemon
    'sv01': 'scarlet-violet-base-set-pokemon', // -> sv01-scarlet-violet-base-set-pokemon
    // Sword & Shield era
    'swsh12.5': 'crown-zenith-pokemon', // crown-zenith-pokemon
    'swsh12': 'silver-tempest-pokemon', // swsh12-silver-tempest-pokemon
    'swsh11': 'lost-origin-pokemon', // swsh11-lost-origin-pokemon
    'swsh10.5': 'pokemon-go-pokemon', // pokemon-go-pokemon
    'swsh10': 'astral-radiance-pokemon', // swsh10-astral-radiance-pokemon
    'swsh9': 'brilliant-stars-pokemon', // swsh09-brilliant-stars-pokemon
    'swsh8': 'fusion-strike-pokemon', // swsh08-fusion-strike-pokemon
    'swsh7': 'evolving-skies-pokemon', // swsh07-evolving-skies-pokemon
    'swsh6': 'chilling-reign-pokemon', // swsh06-chilling-reign-pokemon
    'swsh5': 'battle-styles-pokemon', // swsh05-battle-styles-pokemon
    'swsh4.5': 'shining-fates-pokemon', // shining-fates-pokemon
    'swsh4': 'vivid-voltage-pokemon', // swsh04-vivid-voltage-pokemon
    'swsh35': 'champions-path-pokemon', // champion-s-path-pokemon
    'swsh3': 'darkness-ablaze-pokemon', // swsh03-darkness-ablaze-pokemon
    'swsh2': 'rebel-clash-pokemon', // swsh02-rebel-clash-pokemon
    'swsh1': 'sword-shield-pokemon', // swsh01-sword-shield-base-set-pokemon
    // Celebrations
    'cel25': 'celebrations-pokemon', // celebrations-pokemon
    // Sun & Moon era
    'sm12': 'cosmic-eclipse-pokemon', // sm-cosmic-eclipse-pokemon
    'sm11': 'unified-minds-pokemon', // sm-unified-minds-pokemon
    'sm10': 'unbroken-bonds-pokemon', // sm-unbroken-bonds-pokemon
    'sm9': 'team-up-pokemon', // sm-team-up-pokemon
    'sm8': 'lost-thunder-pokemon', // sm-lost-thunder-pokemon
    'sm75': 'dragon-majesty-pokemon', // dragon-majesty-pokemon
    'sm7': 'celestial-storm-pokemon', // sm-celestial-storm-pokemon
    'sm6': 'forbidden-light-pokemon', // sm-forbidden-light-pokemon
    'sm5': 'ultra-prism-pokemon', // sm-ultra-prism-pokemon
    'sm4': 'crimson-invasion-pokemon', // sm-crimson-invasion-pokemon
    'sm35': 'shining-legends-pokemon', // shining-legends-pokemon
    'sm3': 'burning-shadows-pokemon', // sm-burning-shadows-pokemon
    'sm2': 'guardians-rising-pokemon', // sm-guardians-rising-pokemon
    'sm1': 'sun-moon-pokemon', // sm-base-set-pokemon
    // XY era
    'xy12': 'evolutions-pokemon', // xy-evolutions-pokemon
    'xy11': 'steam-siege-pokemon', // xy-steam-siege-pokemon
    'xy10': 'fates-collide-pokemon', // xy-fates-collide-pokemon
    'xy9': 'breakpoint-pokemon', // xy-breakpoint-pokemon
    'xy8': 'breakthrough-pokemon', // xy-breakthrough-pokemon
    'xy75': 'ancient-origins-pokemon', // xy-ancient-origins-pokemon
    'xy7': 'roaring-skies-pokemon', // xy-roaring-skies-pokemon
    'xy6': 'primal-clash-pokemon', // xy-primal-clash-pokemon
    'xy4': 'phantom-forces-pokemon', // xy-phantom-forces-pokemon
    'xy3': 'furious-fists-pokemon', // xy-furious-fists-pokemon
    'xy2': 'flashfire-pokemon', // xy-flashfire-pokemon
    'xy1': 'xy-base-set-pokemon', // xy-base-set-pokemon
    // Black & White era
    'bw11': 'legendary-treasures-pokemon', // legendary-treasures-pokemon
    'bw10': 'plasma-blast-pokemon', // plasma-blast-pokemon
    'bw9': 'plasma-freeze-pokemon', // plasma-freeze-pokemon
    'bw8': 'plasma-storm-pokemon', // plasma-storm-pokemon
    'bw7': 'boundaries-crossed-pokemon', // boundaries-crossed-pokemon
    'bw6': 'dragons-exalted-pokemon', // dragons-exalted-pokemon
    'bw5': 'dark-explorers-pokemon', // dark-explorers-pokemon
    'bw4': 'next-destinies-pokemon', // next-destinies-pokemon
    'bw3': 'noble-victories-pokemon', // noble-victories-pokemon
    'bw2': 'emerging-powers-pokemon', // emerging-powers-pokemon
    'bw1': 'black-white-pokemon', // black-and-white-pokemon
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
    'dp1': 'diamond-pearl-pokemon', // diamond-and-pearl-pokemon
    // Base era
    'base1': 'base-set-pokemon',
    'base2': 'jungle-pokemon',
    'base3': 'fossil-pokemon',
    'base4': 'base-set-2-pokemon',
    'base5': 'team-rocket-pokemon',
    'base6': "gym-heroes-pokemon",
    'base7': 'gym-challenge-pokemon',
    // Neo
    'neo1': 'neo-genesis-pokemon',
    'neo2': 'neo-discovery-pokemon',
    'neo3': 'neo-revelation-pokemon',
    'neo4': 'neo-destiny-pokemon',
};

const manualOverrides = {
    'sv01': 'sv01-scarlet-violet-base-set-pokemon',
    'sv02': 'sv02-paldea-evolved-pokemon',
    'sv03': 'sv03-obsidian-flames-pokemon',
    'sv03.5': 'sv-scarlet-violet-151-pokemon',
    'sv04': 'sv04-paradox-rift-pokemon',
    'sv04.5': 'sv-paldean-fates-pokemon',
    'sv05': 'sv05-temporal-forces-pokemon',
    'sv06': 'sv06-twilight-masquerade-pokemon',
    'sv07': 'sv07-stellar-crown-pokemon',
    'sv08': 'sv08-surging-sparks-pokemon',
    'sv08pt5': 'sv08-surging-sparks-pokemon',
    'sv8pt5': 'sv-prismatic-evolutions-pokemon',
    'swsh1': 'swsh01-sword-shield-base-set-pokemon',
    'swsh2': 'swsh02-rebel-clash-pokemon',
    'swsh3': 'swsh03-darkness-ablaze-pokemon',
    'swsh35': 'champion-s-path-pokemon',
    'swsh4': 'swsh04-vivid-voltage-pokemon',
    'swsh4.5': 'shining-fates-pokemon',
    'swsh5': 'swsh05-battle-styles-pokemon',
    'swsh6': 'swsh06-chilling-reign-pokemon',
    'swsh7': 'swsh07-evolving-skies-pokemon',
    'swsh8': 'swsh08-fusion-strike-pokemon',
    "swsh9": "swsh09-brilliant-stars-pokemon",
    "swsh10": "swsh10-astral-radiance-pokemon",
    "swsh11": "swsh11-lost-origin-pokemon",
    "swsh12": "swsh12-silver-tempest-pokemon",
    "sm12": "sm-cosmic-eclipse-pokemon",
    "sm11": "sm-unified-minds-pokemon",
    "sm10": "sm-unbroken-bonds-pokemon",
    "sm9": "sm-team-up-pokemon",
    "sm8": "sm-lost-thunder-pokemon",
    "sm7": "sm-celestial-storm-pokemon",
    "sm6": "sm-forbidden-light-pokemon",
    "sm5": "sm-ultra-prism-pokemon",
    "sm4": "sm-crimson-invasion-pokemon",
    "sm3": "sm-burning-shadows-pokemon",
    "sm2": "sm-guardians-rising-pokemon",
    "sm1": "sm-base-set-pokemon",
    "xy12": "xy-evolutions-pokemon",
    "xy11": "xy-steam-siege-pokemon",
    "xy10": "xy-fates-collide-pokemon",
    "xy9": "xy-breakpoint-pokemon",
    "xy8": "xy-breakthrough-pokemon",
    "xy75": "xy-ancient-origins-pokemon",
    "xy7": "xy-roaring-skies-pokemon",
    "xy6": "xy-primal-clash-pokemon",
    "xy4": "xy-phantom-forces-pokemon",
    "xy3": "xy-furious-fists-pokemon",
    "xy2": "xy-flashfire-pokemon",
    "bw1": "black-and-white-pokemon",
    "dp1": "diamond-and-pearl-pokemon",
};

const finalMap = { ...oldMap, ...manualOverrides };
fs.writeFileSync('new-map.json', JSON.stringify(finalMap, null, 4));
console.log("Created new-map.json");
