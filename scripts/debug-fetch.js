
const fs = require('fs');
const https = require('https');

const url = 'https://asia.pokemon-card.com/th/card-search/detail/12911/';

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        fs.writeFileSync('debug_card.html', data);
        console.log('Downloaded debug_card.html');
    });
}).on('error', (err) => {
    console.log('Error: ' + err.message);
});
