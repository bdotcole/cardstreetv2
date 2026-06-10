const fs = require('fs');

async function testJTCG() {
    try {
        const res = await fetch("https://api.justtcg.com/v1/sets?game=pokemon", {
            headers: { "x-api-key": "tcg_0b676c7d68074ec2ba032430a5868f9a" }
        });
        const data = await res.json();
        
        // Find if they use standard IDs or Slugs
        let matchingSets = data.data.filter(s => 
            s.id.toLowerCase().includes('s8b') || 
            s.name.toLowerCase().includes('vmax climax') ||
            s.slug.toLowerCase().includes('vmax-climax')
        );
        console.log("Matching Sets in JustTCG:", JSON.stringify(matchingSets, null, 2));
        
        if (matchingSets.length > 0) {
            let jId = matchingSets[0].id;
            const cardRes = await fetch(`https://api.justtcg.com/v1/cards?game=pokemon&set=${jId}&limit=5`, {
                headers: { "x-api-key": "tcg_0b676c7d68074ec2ba032430a5868f9a" }
            });
            const cData = await cardRes.json();
            console.log("\nSample Cards:", JSON.stringify(cData.data, null, 2));
        }
    } catch(e) {
        console.log(e);
    }
}
testJTCG();
