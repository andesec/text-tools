const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
const jsonrepairCode = fs.readFileSync('vendor/jsonrepair.min.js', 'utf8');
eval(jsonrepairCode);
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

try {
  let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
  let cleaned = JsonRepair.performSophisticatedClean(preprocessed);
  cleaned = JsonRepair.fixMissingBracketOpeners(cleaned);
  cleaned = JsonRepair.fixMismatchedBrackets(cleaned);
  
  try {
    JSON.parse(cleaned);
    console.log("PASS 3 PARSE SUCCESS");
  } catch (e3) {
    console.log("PASS 3 NATIVE PARSE ERROR:", e3.message);
  }

} catch (e) {
  console.log("ERROR DURING CLEANING:", e.message);
}
