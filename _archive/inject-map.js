const fs = require('fs');
const newMap = JSON.parse(fs.readFileSync('new-map.json', 'utf8'));

let indexCode = fs.readFileSync('supabase/functions/batch-price-english/index.ts', 'utf8');

// Find the start and end of SET_ID_MAP
const startIdx = indexCode.indexOf('const SET_ID_MAP: Record<string, string> = {');
const endIdx = indexCode.indexOf('};', startIdx) + 2;

if (startIdx === -1 || endIdx < startIdx) {
    console.error("Could not find SET_ID_MAP in index.ts");
    process.exit(1);
}

// Format the new map into TS object literal form
let newMapStr = 'const SET_ID_MAP: Record<string, string> = {\n';
for (const [key, val] of Object.entries(newMap)) {
    newMapStr += `    '${key}': '${val}',\n`;
}
newMapStr += '};';

const newCode = indexCode.substring(0, startIdx) + newMapStr + indexCode.substring(endIdx);
fs.writeFileSync('supabase/functions/batch-price-english/index.ts', newCode, 'utf8');
console.log("Successfully replaced SET_ID_MAP in batch-price-english/index.ts");
