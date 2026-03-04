import fetch from 'node-fetch';

async function checkTcgDex() {
    const setsResponse = await fetch('https://api.tcgdex.net/v2/en/sets');
    const sets = await setsResponse.json();
    const prismatic = sets.find(s => s.name.includes('Prismatic Evolutions'));
    console.log("Prismatic Evolutions Set Info:", prismatic);

    const shrouded = sets.find(s => s.name.includes('Shrouded Fable'));
    console.log("Shrouded Fable Set Info:", shrouded);
}

checkTcgDex();
