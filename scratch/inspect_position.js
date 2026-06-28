const fs = require('fs');

const jsonText = fs.readFileSync('scratch/extracted_user_json.txt', 'utf8');

// The user said: Expected ',' or '}' after property value in JSON at position 695
// Let's inspect position 695 of the raw text

console.log('Total length:', jsonText.length);
if (jsonText.length > 695) {
  console.log('Character at 695:', JSON.stringify(jsonText[695]));
  console.log('Context around 695:', JSON.stringify(jsonText.substring(685, 705)));
  
  // Try to parse using native JSON.parse and see where it fails
  try {
    JSON.parse(jsonText);
    console.log('Native JSON.parse SUCCESS');
  } catch(e) {
    console.log('Native JSON.parse ERROR:', e.message);
  }

  // Try to parse using our json-repair
  global.window = {};
  require('../json-repair.js');
  try {
    const repaired = window.JsonRepair.safeJsonParse(jsonText);
    console.log('JsonRepair SUCCESS');
  } catch(e) {
    console.log('JsonRepair ERROR:', e.message);
  }
}
