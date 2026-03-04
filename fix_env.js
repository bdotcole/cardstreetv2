const fs = require('fs');
try {
    let buf = fs.readFileSync('.env.local');
    if (buf[0] === 0xFF && buf[1] === 0xFE) {
        let str = buf.toString('utf16le');
        fs.writeFileSync('.env.local', str, 'utf8');
        console.log('Fixed .env.local encoding from UTF-16LE');
    } else {
        let str = buf.toString('utf8').replace(/\x00/g, '');
        fs.writeFileSync('.env.local', str, 'utf8');
        console.log('Stripped null bytes from .env.local');
    }
} catch (e) {
    console.error(e);
}
