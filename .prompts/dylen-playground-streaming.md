# Task: Stream LLM output live into the mdv/jsv iframe on the Dylen agent-playground page

## Repo & file

Repo: `/Users/nd/dev/andesec/dylen` (SvelteKit, **Svelte 5 runes** — `$state`, `$effect`).
The ONLY file you should need to change:
`src/routes/(admin)/a/agent-playground/+page.svelte` (~2955 lines).

Do not modify the `text-tools` repo. The iframe loads the **published** build at
`https://andesec.github.io/text-tools/`, which already supports the protocol below.

## Background — what exists today

The playground runs an agent and streams its output over SSE. The response can be
displayed in an embedded text-tool iframe (`mdv.html` for markdown, `jsv.html` for
structured/JSON output).

Today the iframe is fed the **entire accumulated document once, after the run
finishes**. During the run the iframe isn't even mounted. Relevant current code:

- `let responseContent = $state("");` — line ~112. The full accumulated output.
- `let running = $state(false);` — line ~110.
- `let isStructured = $state(false);` — line ~57. True => jsv.html, false => mdv.html.
- `let responseTextMode = $state("texttools");` — line ~225. `"texttools"` or `"plain"`.
- `let responseIframe = $state(null);` — line ~208, `bind:this` on the iframe.

`pushContentToIframe()` (line ~231):
```js
function pushContentToIframe() {
    if (!responseIframe?.contentWindow || !responseContent) return;
    const filename = isStructured ? "response.json" : "response.md";
    responseIframe.contentWindow.postMessage({ type: "loadContent", text: responseContent, filename }, "*");
}
```

Fired by an `$effect` (line ~237) that deliberately waits for the run to finish:
```js
// Push content to iframe only when output is fully loaded and texttools mode is active.
$effect(() => {
    if (!running && responseTextMode === "texttools" && responseContent && responseIframe) {
        pushContentToIframe();
    }
});
```
…and by `onload={pushContentToIframe}` on the iframe element.

The SSE deltas arrive here (line ~727, inside `api.streams.open(...)`):
```js
output_delta: (payload) => {
    responseContent += String(payload?.text || "");
},
```
with sibling handlers `thought_delta`, `complete`, `error`, `onDisconnect`, `onError`.
`complete` calls `applyPlaygroundResult(payload?.result || {})`, which **reassigns
`responseContent` wholesale** (line ~850) to the server's canonical final content.

The iframe markup (line ~1568) — note it is inside `{:else if responseContent}`, so
**the iframe does not exist until the first content arrives**:
```svelte
{:else if responseContent}
    {#if responseTextMode === "texttools"}
        <iframe
            allow="clipboard-write; clipboard-read"
            bind:this={responseIframe}
            src={isStructured ? "https://andesec.github.io/text-tools/jsv.html" : "https://andesec.github.io/text-tools/mdv.html"}
            title="Response viewer"
            class="pg-response-iframe"
            onload={pushContentToIframe}
        ></iframe>
```

There is also a **polling fallback** (`startPolling()`, line ~823) used when SSE
disconnects or the backend reports `stream_only`. That path is NOT streaming and must
keep using the existing whole-document `loadContent` behavior.

## The text-tools streaming protocol (already live, do not implement it)

Host → iframe, all via `postMessage(msg, "*")`:

- `{ type: "appendContent", text, filename? }` — appends `text` at the end of the
  document. Cheap: no re-render, no re-parse, no localStorage write per chunk. Send as
  many as you like, as fast as you like. Not acknowledged.
- `{ type: "streamEnd", filename? }` — finalizes. `mdv.html` switches to rendered view
  and performs one full render; `jsv.html` strips markdown code fences, normalizes, and
  builds the JSON tree once. Replies `{ type:"streamEndAck", filename, format, version, length }`.
- `{ type: "setViewMode", mode: "code" | "render" }` — flips view any time.
- `{ type: "loadContent", text, filename }` — unchanged; replaces the whole document and
  **resets streaming state**. This is the abort/reset primitive.

Guarantees and constraints you can rely on:
- `postMessage` is ordered per window pair — chunks cannot arrive out of order. No
  sequence numbers needed, and do not await between chunks.
- Chunks may split mid-token; nothing is parsed until `streamEnd`, so that is harmless.
- `appendContent` only ever appends. There is no retract. To replace, use `loadContent`.
- If `streamEnd` never arrives, the iframe is left un-rendered and unsaved.
- Messages posted to an iframe that has not finished loading are **silently lost**.

