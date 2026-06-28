const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);

let text = preprocessed;
let stack = [];
let i = 0;
let expectKey = false;
while (i < text.length) {
  const ch = text[i];
  if (/\s/.test(ch)) { i++; continue; }
  
  if (ch === '/' && text[i+1] === '/') {
    while (i < text.length && text[i] !== '\\n' && text[i] !== '\\r') i++;
    continue;
  }
  if (ch === '/' && text[i+1] === '*') {
    i += 2;
    while (i < text.length && !(text[i] === '*' && text[i+1] === '/')) i++;
    if (i < text.length) i += 2;
    continue;
  }

  if (ch === '{') { stack.push('{'); expectKey = true; i++; continue; }
  if (ch === '}') { stack.pop(); expectKey = false; i++; continue; }
  if (ch === '[') { stack.push('['); expectKey = false; i++; continue; }
  if (ch === ']') { stack.pop(); expectKey = false; i++; continue; }
  if (ch === ':') { expectKey = false; i++; continue; }
  if (ch === ',') { 
    expectKey = stack[stack.length-1] === '{'; 
    i++; continue; 
  }
  
  if (ch === '"') {
    let candidateIndices = [];
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === '"') {
        let backslashCount = 0;
        let k = j - 1;
        while (k > i && text[k] === '\\\\') { backslashCount++; k--; }
        if (backslashCount % 2 === 0) candidateIndices.push(j);
      }
      j++;
    }
    
    let closingQuoteIndex = -1;
    let nextNonWsChosen = '';
    
    if (expectKey) {
      for (let idx=0; idx < candidateIndices.length; idx++) {
        let qIndex = candidateIndices[idx];
        if (JsonRepair.isValidFollowUp ? false : true) { // We can just mock this logic or copy it
        }
        
        let nextPos = qIndex + 1;
        while (nextPos < text.length && /\\s/.test(text[nextPos])) nextPos++;
        if (nextPos < text.length && text[nextPos] === ':') {
          closingQuoteIndex = qIndex;
          nextNonWsChosen = ':';
          break;
        }
      }
      if (closingQuoteIndex === -1 && candidateIndices.length > 0) {
        closingQuoteIndex = candidateIndices[0];
      }
    } else {
      for (let idx=0; idx < candidateIndices.length; idx++) {
        let qIndex = candidateIndices[idx];
        let nextNonWs = '';
        let nextPos = qIndex + 1;
        while (nextPos < text.length) {
          if (!/\\s/.test(text[nextPos])) { nextNonWs = text[nextPos]; break; }
          nextPos++;
        }
        if (nextNonWs === '' || nextNonWs === ',' || nextNonWs === '}' || nextNonWs === ']') {
          closingQuoteIndex = qIndex;
          nextNonWsChosen = nextNonWs;
          break;
        }
      }
    }
    
    console.log('Quote starting at', i, 'expectKey=', expectKey);
    console.log('Chosen closingQuoteIndex:', closingQuoteIndex, 'nextNonWs:', nextNonWsChosen);
    
    if (closingQuoteIndex !== -1) {
      i = closingQuoteIndex + 1;
    } else {
      i++;
    }
    continue;
  }
  
  i++;
}
