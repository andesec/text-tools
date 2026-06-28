const fs = require('fs');

global.window = {};
require('../json-repair.js');
const JsonRepair = global.window.JsonRepair;
const jsonrepair = require('../vendor/jsonrepair.min.js');
global.window.JSONRepair = jsonrepair;

const text = `{
  "record_id": 21,
  "timestamp_request": "2026-06-28T17:50:41.417993Z",
  "timestamp_response": "2026-06-28T17:55:51.931842Z",
  "started_at": "2026-06-28T17:50:41.417993Z",
  "duration_ms": 310512,
  "agent": "ResearchAgent",
  "provider": "opencode-go",
  "model": "mimo-v2.5-free",
  "lesson_title": null,
  "request_payload": {
    "prompt": "## Instructions\\n\\n# CRITICAL: Educational Learning Context\\nThis content is being organized...\\n\\nRules:\\n1. Hello \\"world\\"\\n\\n2. End of prompt"
  }
}`;

// Introduce a syntax error by putting a literal newline inside a string in request_payload, or making a bracket mismatch, etc.
// Let's make a literal newline in prompt:
const brokenText = `{
  "record_id": 21,
  "timestamp_request": "2026-06-28T17:50:41.417993Z",
  "timestamp_response": "2026-06-28T17:55:51.931842Z",
  "started_at": "2026-06-28T17:50:41.417993Z",
  "duration_ms": 310512,
  "agent": "ResearchAgent",
  "provider": "opencode-go",
  "model": "mimo-v2.5-free",
  "lesson_title": null,
  "request_payload": {
    "prompt": "## Instructions

# CRITICAL: Educational Learning Context
This content is being organized...

Rules:
1. Hello \\"world\\"

2. End of prompt"
  }
}`;

console.log("Original safeJsonParse on brokenText:");
try {
  const result = JsonRepair.safeJsonParse(brokenText);
  console.log("Keys:", Object.keys(result));
  console.log("provider value:", JSON.stringify(result.provider));
  console.log("timestamp_request value length:", result.timestamp_request.length);
} catch (e) {
  console.error("Failed:", e);
}
