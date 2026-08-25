// Test for the JSON→MD transformer — reads jsv.html, extracts the
// transformer block, evaluates it, and prints the output for both
// example JSONs.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'jsv.html'), 'utf8');

// Stub the window object for browser-style script execution
global.window = {};
// Load the script
require('./json-to-markdown.js');
// Grab the exposed API
const j2mdToMarkdown = window.J2MD.toMarkdown;

const j1 = {
  sections: [
    {
      title: 'Cloud Shared Responsibility Demystified',
      teaching_intent: 'Introduce the shared responsibility model for AWS and GCP by contrasting what the cloud provider secures versus what the customer must secure, using a real SaaS deployment scenario to prevent the common mistake of assuming the cloud handles all security.',
      objectives: {
        knowledge: 'Recall the division of security responsibilities between AWS/GCP and the customer across IaaS, PaaS, and SaaS layers.',
        reasoning: 'Classify specific security tasks (patching OS, encrypting data at rest, managing IAM) into provider-owned versus customer-owned responsibilities.',
        understanding: 'Explain why misinterpreting the shared responsibility boundary leads to real production breaches in SaaS environments.'
      },
      revision: [],
      prerequisites: ['Basic understanding of cloud computing concepts (IaaS, PaaS, SaaS)', 'Familiarity with general application security principles'],
      pacing_notes: 'Take time here \u2014 this foundation shapes every later section. Use concrete AWS and GCP service examples. Include at least 3 classification exercises and a case study. Move at a moderate pace with heavy scaffolding.',
      goals: 'By the end, the learner can correctly identify which party owns any given security control in a cloud deployment and articulate why boundary confusion causes real incidents.',
      planned_widgets: ['markdown', 'flowDiagram', 'table', 'compare', 'swipecards', 'caselet', 'mcqs', 'checklist'],
      content_enrichment: [
        'Include a real-world breach case (e.g., Capital One misconfiguration) that traces back to shared responsibility misunderstanding.',
        'Map AWS and GCP side-by-side on shared responsibility terminology differences.',
        'Reference the 2024-2025 Security Innovation research for context on how AI-enhanced security tools shift the boundary.'
      ]
    }
  ]
};

const j2 = {
  section_index: 1,
  title: 'Exam Architecture and Case Autopilot',
  items: [
    { markdown: { study_duration: 3, title: 'Goethe B2 Architecture', markdown: 'The Goethe-Zertifikat B2 exam demands procedural fluency across Reading (65 mins), Writing (75 mins), and Speaking (15 mins). At this level, you must integrate your understanding of German syntax in real-time. In Writing and Speaking, your score is highly dependent on managing complex grammar without pausing your train of thought.\n\nEnglish speakers frequently lose points by collapsing oblique cases to a vague \'-en\' ending without conscious thought. To eliminate this, you must adopt a strict, four-step analytical framework for every noun phrase.', align: 'left', karut: ['k', 'u'], keywords: ['goethe-b2-modules', 'exam-architecture'] } },
    { table: { study_duration: 2, title: 'Scoring Rubric vs KARUT', rows: [['Goethe B2 Criterion', 'Focus Area', 'KARUT Pillar'], ['Aufgabenerf\u00fcllung', 'Task fulfillment and clear arguments', 'Application (a)'], ['Koh\u00e4renz', 'Logical linking of parts', 'Synthesis (t)'], ['Wortschatz', 'Vocabulary mastery and register', 'Knowledge (k)'], ['Strukturen', 'Grammar morphology and syntax accuracy', 'Understanding (u)']], karut: ['u'], keywords: ['scoring-rubric', 'karut-pillars'] } },
    { stepFlow: { study_duration: 3, title: 'The 4-Step Case Autopilot', flow: ['Identify the article type: is there a der-word, an ein-word, or no article?', 'Determine the case: Nominative, Accusative, Dative, or Genitive (driven by verb or preposition).', 'Identify the noun\'s gender: masculine, feminine, neuter, or plural.', 'Apply the appropriate adjective ending based solely on the first three steps.'], karut: ['k', 'u'], keywords: ['case-autopilot', 'adjective-declinations'] } }
  ]
};

console.log('═══ TEST 1: Cloud Shared Responsibility ═══');
console.log(j2mdToMarkdown(j1));
console.log();
console.log('═══ TEST 2: Exam Architecture and Case Autopilot ═══');
console.log(j2mdToMarkdown(j2));
console.log();

// Additional general cases
console.log('═══ TEST 3: Simple flat object ═══');
console.log(j2mdToMarkdown({
  name: 'Dylen Text Tools',
  version: '1.0.0',
  description: 'A collection of small text utilities',
  active: true,
  tags: ['json', 'markdown', 'diff']
}));
console.log();
console.log('═══ TEST 4: Nested object with array of objects ═══');
console.log(j2mdToMarkdown({
  team: 'Platform Security',
  members: [
    { name: 'Alice', role: 'Engineer', skills: ['IAM', 'KMS'] },
    { name: 'Bob', role: 'Architect', skills: ['VPC', 'WAF'] }
  ],
  metadata: {
    quarter: 'Q1 2025',
    last_review: '2025-01-15'
  }
}));
console.log();
console.log('═══ TEST 5: Array of primitives at top level ═══');
console.log(j2mdToMarkdown([1, 2, 3, 'four', 'five']));
console.log();
console.log('═══ TEST 6: Table-shaped array ═══');
console.log(j2mdToMarkdown({
  data: [
    ['Name', 'Role', 'Tenure'],
    ['Alice', 'Engineer', '3y'],
    ['Bob', 'Architect', '5y']
  ]
}));
console.log();
console.log('═══ TEST 7: Complex widget with left_items/right_items ═══');
console.log(j2mdToMarkdown({
  items: [
    { connections: {
      study_duration: 4,
      title: 'Match Prepositions to Cases',
      prompt: 'Match each grammatical trigger to the case it forces in Step 2.',
      left_items: [
        { id: 'l1', match: 'r1', label: 'mit, aus, bei, nach', karut: ['k'] },
        { id: 'l2', match: 'r2', label: 'trotz, wegen, w\u00e4hrend', karut: ['k'] },
        { id: 'l3', match: 'r3', label: 'Subject of the sentence', karut: ['k'] }
      ],
      right_items: [
        { id: 'r1', label: 'Dative' },
        { id: 'r2', label: 'Genitive' },
        { id: 'r3', label: 'Nominative' },
        { id: 'r4', label: 'Accusative' }
      ]
    } }
  ]
}));
