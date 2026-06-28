const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
const jsonrepairCode = fs.readFileSync('vendor/jsonrepair.min.js', 'utf8');
eval(jsonrepairCode);
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);
const cleaned = JsonRepair.robustCleanJson(preprocessed);

try {
  const repaired = window.JSONRepair.jsonrepair(cleaned);
  JSON.parse(repaired);
  console.log("PASS 2 SUCCESS");
} catch (e) {
  console.log("PASS 2 ERROR:", e.message);
  // Also see if JSON.parse(cleaned) fails without jsonrepair
  try {
    JSON.parse(cleaned);
    console.log("PASS 2 CLEANED NATIVE PARSE SUCCESS");
  } catch (e2) {
    console.log("PASS 2 CLEANED NATIVE PARSE ERROR:", e2.message);
  }
}
