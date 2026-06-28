const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);
const cleaned = JsonRepair.robustCleanJson(preprocessed);

console.log('Cleaned length:', cleaned.length);
console.log('Cleaned char at 695:', cleaned[695]);
console.log('Cleaned context 675-715:', cleaned.substring(675, 715));
