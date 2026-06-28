const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
// We need to load vendor/jsonrepair.min.js first
const jsonrepairCode = fs.readFileSync('vendor/jsonrepair.min.js', 'utf8');
// Evaluate it in global scope (it defines window.JSONRepair)
eval(jsonrepairCode);

require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

try {
  JsonRepair.safeJsonParse(jsonText);
  console.log("SUCCESS");
} catch (e) {
  console.log("SAFEJSONPARSE ERROR:", e.message);
}
