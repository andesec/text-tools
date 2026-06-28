const fs = require('fs');
const jsonTextRaw = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

// Let's clean the JSON to remove the user's trailing comments and close it properly
// Locate the end of the JSON (the classroom search query)
const endMarker = 'blackboard classroom",';
const markerIndex = jsonTextRaw.indexOf(endMarker);
if (markerIndex === -1) {
  console.log('Marker not found');
  process.exit(1);
}

// Reconstruct a complete JSON: close the "prompt" string, close the outer object
const jsonText = jsonTextRaw.substring(0, markerIndex + endMarker.length - 2) + '"\n}';

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;
const jsonrepair = require('../vendor/jsonrepair.min.js');

function robustCleanJsonPatched(text) {
  let i = 0;
  let result = '';
  const stack = [];
  let expectKey = false;

  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { result += ch; i++; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') { result += text[i]; i++; }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      result += '/*'; i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { result += text[i]; i++; }
      if (i < text.length) { result += '*/'; i += 2; }
      continue;
    }

    if (ch === '{') { stack.push('{'); expectKey = true; result += ch; i++; continue; }
    if (ch === '}') { stack.pop(); expectKey = false; result += ch; i++; continue; }
    if (ch === '[') { stack.push('['); expectKey = false; result += ch; i++; continue; }
    if (ch === ']') { stack.pop(); expectKey = false; result += ch; i++; continue; }
    if (ch === ':') { expectKey = false; result += ch; i++; continue; }
    if (ch === ',') {
      const top = stack[stack.length - 1];
      expectKey = top === '{';
      result += ch; i++; continue;
    }

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

      let closingQuoteIndex = -1;
      
      if (expectKey) {
        for (let idx = 0; idx < candidateIndices.length; idx++) {
          const qIndex = candidateIndices[idx];
          if (JsonRepair.isValidFollowUp ? JsonRepair.isValidFollowUp(text, qIndex, true, stack) : true) {
            closingQuoteIndex = qIndex;
            break;
          }
        }
        if (closingQuoteIndex === -1 && candidateIndices.length > 0) {
          closingQuoteIndex = candidateIndices[0];
        }
      } else {
        let validCandidates = [];
        for (let idx = 0; idx < candidateIndices.length; idx++) {
          const qIndex = candidateIndices[idx];
          let passes = false;
          let nextNonWs = '';
          let nextPos = qIndex + 1;
          while (nextPos < text.length) {
            if (!/\s/.test(text[nextPos])) { nextNonWs = text[nextPos]; break; }
            nextPos++;
          }
          if (nextNonWs === '' || nextNonWs === ',' || nextNonWs === '}' || nextNonWs === ']') {
            passes = true;
          }
          if (passes) {
            validCandidates.push(qIndex);
          }
        }

        // Validate candidates from end
        for (let idx = validCandidates.length - 1; idx >= 0; idx--) {
          const qIndex = validCandidates[idx];
          const stringContent = text.slice(i + 1, qIndex);
          let escapedContent = '';
          for (let j2 = 0; j2 < stringContent.length; j2++) {
            const curChar = stringContent[j2];
            if (curChar === '"') {
              let bc = 0; let k2 = j2 - 1;
              while (k2 >= 0 && stringContent[k2] === '\\') { bc++; k2--; }
              escapedContent += (bc % 2 === 0) ? '\\"' : '"';
            } else {
              escapedContent += curChar;
            }
          }
          
          const testRemaining = text.substring(qIndex + 1);
          const testDocument = result + '"' + escapedContent + '"' + testRemaining;
          try {
            jsonrepair.jsonrepair(testDocument);
            closingQuoteIndex = qIndex;
            break;
          } catch (e) {
            // continue
          }
        }

        if (closingQuoteIndex === -1 && validCandidates.length > 0) {
          closingQuoteIndex = validCandidates[0];
        }
      }

      if (closingQuoteIndex !== -1) {
        const stringContent = text.slice(i + 1, closingQuoteIndex);
        let escapedContent = '';
        for (let j2 = 0; j2 < stringContent.length; j2++) {
          const curChar = stringContent[j2];
          if (curChar === '"') {
            let bc = 0; let k2 = j2 - 1;
            while (k2 >= 0 && stringContent[k2] === '\\') { bc++; k2--; }
            escapedContent += (bc % 2 === 0) ? '\\"' : '"';
          } else {
            escapedContent += curChar;
          }
        }
        result += '"' + escapedContent + '"';
        i = closingQuoteIndex + 1;
      } else {
        result += ch; i++;
      }
      continue;
    }
    result += ch; i++;
  }
  return result;
}

try {
  let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
  preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);
  const cleaned = robustCleanJsonPatched(preprocessed);
  const repaired = jsonrepair.jsonrepair(cleaned);
  const parsed = JSON.parse(repaired);
  console.log("SUCCESS!", Object.keys(parsed));
  console.log("Prompt preview end:", parsed.prompt.substring(parsed.prompt.length - 100));
} catch (e) {
  console.log("FAILED:", e.message);
}
