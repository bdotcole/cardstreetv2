// Check what the actual content-type is
const testUrl = 'https://assets.tcgdex.net/en/base/base1/1/high';

console.log(`Testing full GET request to: ${testUrl}\n`);

const response = await fetch(testUrl);
const contentType = response.headers.get('content-type');

console.log(`Status: ${response.status}`);
console.log(`Content-Type: ${contentType}\n`);

// Get first 500 chars to see what's actually being returned
const text = await response.text();
console.log('First 500 chars of response:');
console.log(text.substring(0, 500));
console.log('\n---\nLast 200 chars:');
console.log(text.substring(text.length - 200));
