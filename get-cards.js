const fs = require('fs');

async function run() {
  for(let i=1; i<=1; i++) {
    console.log(`fetching page ${i}...`);
    const res = await fetch(`https://asia.pokemon-card.com/th/card-search/list/?pageNo=${i}&expansionCodes=S12a`);
    const text = await res.text();
    fs.writeFileSync(`page_${i}.html`, text);
  }
}
run();
