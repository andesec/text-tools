/**
 * json-repair.js — Robust JSON repair, cleaning, tokenizing and offset mapping.
 *
 * Exposes window.JsonRepair with:
 *   escapeLiteralNewlinesInStrings(text)
 *   cleanLiteralNewlinesIfJson(text, filename)
 *   safeJsonParse(text)
 *   robustCleanJson(text)
 *   performSophisticatedClean(text)
 *   tokenize(text)
 *   buildOffsetMap(text)
 *
 * Depends on: vendor/jsonrepair.min.js (optional, used when available)
 */
(function () {
	'use strict';

	// ── Helpers ────────────────────────────────────────────────────────

	/**
	 * Escape literal control characters (newlines, tabs, carriage returns)
	 * that appear inside JSON string literals.
	 */
	function escapeLiteralNewlinesInStrings(text) {
		let result = '';
		let inString = false;
		let i = 0;
		while (i < text.length) {
			const ch = text[i];
			if (inString) {
				if (ch === '\\') {
					result += ch;
					i++;
					if (i < text.length) { result += text[i]; i++; }
				} else if (ch === '"') {
					result += ch; i++; inString = false;
				} else if (ch === '\n') {
					result += '\\n'; i++;
				} else if (ch === '\r') {
					result += '\\r'; i++;
				} else if (ch === '\t') {
					result += '\\t'; i++;
				} else if (ch < '\x20') {
					result += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'); i++;
				} else {
					result += ch; i++;
				}
			} else {
				if (ch === '"') { result += ch; i++; inString = true; }
				else { result += ch; i++; }
			}
		}
		return result;
	}

	function cleanLiteralNewlinesIfJson(text, filename) {
		if (!text) return text;
		const isJson = filename?.toLowerCase().endsWith('.json') ||
			(text.trim().startsWith('{') || text.trim().startsWith('['));
		if (isJson) {
			try { JSON.parse(text); return text; }
			catch (e) { return escapeLiteralNewlinesInStrings(text); }
		}
		return text;
	}

	// ── Pre-processing: bracket mismatch fixer ────────────────────────

	/**
	 * Fix mismatched closing brackets by tracking an opening-bracket stack.
	 *
	 * Handles:
	 *  • `)` used instead of `}` or `]`
	 *  • `}` used where `]` should be (or vice-versa)
	 *  • `(` treated as `[` (common typo in hand-typed JSON)
	 *  • Unclosed brackets — appends correct closers at end
	 *
	 * Correctly skips strings (double and single quoted) and comments.
	 */
	function fixMismatchedBrackets(text) {
		let result = '';
		const stack = []; // opening bracket chars: '{' or '['
		let inString = false;
		let stringChar = '';
		const MATCH = { '{': '}', '[': ']' };

		for (let i = 0; i < text.length; i++) {
			const ch = text[i];

			// ── Inside a string literal ──
			if (inString) {
				result += ch;
				if (ch === '\\' && i + 1 < text.length) {
					result += text[++i];
				} else if (ch === stringChar) {
					inString = false;
				}
				continue;
			}

			// ── String openers ──
			if (ch === '"' || ch === "'") {
				inString = true;
				stringChar = ch;
				result += ch;
				continue;
			}

			// ── Line comments ──
			if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
				while (i < text.length && text[i] !== '\n') { result += text[i++]; }
				if (i < text.length) result += text[i]; // \n
				continue;
			}
			// ── Block comments ──
			if (ch === '/' && i + 1 < text.length && text[i + 1] === '*') {
				result += '/*'; i += 2;
				while (i < text.length && !(text[i] === '*' && i + 1 < text.length && text[i + 1] === '/')) {
					result += text[i++];
				}
				if (i < text.length) { result += '*/'; i++; }
				continue;
			}

			// ── Opening brackets ──
			if (ch === '{' || ch === '[') {
				stack.push(ch);
				result += ch;
				continue;
			}
			if (ch === '(') {
				// In JSON context, ( most likely means [ (array)
				stack.push('[');
				result += '[';
				continue;
			}

			// ── Closing brackets ──
			if (ch === '}' || ch === ']' || ch === ')') {
				if (stack.length > 0) {
					const top = stack.pop();
					result += MATCH[top]; // emit correct closer for the opener
				} else {
					result += ch; // orphan closer — pass through
				}
				continue;
			}

			result += ch;
		}

		// Close any unclosed brackets
		while (stack.length > 0) {
			result += MATCH[stack.pop()];
		}

		return result;
	}

	// ── Pre-processing: wrap bare key-value at top level ──────────────

	/**
	 * Wraps text in `{ }` if it looks like a bare key: value pair
	 * without an outer object container.
	 *
	 *   items: [...]   →   { items: [...] }
	 */
	function wrapBareKeyValue(text) {
		const trimmed = text.trim();
		// Must start with an identifier + colon, and NOT already be an object/array
		if (/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*:/.test(trimmed) &&
			!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
			return '{' + trimmed + '}';
		}
		return text;
	}

	function isValidFollowUp(text, qIndex, expectKey, stack) {
		let nextPos = qIndex + 1;
		while (nextPos < text.length && /\s/.test(text[nextPos])) {
			nextPos++;
		}
		if (nextPos >= text.length) return true;

		const sep = text[nextPos];
		if (expectKey) {
			return sep === ':';
		}

		const top = stack[stack.length - 1];
		if (sep === '}') {
			return top === '{';
		}
		if (sep === ']') {
			return top === '[';
		}
		if (sep === ',') {
			let postCommaPos = nextPos + 1;
			while (postCommaPos < text.length && /\s/.test(text[postCommaPos])) {
				postCommaPos++;
			}
			if (postCommaPos >= text.length) return true;

			const nextChar = text[postCommaPos];
			if (top === '{') {
				if (nextChar === '"' || nextChar === "'") {
					let k = postCommaPos + 1;
					while (k < text.length) {
						if (text[k] === nextChar) {
							let bsCount = 0;
							let idx = k - 1;
							while (idx > postCommaPos && text[idx] === '\\') { bsCount++; idx--; }
							if (bsCount % 2 === 0) {
								let colonPos = k + 1;
								while (colonPos < text.length && /\s/.test(text[colonPos])) {
									colonPos++;
								}
								return colonPos < text.length && text[colonPos] === ':';
							}
						}
						k++;
					}
					return false;
				} else if (/[a-zA-Z0-9_$]/.test(nextChar)) {
					let k = postCommaPos + 1;
					while (k < text.length && /[a-zA-Z0-9_$]/.test(text[k])) {
						k++;
					}
					let colonPos = k;
					while (colonPos < text.length && /\s/.test(text[colonPos])) {
						colonPos++;
					}
					return colonPos < text.length && text[colonPos] === ':';
				} else if (nextChar === '}') {
					return true;
				}
				return false;
			} else if (top === '[') {
				if (nextChar === '"' || nextChar === "'" || nextChar === '{' || nextChar === '[' || nextChar === ']' || /[0-9\-+a-zA-Z_$]/.test(nextChar)) {
					return true;
				}
				return false;
			}
		}
		return false;
	}

	// ── robustCleanJson ──────────────────────────────────────────────

	/**
	 * State-machine based JSON cleaner.  Walks the text character by
	 * character, tracking whether we're inside a string and what the
	 * bracket nesting is, so it can:
	 *  • Skip comments (// and block comments)
	 *  • Correctly identify double-quoted string boundaries even when
	 *    the content contains un-escaped quotes (picks the "best"
	 *    closing quote based on what follows it)
	 *  • Escape interior double-quotes inside string values
	 *
	 * This is a PRE-PROCESSOR: its output is fed into jsonrepair.
	 */
	function robustCleanJson(text) {
		let i = 0;
		let result = '';
		const stack = [];
		let expectKey = false;

		while (i < text.length) {
			const ch = text[i];

			if (/\s/.test(ch)) { result += ch; i++; continue; }

			// Line comment
			if (ch === '/' && text[i + 1] === '/') {
				while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
					result += text[i]; i++;
				}
				continue;
			}
			// Block comment
			if (ch === '/' && text[i + 1] === '*') {
				result += '/*'; i += 2;
				while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
					result += text[i]; i++;
				}
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

			// Double-quoted string
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
						if (isValidFollowUp(text, qIndex, true, stack)) {
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

					// Validate candidates from start (to avoid swallowing subsequent fields/structures)
					for (let idx = 0; idx < validCandidates.length; idx++) {
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
						try {
							if (window.JSONRepair) {
								const testDocument = result + '"' + escapedContent + '"' + testRemaining;
								const escapedDoc = typeof escapeLiteralNewlinesInStrings === 'function' 
									? escapeLiteralNewlinesInStrings(testDocument) 
									: testDocument;
								window.JSONRepair.jsonrepair(escapedDoc);
								closingQuoteIndex = qIndex;
								break;
							}
						} catch (e) {
							// continue
						}
					}

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

			// Single-quoted string (handled by converting to double-quoted string safely)
			if (ch === "'") {
				let candidateIndices = [];
				let j = i + 1;
				while (j < text.length) {
					if (text[j] === "'") {
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
						if (isValidFollowUp(text, qIndex, true, stack)) {
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
							} else if (curChar === "'" && j2 > 0 && stringContent[j2 - 1] === '\\') {
								escapedContent = escapedContent.slice(0, -1) + "'";
							} else {
								escapedContent += curChar;
							}
						}
						
						const testRemaining = text.substring(qIndex + 1);
						try {
							if (window.JSONRepair) {
								const testDocument = result + '"' + escapedContent + '"' + testRemaining;
								const escapedDoc = typeof escapeLiteralNewlinesInStrings === 'function' 
									? escapeLiteralNewlinesInStrings(testDocument) 
									: testDocument;
								window.JSONRepair.jsonrepair(escapedDoc);
								closingQuoteIndex = qIndex;
								break;
							}
						} catch (e) {
							// continue
						}
					}

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
						} else if (curChar === "'" && j2 > 0 && stringContent[j2 - 1] === '\\') {
							escapedContent = escapedContent.slice(0, -1) + "'";
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

	// ── performSophisticatedClean ─────────────────────────────────────

	/**
	 * Fallback cleaner applied when robustCleanJson + jsonrepair fails.
	 * Uses regex-based heuristics — more aggressive but covers many
	 * common hand-typed JSON patterns.
	 */
	function performSophisticatedClean(text) {
		let cleaned = text.trim();

		// 0. Wrap bare key: value at top level
		cleaned = wrapBareKeyValue(cleaned);

		// 1. Remove JavaScript-style comments
		cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');

		// 2. Normalize single quotes to double quotes is now handled safely by robustCleanJson state machine.

		// 3. Fix missing quotes on keys:
		// 3a. Key with missing leading quote:  name":  ->  "name":
		cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_$]+)"\s*:/g, '$1"$2":');
		// 3b. Key with missing trailing quote:  "name:  ->  "name":
		cleaned = cleaned.replace(/([{,]\s*)"([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":');
		// 3c. Totally unquoted keys:  name:  ->  "name":
		cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":');
		// 3d. Key is quoted but missing the colon:  "name"  ->  "name":
		cleaned = cleaned.replace(/([{,]\s*)("?[a-zA-Z0-9_$]+"??)\s+([{\["'\d])/g, '$1$2: $3');

		// 4. Python-style booleans & None, and JS undefined → null
		//    (only outside of double-quoted strings — simple heuristic:
		//    these are bare words after : or , or [ so they won't be
		//    inside properly-quoted strings at this point)
		cleaned = cleaned.replace(/:\s*True\b/g, ': true');
		cleaned = cleaned.replace(/:\s*False\b/g, ': false');
		cleaned = cleaned.replace(/:\s*None\b/g, ': null');
		cleaned = cleaned.replace(/:\s*undefined\b/g, ': null');
		// Also in array positions
		cleaned = cleaned.replace(/([,\[]\s*)True\b/g, '$1true');
		cleaned = cleaned.replace(/([,\[]\s*)False\b/g, '$1false');
		cleaned = cleaned.replace(/([,\[]\s*)None\b/g, '$1null');
		cleaned = cleaned.replace(/([,\[]\s*)undefined\b/g, '$1null');

		// 5. Handle escaped quotes that might be broken
		cleaned = cleaned.replace(/\\'/g, "'");

		// 6. Remove trailing commas before } or ]
		cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

		// 7. Add missing commas between adjacent values/objects
		//    e.g.  } {  or  } "  or  ] {  etc.
		cleaned = cleaned.replace(/(\})\s*(\{)/g, '$1, $2');
		cleaned = cleaned.replace(/(\})\s*(")/g, '$1, $2');
		cleaned = cleaned.replace(/(\])\s*(\[)/g, '$1, $2');
		cleaned = cleaned.replace(/(true|false|null|\d+)\s+(")/g, '$1, $2');

		// 8. Handle literal newlines in strings
		cleaned = escapeLiteralNewlinesInStrings(cleaned);

		return cleaned;
	}

	// ── fixMissingBracketOpeners ──────────────────────────────────────

	/**
	 * Detect orphan `]` closers that have no matching `[` opener and
	 * insert the missing `[` at the correct position.
	 *
	 * Handles patterns like:
	 *   "sections": { ... } ]      →  "sections": [{ ... }]
	 *   "items": {"a":1}, {"b":2}] →  "items": [{"a":1}, {"b":2}]
	 *
	 * Algorithm:
	 *  1. Scan text to collect all bracket positions (outside strings/comments)
	 *  2. Walk them with a stack; when `]` doesn't match `[`, it's orphaned
	 *  3. For each orphan `]`, scan backward to find the `{` at nesting
	 *     level 0 whose position follows a `:` — that's where `[` goes
	 */
	function fixMissingBracketOpeners(text) {
		// Phase 1: collect bracket positions (outside strings and comments)
		const brackets = [];
		let inStr = false, strCh = '';
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (inStr) {
				if (ch === '\\' && i + 1 < text.length) { i++; continue; }
				if (ch === strCh) inStr = false;
				continue;
			}
			if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
			if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
				while (i < text.length && text[i] !== '\n') i++;
				continue;
			}
			if (ch === '/' && i + 1 < text.length && text[i + 1] === '*') {
				i += 2;
				while (i < text.length && !(text[i] === '*' && i + 1 < text.length && text[i + 1] === '/')) i++;
				if (i < text.length) i++;
				continue;
			}
			if (ch === '{' || ch === '[' || ch === '}' || ch === ']' || ch === '(' || ch === ')') {
				brackets.push({ ch, pos: i });
			}
		}

		// Phase 2: walk brackets with a stack, find orphan ] closers
		const openStack = [];
		const poppedOpeners = [];
		const insertions = []; // text positions where '[' should be inserted

		for (let bi = 0; bi < brackets.length; bi++) {
			const { ch, pos } = brackets[bi];

			if (ch === '{' || ch === '[' || ch === '(') {
				openStack.push({ ch: ch === '(' ? '[' : ch, pos, bi });
				continue;
			}

			// Closer: }, ], )
			const expected = ch === ')' ? ']' : ch;

			if (openStack.length === 0) continue; // orphan closer, ignore

			const top = openStack[openStack.length - 1];
			const topCloser = top.ch === '{' ? '}' : ']';

			if (topCloser === expected) {
				// Perfect match
				poppedOpeners.push(openStack.pop());
			} else if (expected === ']' && top.ch === '{') {
				// `]` but stack top is `{` — a `[` was missing.
				// Scan backward from this `]` to find the outermost opener
				// at nesting level 0 (relative to this scope) that sits right after a `:`.
				// Since some sibling elements may have already been matched and popped,
				// we check both active stack openers and popped sibling openers.
				let bestInsertPos = -1;

				// 1. Check popped sibling openers that lie within this nesting context (after top.pos)
				const siblings = poppedOpeners
					.filter(po => po.pos > top.pos && po.pos < pos)
					.sort((a, b) => a.pos - b.pos);

				if (siblings.length > 0) {
					const firstSibling = siblings[0];
					let lb = firstSibling.pos - 1;
					while (lb >= 0 && /\s/.test(text[lb])) lb--;
					if (lb >= 0 && text[lb] === ':') {
						bestInsertPos = firstSibling.pos;
					}
				}

				// 2. Fallback to normal backward scan on currently active stack elements
				if (bestInsertPos === -1) {
					let nesting = 0;
					for (let j = bi - 1; j >= 0; j--) {
						const c = brackets[j];
						if (c.pos < top.pos) break; // don't go past the stack top opener

						if (c.ch === '}' || c.ch === ']') {
							nesting++;
						} else { // opener
							if (nesting > 0) {
								nesting--;
							} else {
								// At our nesting level — is this a `{` after a `:`?
								if (c.ch === '{') {
									let lb = c.pos - 1;
									while (lb >= 0 && /\s/.test(text[lb])) lb--;
									if (lb >= 0 && text[lb] === ':') {
										bestInsertPos = c.pos;
									}
								}
							}
						}
					}
				}

				if (bestInsertPos !== -1) {
					insertions.push(bestInsertPos);
					// Don't pop the stack — the ] now matches the inserted [
				} else {
					// Can't figure out where to insert [, just pop & convert
					openStack.pop();
				}
			} else if (expected === '}' && top.ch === '[') {
				// `}` but stack top is `[` — treat as `]`
				openStack.pop();
			} else {
				// Some other mismatch, pop anyway (best effort)
				openStack.pop();
			}
		}

		if (insertions.length === 0) return text;

		// Phase 3: apply insertions in reverse order (so positions stay valid)
		insertions.sort((a, b) => b - a);
		let result = text;
		for (const pos of insertions) {
			result = result.substring(0, pos) + '[' + result.substring(pos);
		}
		return result;
	}

	// ── safeJsonParse ────────────────────────────────────────────────

	/**
	 * Parse JSON, applying progressively more aggressive repair if
	 * standard JSON.parse fails.
	 *
	 * Pipeline:
	 *  1. JSON.parse(text)
	 *  2. wrapBareKeyValue → fixMismatchedBrackets → robustCleanJson
	 *     → jsonrepair → JSON.parse
	 *  3. wrapBareKeyValue → performSophisticatedClean →
	 *     fixMissingBracketOpeners → fixMismatchedBrackets → JSON.parse
	 */
	function safeJsonParse(text) {
		try {
			return JSON.parse(text);
		} catch (e) {
			// Try a simple escape of literal newlines first, since it's extremely common and safe if the JSON is otherwise valid.
			try {
				return JSON.parse(escapeLiteralNewlinesInStrings(text));
			} catch (ee) {
				// Proceed with full repair pipeline if that fails
			}
			// Pass 2: pre-process + jsonrepair
			try {
				let preprocessed = wrapBareKeyValue(text);
				preprocessed = fixMismatchedBrackets(preprocessed);
				let cleaned = robustCleanJson(preprocessed);
				cleaned = escapeLiteralNewlinesInStrings(cleaned);
				const repaired = window.JSONRepair
					? window.JSONRepair.jsonrepair(cleaned)
					: cleaned;
				return JSON.parse(repaired);
			} catch (e2) {
				// Pass 3: sophisticated regex clean + bracket opener fix
				try {
					let preprocessed = wrapBareKeyValue(text);
					let cleaned = performSophisticatedClean(preprocessed);
					cleaned = fixMissingBracketOpeners(cleaned);
					cleaned = fixMismatchedBrackets(cleaned);
					return JSON.parse(cleaned);
				} catch (e3) {
					throw e3;
				}
			}
		}
	}

	// ── Tokenizer ────────────────────────────────────────────────────

	function tokenize(text) {
		const tokens = [];
		let i = 0;
		while (i < text.length) {
			// Skip whitespace
			if (/\s/.test(text[i])) { i++; continue; }

			// Skip single-line comments
			if (text[i] === '/' && text[i + 1] === '/') {
				i += 2;
				while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
				continue;
			}
			// Skip multi-line comments
			if (text[i] === '/' && text[i + 1] === '*') {
				i += 2;
				while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
				if (i < text.length) i += 2;
				continue;
			}

			// Single character tokens
			if ('{}[]:,'.includes(text[i])) {
				tokens.push({ type: text[i], value: text[i], start: i, end: i + 1 });
				i++; continue;
			}

			// Double-quoted string
			if (text[i] === '"') {
				const start = i; i++;
				while (i < text.length && text[i] !== '"') {
					if (text[i] === '\\') i += 2; else i++;
				}
				if (i < text.length) i++;
				tokens.push({ type: 'string', value: text.slice(start, i), start, end: i });
				continue;
			}

			// Single-quoted string
			if (text[i] === "'") {
				const start = i; i++;
				while (i < text.length && text[i] !== "'") {
					if (text[i] === '\\') i += 2; else i++;
				}
				if (i < text.length) i++;
				tokens.push({ type: 'string', value: text.slice(start, i), start, end: i });
				continue;
			}

			// Identifier / Word / Number
			if (/[a-zA-Z0-9_\-\.+]/.test(text[i])) {
				const start = i;
				while (i < text.length && /[a-zA-Z0-9_\-\.+]/.test(text[i])) i++;
				tokens.push({ type: 'word', value: text.slice(start, i), start, end: i });
				continue;
			}

			// Catch-all
			i++;
		}
		return tokens;
	}

	// ── Offset map builder ───────────────────────────────────────────

	function buildOffsetMap(text) {
		const map = new Map();
		const tokens = tokenize(text);
		let tokenIndex = 0;

		function peek() { return tokens[tokenIndex] || null; }
		function consume() { return tokens[tokenIndex++]; }

		const path = [];

		function parseValue() {
			const tok = peek();
			if (!tok) return;

			map.set(JSON.stringify(path), tok.start);

			if (tok.type === '{') {
				consume();
				let first = true;
				while (true) {
					const nextTok = peek();
					if (!nextTok || nextTok.type === '}') break;
					if (!first) { if (nextTok.type === ',') consume(); }
					first = false;
					const keyTok = peek();
					if (!keyTok || keyTok.type === '}') break;

					let key = '';
					if (keyTok.type === 'string') {
						const rawStr = consume().value;
						try {
							key = JSON.parse(rawStr.startsWith("'")
								? `"${rawStr.slice(1, -1).replace(/"/g, '\\"')}"` : rawStr);
						} catch (e) { key = rawStr.slice(1, -1); }
					} else if (keyTok.type === 'word') {
						key = consume().value;
					} else {
						consume(); continue;
					}

					const colonTok = peek();
					if (colonTok && colonTok.type === ':') consume();

					path.push(key);
					parseValue();
					path.pop();
				}
				if (peek() && peek().type === '}') consume();
			} else if (tok.type === '[') {
				consume();
				let index = 0;
				let first = true;
				while (true) {
					const nextTok = peek();
					if (!nextTok || nextTok.type === ']') break;
					if (!first) { if (nextTok.type === ',') consume(); }
					first = false;
					const elementTok = peek();
					if (!elementTok || elementTok.type === ']') break;
					path.push(index);
					parseValue();
					path.pop();
					index++;
				}
				if (peek() && peek().type === ']') consume();
			} else {
				consume();
			}
		}

		parseValue();
		return map;
	}

	// ── Public API ───────────────────────────────────────────────────

	window.JsonRepair = {
		escapeLiteralNewlinesInStrings,
		cleanLiteralNewlinesIfJson,
		fixMismatchedBrackets,
		fixMissingBracketOpeners,
		wrapBareKeyValue,
		safeJsonParse,
		robustCleanJson,
		performSophisticatedClean,
		tokenize,
		buildOffsetMap
	};
})();
