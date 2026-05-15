const fs = require('fs');
const files = [
  'components/BuylistRequest.tsx',
  'components/CardDetails.tsx',
  'components/ListingForm.tsx',
  'components/Profile.tsx',
  'components/Vault.tsx'
];
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8').split('\n');
  content.forEach((l, i) => {
    if (/[\u0E00-\u0E7F]/.test(l)) {
      console.log(`${f}:${i+1}:${l.trim()}`);
    }
  });
}
