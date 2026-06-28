const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;
const jsonrepair = require('../vendor/jsonrepair.min.js');

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);
const cleaned = JsonRepair.robustCleanJson(preprocessed);

try {
  const repaired = jsonrepair.jsonrepair(cleaned);
  console.log("JSONREPAIR SUCCESS!");
} catch (e) {
  console.log("JSONREPAIR THREW:", e.message);
}
