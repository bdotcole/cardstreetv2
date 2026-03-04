const fs = require('fs');

const path = 'supabase/functions/batch-price-english/index.ts';
let code = fs.readFileSync(path, 'utf8');

const target = `                    if (rows.length > 0) {
                        const { error: upsertErr } = await supabase
                            .from('market_values')
                            .upsert(rows, { onConflict: 'card_id,language,condition' });
                        if (upsertErr) console.error(\`  [error] upsert:\`, upsertErr.message);
                    }`;

const replacement = `                    if (rows.length > 0) {
                        const dedupedRows = Array.from(new Map(rows.map(r => [r.card_id, r])).values());
                        const { error: upsertErr } = await supabase
                            .from('market_values')
                            .upsert(dedupedRows, { onConflict: 'card_id,language,condition' });
                        if (upsertErr) console.error(\`  [error] upsert:\`, upsertErr.message);
                    }`;

code = code.replace(target, replacement);
fs.writeFileSync(path, code);
console.log("Patched deduplication successfully.");
