const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');
console.log(JSON.stringify(jsonText.substring(3040, 3180)));
