const fs = require('fs');
const path = require('path');

const logDir = '/Users/nd/.gemini/antigravity-ide/brain/4dd9279e-d548-4607-9baa-e3ad9f2d68c7/.system_generated/logs';
if (fs.existsSync(logDir)) {
  const files = fs.readdirSync(logDir);
  console.log('Files in logs:', files);
  if (files.includes('transcript.jsonl')) {
    const lines = fs.readFileSync(path.join(logDir, 'transcript.jsonl'), 'utf8').split('\n');
    console.log('Number of steps in transcript:', lines.length);
    // Let's find the last USER_INPUT step
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      const step = JSON.parse(lines[i]);
      if (step.type === 'USER_INPUT') {
        console.log('Found USER_INPUT step!');
        const userContent = step.content;
        console.log('Content length:', userContent.length);
        
        // Find the JSON block starting with { "prompt":
        const jsonStart = userContent.indexOf('{\n  "prompt":');
        if (jsonStart !== -1) {
          const jsonText = userContent.substring(jsonStart);
          console.log('Found JSON block. Extracting length:', jsonText.length);
          fs.writeFileSync('scratch/extracted_user_json.txt', jsonText);
        } else {
          console.log('JSON block not found by exact string, looking for first {');
          const firstBrace = userContent.indexOf('{');
          if (firstBrace !== -1) {
            fs.writeFileSync('scratch/extracted_user_json.txt', userContent.substring(firstBrace));
          }
        }
        break;
      }
    }
  }
} else {
  console.log('Log directory does not exist');
}
