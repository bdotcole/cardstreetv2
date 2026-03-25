const fs = require('fs');
let code = fs.readFileSync('app/admin/sets/page.tsx', 'utf8');

code = code.split('\`https://jyrfplsuwgcivwvwbvhw.supabase.co/storage/v1/object/public/images/thai/${row.th.set_id}/${encodeURIComponent(row.th.number)}.webp\`').join('row.th.image_small || row.th.image_large || \\\'https://cardstreet.com/placeholder.png\\\'');

code = code.split('row.en.images?.small').join('row.en.image_small');
code = code.split('row.en.images.small').join('row.en.image_small');
code = code.split('c.images?.small').join('c.image_small');
code = code.split('c.images.small').join('c.image_small');

fs.writeFileSync('app/admin/sets/page.tsx', code);
console.log('Successfully completed full Native Disk swap!');
