const fs = require('fs');

const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');

const JsonRepair = global.window.JsonRepair;

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);
const cleaned = JsonRepair.robustCleanJson(preprocessed);

// Write cleaned to file to inspect
fs.writeFileSync('scratch/cleaned.json', cleaned);

console.log('Cleaned length:', cleaned.length);
if (cleaned.length > 695) {
  console.log('Cleaned char at 695:', cleaned[695]);
  console.log('Cleaned context 685-705:', cleaned.substring(685, 705));
}

try {
  JSON.parse(cleaned);
  console.log('Parsed cleaned successfully');
} catch (e) {
  console.log('Failed to parse cleaned:', e.message);
}
