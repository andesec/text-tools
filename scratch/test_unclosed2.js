const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;
const jsonrepair = require('../vendor/jsonrepair.min.js');

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);

// Escape literal newlines FIRST!
preprocessed = JsonRepair.escapeLiteralNewlinesInStrings(preprocessed);

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
  console.log("SUCCESS WITH ESCAPED NEWLINES!", Object.keys(parsed));
  console.log("Prompt preview:", parsed.prompt.substring(0, 100) + '...');
} catch (e) {
  console.log("FAILED WITH ESCAPED NEWLINES:", e.message);
}
