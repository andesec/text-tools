const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);
const cleaned = JsonRepair.robustCleanJson(preprocessed);

console.log("Original robustCleanJson output length:", cleaned.length);
console.log("Char at 2143:", JSON.stringify(cleaned[2143]));
console.log("Context 2120-2160:", JSON.stringify(cleaned.substring(2120, 2160)));
