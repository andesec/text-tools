const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');
console.log('2110-2140:', jsonText.substring(2110, 2140));
