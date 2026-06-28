const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);

// Let's implement a debug version of robustCleanJson
let text = preprocessed;
let stack = [];
let i = 0;
while (i < text.length) {
  const ch = text[i];
  if (/\s/.test(ch)) { i++; continue; }
  if (ch === '{') { stack.push('{'); i++; continue; }
  if (ch === '}') { stack.pop(); i++; continue; }
  if (ch === '[') { stack.push('['); i++; continue; }
  if (ch === ']') { stack.pop(); i++; continue; }
  if (ch === ':') { i++; continue; }
  if (ch === ',') { i++; continue; }
  
  if (ch === '"') {
    let candidateIndices = [];
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === '"') {
        let backslashCount = 0;
        let k = j - 1;
        while (k > i && text[k] === '\\') { backslashCount++; k--; }
        if (backslashCount % 2 === 0) candidateIndices.push(j);
      }
      j++;
    }
    console.log('Found double quote at', i);
    console.log('Candidates:', candidateIndices);
    // Find valid follow up
    for (let idx=0; idx < candidateIndices.length; idx++) {
      // test follow up
      let qIndex = candidateIndices[idx];
      let nextNonWs = '';
      let nextPos = qIndex + 1;
      while (nextPos < text.length) {
        if (!/\s/.test(text[nextPos])) { nextNonWs = text[nextPos]; break; }
        nextPos++;
      }
      console.log('Candidate', qIndex, 'nextNonWs:', nextNonWs);
    }
    break;
  }
  i++;
}