Full docs: `https://andesec.github.io/text-tools/embed.html#streaming`

## What to implement

Stream `output_delta` text into the iframe live, instead of waiting for the run to end.

### Required behavior

1. **Only stream in the SSE path**, only when `responseTextMode === "texttools"`, and
   only when the iframe exists and has loaded. All other paths (sync `runSync`, polling
   fallback, mode switches, re-mounts) keep today's whole-document `loadContent`.

2. **Handle the iframe-not-ready problem.** The iframe is created only once
   `responseContent` is non-empty, and then needs to load before it can receive
   messages. Deltas that arrive before it is ready must not be dropped. Track readiness
   (the existing `onload` handler is the natural signal) and track how much of
   `responseContent` has already been sent to the iframe — call it a "sent offset". On
   the load event, send everything accumulated so far via a single `loadContent` (or one
   `appendContent`), set the offset, and stream only the remainder thereafter.

3. **Send only new text.** On each `output_delta`, append `responseContent.slice(offset)`
   and advance the offset. Never re-send the whole document mid-stream. Prefer deriving
   the delta from the offset rather than trusting `payload.text`, so the iframe can never
   drift out of sync with `responseContent`.

4. **Finalize correctly on `complete`.** `applyPlaygroundResult` replaces
   `responseContent` with the server's canonical version, which may differ from the
   concatenated deltas (whitespace, structured-output reformatting). Therefore on
   completion: if the final `responseContent` differs from what you have streamed, send a
   plain `loadContent` with the final text (this resets streaming state — correct here);
   otherwise send `streamEnd`. Either way the iframe must end up rendered, and the offset
   must be reset for the next run.

5. **Finalize on every terminal path.** `error`, `onDisconnect`, `onError`, and user
   cancel (`cancelSync`, line ~779) must all leave the iframe in a rendered, consistent
   state — do not leave it stranded mid-stream. `onDisconnect`/`onError` hand off to
   `startPolling()`, which will later push a full `loadContent`; make sure the streaming
   offset is reset so that push is treated as a fresh load.

6. **Reset per run.** `handleRunSync`/the run starter sets `responseContent = ""` at
   line ~690. Reset your streaming state there too, so a second run does not append onto
   the first.

7. **Respect the mode toggle.** If the user switches `responseTextMode` to `"plain"`
   mid-stream and back to `"texttools"`, the iframe re-mounts empty. Recover correctly —
   the existing `onload` + offset logic should cover this if you implement (2) properly.

8. **Do not break `isStructured` / jsv.** Streaming partial JSON is expected and fine;
   jsv defers all parsing to `streamEnd`. Keep the `filename` correct
   (`response.json` vs `response.md`) on every message that carries one.

### Guardrails

- Keep the existing `$effect` working for all non-streaming cases. Do not delete
  `pushContentToIframe()`; extend around it.
- Do not introduce new dependencies, stores, or components. Small module-level `$state`
  plus a couple of helper functions in the same file is the right size.
- Match the file's existing style: tabs, double quotes, JSDoc type comments on
  `$state` where the file already does that.
- Svelte 5 runes only — no `$:` reactive statements, no `onMount` unless already used.
- Do not touch the media/thoughts/usage panes, the Exa panel, or any unrelated state.

## Verification (do this, do not skip)

1. `npm run check` (or the repo's svelte-check script — look in `package.json`) must pass
   with no new errors. Run the project's lint script if one exists.
2. Read back your own diff and confirm: no path can send `appendContent` to an iframe
   that hasn't loaded; the offset is reset in every terminal handler and at run start;
   the polling and sync paths are untouched in behavior.
3. Trace, in writing, these four scenarios against your code and state the outcome of each:
   (a) normal SSE run start→finish; (b) SSE run where `complete` returns content that
   differs from the streamed deltas; (c) SSE disconnect mid-run falling back to polling;
   (d) user toggles plain→texttools mid-stream.
4. If you can run the dev server, do a real run and confirm text appears progressively in
   the iframe and renders at the end. If you cannot (no backend/credentials), say so
   explicitly rather than claiming it works.

## Report back

- The diff, with line ranges and a short rationale per hunk.
- The four scenario traces from step 3.
- Verification output (`npm run check` etc.), quoted.
- Anything you could not verify, stated plainly.
