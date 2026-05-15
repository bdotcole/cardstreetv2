const fs = require('fs');

const path = 'supabase/functions/batch-price-english/index.ts';
let code = fs.readFileSync(path, 'utf8');

const targetLine = "upsert(rows, { onConflict: 'card_id,language,condition' });";
if (code.includes(targetLine)) {
    code = code.replace(
        /.upsert\(rows, \{ onConflict: 'card_id,language,condition' \}\);/g,
        `.upsert(Array.from(new Map(rows.map(r => [r.card_id, r])).values()), { onConflict: 'card_id,language,condition' });`
    );
    fs.writeFileSync(path, code, 'utf8');
    console.log("Patch applied correctly.");
} else {
    console.log("Could not find line to patch.");
}
