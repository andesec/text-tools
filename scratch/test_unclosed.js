const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;
const jsonrepair = require('../vendor/jsonrepair.min.js');

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);

// Let's manually escape the prompt string from index 14 to the end of the text,
// simulating that robustCleanJson did not find a closing quote.
const prefix = preprocessed.substring(0, 14);
const stringContent = preprocessed.substring(14);
// Escape double quotes in stringContent
let escapedContent = '';
for (let j2 = 0; j2 < stringContent.length; j2++) {
  const curChar = stringContent[j2];
  if (curChar === '"') {
    escapedContent += '\\"';
  } else {
    escapedContent += curChar;
  }
}
const testDocument = prefix + '"' + escapedContent;
try {
  const repaired = jsonrepair.jsonrepair(testDocument);
  const parsed = JSON.parse(repaired);
  console.log("SUCCESS WITH UNCLOSED STRING!", Object.keys(parsed));
  console.log("Prompt preview:", parsed.prompt.substring(0, 100) + '...');
  console.log("Prompt end preview:", parsed.prompt.substring(parsed.prompt.length - 100));
} catch (e) {
  console.log("FAILED WITH UNCLOSED STRING:", e.message);
}
