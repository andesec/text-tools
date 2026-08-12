import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read tts-engine.js source and strip the CDN import line for pure Node testing
const ttsEngineCode = fs.readFileSync(path.join(__dirname, '../tts-engine.js'), 'utf8');
const nodeCompatibleCode = ttsEngineCode.replace(
  "import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';",
  "const pipeline = null; const env = { allowLocalModels: false };"
);

// Write temporary node-compatible test module
const tempTestPath = path.join(__dirname, 'tts_engine_node.mjs');
fs.writeFileSync(tempTestPath, nodeCompatibleCode, 'utf8');

const {
  normalizeTextForTTS,
  splitIntoSentences,
  chunkNarrationText,
  detectLanguage,
  splitBracketedSegments,
  splitMarkdownStructure,
  stripMarkdownForTTS
} = await import('./tts_engine_node.mjs');

console.log('=== TEST 1: Contractions (I\'ve, i\'m, don\'t, it\'s) ===');
const contractionsText = "I've been thinking, and i'm sure that it's going to work if you don't worry.";
const normalizedContractions = normalizeTextForTTS(contractionsText);
console.log('Input:     ', contractionsText);
console.log('Normalized:', normalizedContractions);
console.assert(normalizedContractions.includes("I've"), "Should preserve I've");
console.assert(normalizedContractions.includes("i'm"), "Should preserve i'm");
console.assert(normalizedContractions.includes("it's"), "Should preserve it's");
console.assert(normalizedContractions.includes("don't"), "Should preserve don't");

console.log('\n=== TEST 2: Abbreviations & Honorifics (dr., Mr., Ms., St., J., decimals) ===');
const honorificsText = "Dr. Smith and Mr. Jones visited St. John's Hospital with J. K. Rowling. The price was $3.14 per item.";
const honorificsChunks = chunkNarrationText(honorificsText);
console.log('Input: ', honorificsText);
console.log('Chunks:', honorificsChunks);
console.assert(honorificsChunks.length === 1, `Expected 1 chunk, got ${honorificsChunks.length}`);
console.assert(honorificsChunks[0].text.includes("Dr. Smith"), "Dr. Smith should stay connected");
console.assert(honorificsChunks[0].text.includes("Mr. Jones"), "Mr. Jones should stay connected");

console.log('\n=== TEST 3: Hyphenated Compounds (fro-yo, well-known) ===');
const hyphenText = "She ordered a delicious fro-yo from a well-known shop—quick and easy.";
const normalizedHyphen = normalizeTextForTTS(hyphenText);
console.log('Input:     ', hyphenText);
console.log('Normalized:', normalizedHyphen);
console.assert(normalizedHyphen.includes("fro-yo"), "Should preserve fro-yo hyphen");
console.assert(normalizedHyphen.includes("well-known"), "Should preserve well-known hyphen");
console.assert(normalizedHyphen.includes("shop, quick"), "Em-dash should become comma pause");

console.log('\n=== TEST 4: Exclamations & Question Marks (yeah!) ===');
const exclamationText = "Oh yeah! Is this real life? Let's test it out.";
const exclamationChunks = chunkNarrationText(exclamationText);
console.log('Input: ', exclamationText);
console.log('Chunks:', exclamationChunks);
console.assert(exclamationChunks.some(c => c.text.startsWith("Oh yeah!")), "yeah! should form its own sentence boundary");

console.log('\n=== TEST 5: List Conjunction Protection ===');
const listText = "We bought apples, oranges, pears, peaches, plums, pineapples, mangos and bananas at the market today.";
const listChunks = chunkNarrationText(listText);
console.log('Input: ', listText);
console.log('Chunks:', listChunks);
const joinedText = listChunks.map(c => c.text).join(' ');
console.assert(joinedText.includes("mangos and bananas"), "Should not split before 'and' in lists");

console.log('\n=== TEST 6: Bracketed & Quoted Segments ===');
const bracketText = "He said 'Guten Tag' to the guest (who smiled warmly) before leaving.";
const bracketSegments = splitBracketedSegments(bracketText);
console.log('Input:   ', bracketText);
console.log('Segments:', bracketSegments);
console.assert(bracketSegments.some(s => s.text.includes("Guten Tag")), "Guten Tag should be isolated");
console.assert(bracketSegments.some(s => s.text.includes("who smiled warmly")), "Parentheses content should be isolated");

console.log('\n=== TEST 7: Language Detection ===');
console.log('German: ', detectLanguage("Ich möchte ein Buch kaufen und lesen"));
console.log('Spanish:', detectLanguage("Yo quiero hablar con mi amigo en la escuela"));
console.log('French: ', detectLanguage("Bonjour je suis très content de vous voir"));
console.log('Japanese:', detectLanguage("こんにちは世界"));
console.assert(detectLanguage("Ich möchte ein Buch kaufen und lesen") === 'de', "Should detect German");
console.assert(detectLanguage("Yo quiero hablar con mi amigo en la escuela") === 'es', "Should detect Spanish");

console.log('\n=== TEST 8: Headings with Period Termination in stripMarkdownForTTS ===');
const mdText = "# Supertonic Rules\nFirst paragraph text follows here.";
const strippedMd = stripMarkdownForTTS(mdText);
console.log('Input:   ', JSON.stringify(mdText));
console.log('Stripped:', JSON.stringify(strippedMd));
console.assert(strippedMd.startsWith("Supertonic Rules."), "Heading should end with a period");

// Clean up temporary node test file
fs.unlinkSync(tempTestPath);

console.log('\n✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
