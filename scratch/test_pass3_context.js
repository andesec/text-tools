const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
let cleaned = JsonRepair.performSophisticatedClean(preprocessed);
cleaned = JsonRepair.fixMissingBracketOpeners(cleaned);
cleaned = JsonRepair.fixMismatchedBrackets(cleaned);

console.log('Char at 695:', cleaned[695]);
console.log('Context 675-715:', cleaned.substring(675, 715));

fs.writeFileSync('scratch/cleaned_pass3.json', cleaned);
