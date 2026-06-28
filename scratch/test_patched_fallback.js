const fs = require('fs');
const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;
const jsonrepair = require('../vendor/jsonrepair.min.js');

let preprocessed = JsonRepair.wrapBareKeyValue(jsonText);
preprocessed = JsonRepair.fixMismatchedBrackets(preprocessed);

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

        // FALLBACK TO LAST VALID CANDIDATE!
        if (closingQuoteIndex === -1 && validCandidates.length > 0) {
          closingQuoteIndex = validCandidates[validCandidates.length - 1];
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
  const cleaned = robustCleanJsonPatched(preprocessed);
  const repaired = jsonrepair.jsonrepair(cleaned);
  const parsed = JSON.parse(repaired);
  console.log("SUCCESS WITH TRUNCATED + LAST FALLBACK!", Object.keys(parsed));
} catch (e) {
  console.log("FAILED WITH TRUNCATED + LAST FALLBACK:", e.message);
}
