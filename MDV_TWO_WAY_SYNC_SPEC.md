# Dylen Text Tools — Two-Way Embedding Sync

**Status:** Implemented in `mdv.html` (shipped in commit `2901f46`).
Not yet implemented in `jsv.html` / `pdf.html`.
**Target tools:** `mdv.html`, `jsv.html`, `pdf.html` (all embeddable tools)
**Author goal:** Allow a host page (parent) to keep its local copy of the
document in sync with the editor's state, in real time, without polling.

This is a generic, tool-agnostic feature. Any host that embeds a Dylen Text Tools
iframe should be able to use it, not just the Dylen Source Capture extension.

---

## 1. Motivation

The current `loadContent` protocol (see `embed.html`) is **write-only from the
parent's perspective**. The parent can push a document into the iframe, but
cannot read the user's edits back. Hosts that need to round-trip the content
(for example, to upload it to a backend) currently have no way to do so
without scraping the iframe DOM, which is fragile, breaks on internal layout
changes, and is blocked by cross-origin policy in many deployments.

This spec adds a small set of outbound messages that make the editor's state
observable to the parent in a structured, version-stamped way.

---

## 2. Non-goals

- **No collaboration / CRDT / OT.** Single editor, single user. This is a
  one-direction-at-a-time sync, not a multi-host merge protocol.
- **No schema migration on existing `loadContent` semantics.** The new
  messages are purely additive.
- **No breaking changes to `loadContent`.** Existing hosts that only send
  content (and never read it back) keep working unchanged.

---

## 3. New message types

All messages are posted with `window.parent.postMessage(payload, "*")` (or
the specific origin if the host can be allowlisted). The `targetOrigin` is
left as `"*"` for compatibility with the existing protocol — hosts that want
to harden this can validate `event.source` and `event.origin` on receive.

### 3.1 iframe → parent: `contentChange`

The most important new message. Sent whenever the editor's content changes
in a way the host should observe.

```json
{
  "type": "contentChange",
  "text": "The full document text, post-edit.",
  "filename": "README.md",
  "format": "markdown",
  "version": 17,
  "selection": { "from": 142, "to": 142 }
}
```

| Field        | Type             | Notes |
|--------------|------------------|-------|
| `type`       | string           | Literal `"contentChange"`. |
| `text`       | string \| ArrayBuffer | Current full document. Use `text` for `mdv` / `jsv`; `ArrayBuffer` is allowed for `pdf` (matches the inbound `loadContent.bytes` shape). |
| `filename`   | string \| null   | Current document filename. May be `null` for an untitled buffer. |
| `format`     | string           | `"markdown"` \| `"json"` \| `"javascript"` \| `"pdf"`. Same vocabulary as `loadContentAck.format`. |
| `version`    | integer          | Monotonically increasing counter, starts at 1 after the first `loadContent` and increments on every `contentChange`. Lets parents discard out-of-order messages from slow postMessage queues. |
| `selection`  | object \| null   | Optional. `{ from, to }` in document-text coordinates. For markdown / JSON / JS this is a flat offset into `text`. For PDF it is `{ page: number, from: number, to: number }` (page index, character offset within the extracted text of that page). `null` if the editor is not focused or selection is unknown. |

**When to send:**
- After every CodeMirror `change` event, debounced (see §5).
- After every internal command that mutates the document (format, sort,
  transform, etc.).
- After any undo/redo step (CodeMirror emits `change` on these, so the
  normal path covers it).
- **Not** sent on cursor-only changes that don't modify text.
- **Not** sent while a `loadContent` round-trip is in flight (i.e. between
  the parent's `loadContent` and the iframe's `loadContentAck` for the same
  `version`).

### 3.2 iframe → parent: `ready`

Emitted exactly once, on iframe load, after the editor is initialized. The
parent should wait for this before sending the first `loadContent`.

```json
{
  "type": "ready",
  "format": "markdown",
  "version": 1
}
```

| Field     | Type   | Notes |
|-----------|--------|-------|
| `type`    | string | Literal `"ready"`. |
| `format`  | string | The default format this tool produces (`"markdown"` for `mdv`, etc.). Useful when a single host embeds multiple tools. |
| `version` | integer | The current `version` of the document. Always `1` on initial load (no content has been loaded yet). Increments after each `contentChange`. |

**Why this is separate from `toolSelection`:** `toolSelection` is a
generic signal that the iframe UI is mounted. `ready` is specifically about
"the editor is in a state where it can accept a `loadContent` and will
respond with `loadContentAck`." Tools with asynchronous initialization
(e.g. pdf.js loading workers) should defer `ready` until initialization
completes.

**Recommendation:** `ready` is an *additional* message. Existing hosts
that listen for `toolSelection` keep working. New hosts can wait for
`ready` for tighter control.

### 3.3 iframe → parent: `formatChange`

Emitted when the document's format changes (e.g. user toggles between
JSON and JS in `jsv.html`, or switches view modes in `mdv.html`).

```json
{
  "type": "formatChange",
  "format": "javascript",
  "previousFormat": "json"
}
```

| Field             | Type   | Notes |
|-------------------|--------|-------|
| `type`            | string | Literal `"formatChange"`. |
| `format`          | string | New format. Same vocabulary as `loadContentAck.format`. |
| `previousFormat`  | string | Format before the change. |

### 3.4 iframe → parent: `error`

Emitted when an operation fails. Currently `loadContent` failures surface
as silent no-ops; this message makes them visible.

```json
{
  "type": "error",
  "code": "load_failed",
  "message": "JSON parse error at line 4: unexpected token"
}
```

| Field     | Type   | Notes |
|-----------|--------|-------|
| `type`    | string | Literal `"error"`. |
| `code`    | string | One of: `"load_failed"` (loadContent rejected), `"validation_failed"` (jsv only: document doesn't match the requested format), `"internal_error"` (uncaught). |
| `message` | string | Human-readable detail. Safe to show in a host UI toast. |

**Currently the spec says mismatched payloads are silent no-ops with a
toast inside the iframe.** This spec makes them also visible to the host.
The internal toast can stay as a UX nicety.

### 3.5 parent → iframe: `appendContent`

Appends one chunk of text to the end of the current document, without
re-parsing or re-rendering. Intended for piping a chunked/streamed source
(e.g. an LLM response body) into `mdv.html` / `jsv.html` as it arrives,
instead of buffering the whole document before calling `loadContent`.

```json
{
  "type": "appendContent",
  "text": "...next chunk of the document...",
  "filename": "response.md",
  "options": { "targetOrigin": "https://my-host.example.com" }
}
```

| Field      | Type   | Notes |
|------------|--------|-------|
| `type`     | string | Literal `"appendContent"`. |
| `text`     | string | Text to append at the end of the document. Required; an empty string is a harmless no-op. |
| `filename` | string | Optional. May be sent on any chunk to set/update the document name (e.g. once the host learns it mid-stream). |
| `options`  | object | Optional. Same shape as the `loadContent` envelope (§9): `targetOrigin`. `skipAcks` has no effect here — `appendContent` never acks. |

**Behavior:**
- Origin is validated the same way as `loadContent` (§7): in `mdv.html`, if
  `options.targetOrigin` is set and doesn't match the sender's origin, the
  iframe replies with `error` / `origin_mismatch` and ignores the chunk.
  **`jsv.html` performs no such rejection** — like its own `loadContent`, it
  accepts messages from any origin and uses `targetOrigin` only to address
  outbound replies. Do not treat it as a security boundary.
- If no document exists yet (first message the iframe has ever received),
  `appendContent` behaves like a stream-starting `loadContent`: it
  initializes the editor with this chunk as the starting content.
- If this is the first `appendContent` since the last `loadContent` /
  `streamEnd`, the iframe enters **streaming mode**: `mdv.html` is pinned
  to the code (editor) view for the duration of the stream so it isn't
  re-running the Markdown render pipeline on every chunk.
- Every chunk is inserted at the end of the document (`editor.state.doc.length`)
  and the view is scrolled to follow it. This suppresses the normal
  `contentChange` echo, per-chunk rendering (mdv) / tree rebuild (jsv), and
  `localStorage` persistence — the same suppression `loadContent` already
  uses internally — so a long stream stays cheap regardless of chunk rate.
- Not acknowledged. Only `streamEnd` (below) sends a reply.

### 3.6 parent → iframe: `streamEnd`

Signals that a stream started by `appendContent` (or a stream-starting
`loadContent`) is finished. Triggers the one-time render/tree-build that
was deferred during streaming.

```json
{
  "type": "streamEnd",
  "filename": "response.md",
  "options": { "skipAcks": false }
}
```

| Field      | Type    | Notes |
|------------|---------|-------|
| `type`     | string  | Literal `"streamEnd"`. |
| `filename` | string  | Optional. Final filename update. |
| `options`  | object  | Optional. Same shape as `loadContent` (§9): `targetOrigin`, `skipAcks`. |

**Behavior:**
- Origin validated the same way as `loadContent` / `appendContent` (see the
  `mdv.html` / `jsv.html` difference noted in §3.5).
- Exits streaming mode.
- `mdv.html` switches back to render view and performs one full render of
  the accumulated document, then persists to `localStorage`.
- `jsv.html` applies the same whole-document normalization `loadContent`
  performs (Markdown code-fence stripping, literal-newline cleanup) — it is
  deferred to this point because chunks arrive verbatim, so a streamed
  ` ```json ` block still parses. It then runs the same JSON-shape detection
  and (re)builds the JSON tree once, and persists to `localStorage`.
- Any pending debounced `contentChange` is cancelled, so a keystroke made
  just before the stream cannot land after `streamEndAck` with a higher
  `version` and overwrite the streamed document on the host.
- Safe to send even if no stream is active (e.g. a `streamEnd` that races
  a `loadContent`) — it still performs the finalize steps and never
  throws; it just has nothing streaming-specific to undo.
- Unless `options.skipAcks` is `true`, replies with `streamEndAck`
  (§4.3) addressed to `event.source`, mirroring `loadContentAck`.

### 3.7 parent → iframe: `setViewMode`

Explicitly switches between code and rendered view, independent of
streaming. Useful for a host that wants to show the raw source while the
user is typing feedback, then flip back to rendered output.

```json
{
  "type": "setViewMode",
  "mode": "render"
}
```

| Field  | Type   | Notes |
|--------|--------|-------|
| `type` | string | Literal `"setViewMode"`. |
| `mode` | string | `"code"` or `"render"`. Any other value is ignored. |

**Behavior:**
- Origin validated the same way as `loadContent` (see the `mdv.html` /
  `jsv.html` difference noted in §3.5).
- `mdv.html`: `"code"` shows the CodeMirror editor; `"render"` shows the
  rendered Markdown preview (running a full render pass).
- `jsv.html`: the editor pane is always visible, so `"code"` is a no-op;
  `"render"` (re)builds the JSON tree against the current document using
  the same JSON-shape detection as `loadContent` / `streamEnd`.
- Does not touch streaming state, sync `version`, acks, or persisted
  state — this is a pure view toggle.

---

### 3.8 parent → iframe: `requestAssets`

Asks the iframe to hand back the current document **together with its
images**, as a self-contained bundle. This is the same pipeline behind the
Save → "Export with Assets (.zip)" menu item, but the result is posted to
the host instead of downloaded.

Use this when the host needs to persist or re-upload a document whose
images are remote URLs or inline `data:` URIs — after the round-trip, every
image reference is a relative `assets/<name>` path and the host holds the
bytes.

```json
{
  "type": "requestAssets"
}
```

| Field     | Type   | Notes |
|-----------|--------|-------|
| `type`    | string | Literal `"requestAssets"`. |
| `options` | object | Optional. Same envelope as `loadContent`; only `targetOrigin` is read. |

**Reply — `assetsResult` (iframe → parent):**

```json
{
  "type": "assetsResult",
  "markdown": "# Title\n\n![pic](assets/a.png)\n",
  "filename": "Title.md",
  "format": "markdown",
  "assets": [
    {
      "name": "a.png",
      "mime": "image/png",
      "bytes": "<ArrayBuffer>",
      "alt": "pic",
      "charOffset": 20,
      "headingPath": ["Title", "Section"]
    }
  ],
  "version": 7
}
```

| Field         | Type        | Notes |
|---------------|-------------|-------|
| `markdown`    | string      | The document rewritten so every collected image points at `assets/<name>`. The editor's own buffer is **not** modified. |
| `filename`    | string      | Current document name with a `.md` extension. |
| `format`      | string      | Always `"markdown"`. |
| `assets`      | array       | One entry per **unique** asset (duplicate URLs are deduped). |
| `version`     | number      | Current sync `version` at the time of the reply. |

Per-asset fields:

| Field         | Type          | Notes |
|---------------|---------------|-------|
| `name`        | string        | Filename within the `assets/` folder. Unique; collisions get a `-2`, `-3`, … suffix. Sanitized to `[A-Za-z0-9._-]`. |
| `mime`        | string        | HTTP `content-type` for remote assets, or the data URI's own media type. May be `""` if the server sent none. |
| `bytes`       | ArrayBuffer   | The raw file. Structured-cloneable, so it crosses the origin boundary intact. |
| `alt`         | string        | Alt text from the first occurrence. |
| `charOffset`  | number        | Character offset of the first occurrence in the **original** document. |
| `headingPath` | string[]      | Active ATX heading stack at that offset, outermost first (e.g. `["Guide", "Setup"]`). Empty if the asset precedes any heading. |

**Behavior:**

- Origin is validated exactly as for `loadContent` — a mismatched
  `options.targetOrigin` replies `error` / `origin_mismatch` and the bundle
  is **not** sent.
- The reply is posted to the sender's real origin (`event.origin`), never to
  `options.targetOrigin`. See §7.
- **All-or-nothing.** If any remote image fails to fetch, or any `data:` URI
  is undecodable, no bundle is produced and the iframe replies with
  `error` / `asset_export_failed`. There are no partial bundles.
- A document containing **no collectable assets is a success**, not an error:
  the reply is a normal `assetsResult` with `assets: []` and `markdown` set to
  the document unchanged (no rewrite was needed). Hosts can therefore treat
  every `assetsResult` uniformly and reserve `error` for genuine failures.
- Bytes are always `ArrayBuffer`, never `Blob` and never a blob: URL — an
  object URL is scoped to the iframe's origin and would be unreadable by the
  host.
- Read-only: does not modify the editor buffer, bump `version`, or touch
  streaming state.

**Scope (inherited from the export pipeline):** collects Markdown images
(`![alt](url)`) whose URL is `http(s):` or a base64 `data:` URI. Plain
hyperlinks to `http(s):` are deliberately left alone. Angle-bracket URLs,
reference-style images, relative paths, and non-base64 data URIs are not
collected.

---

## 4. Updated existing messages

### 4.1 `loadContentAck` (updated, backward-compatible)

Add a `version` field. Existing parents that don't read it keep working.

```json
{
  "type": "loadContentAck",
  "filename": "hello.md",
  "format": "markdown",
  "version": 5
}
```

The `version` is the new `version` of the document after the load. It is
the value the next `contentChange` will use as its starting point.

### 4.2 `titleChange` (updated, backward-compatible)

Add a `version` field for consistency.

```json
{
  "type": "titleChange",
  "title": "Hello",
  "version": 5
}
```

### 4.3 `streamEndAck` (new, mirrors `loadContentAck`)

Reply to `streamEnd` (§3.6), unless `options.skipAcks` was set.

```json
{
  "type": "streamEndAck",
  "filename": "response.md",
  "format": "markdown",
  "version": 6,
  "length": 4218
}
```

| Field      | Type    | Notes |
|------------|---------|-------|
| `type`     | string  | Literal `"streamEndAck"`. |
| `filename` | string  | Current document filename after the stream. |
| `format`   | string  | Same vocabulary as `loadContentAck.format`. |
| `version`  | integer | The `version` after the stream finalized. Same counter `contentChange` / `loadContentAck` use. |
| `length`   | integer | Length (characters) of the final document. Lets the host sanity-check the whole stream landed. |

### 4.4 `toolSelection` (unchanged)

Stays as is. New code should prefer `ready` when present and fall back to
`toolSelection` when the iframe predates this spec.

---

## 5. Debouncing and throttling

The `change` event in CodeMirror fires on every keystroke. A naive
`contentChange` poster would flood the parent.

**Implemented default:** 300ms debounce on outgoing `contentChange`
(`SYNC_DEBOUNCE_MS` in `mdv.html`). Hosts that need every character (e.g.
real-time collab) can adjust this on the parent side, but the iframe should
never post faster than 300ms.

Implementation sketch:

```js
let pendingChange = null;
let debounceTimer = null;
const DEBOUNCE_MS = 150;
let version = 1;

editor.on("change", (cm, change) => {
  // Skip changes that originated from our own loadContent
  if (change.origin === "setValue") return;

  pendingChange = {
    text: cm.getValue(),
    selection: cm.listSelections()[0]
      ? { from: cm.getCursor("from"), to: cm.getCursor("to") }
      : null
  };
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushChange, DEBOUNCE_MS);
});

function flushChange() {
  if (!pendingChange) return;
  version += 1;
  const payload = {
    type: "contentChange",
    text: pendingChange.text,
    filename: currentFilename,
    format: currentFormat,
    version,
    selection: pendingChange.selection
  };
  pendingChange = null;
  window.parent?.postMessage(payload, "*");
}
```

**Coordination with `loadContent`:** When the parent sends a `loadContent`,
the iframe should:

1. Cancel any pending `contentChange` (the next content is whatever the
   parent just sent, not whatever the user was typing before).
2. Set `editor.setValue(text)` with `origin: "setValue"` so the
   `change` event handler above skips it.
3. Increment `version` and post `loadContentAck` with the new `version`.
4. From this point, future user edits start from `version` and increment
   from there.

---

## 6. Versioning and ordering

The `version` field exists to handle the case where the parent receives
`contentChange` messages out of order (which can happen with rapid edits
on slow postMessage queues, or if the parent processes messages
asynchronously).

**Parent rules:**
- Track the highest `version` seen.
- Discard `contentChange` messages with `version <= lastSeenVersion`.
- Apply `contentChange` messages in `version` order (the parent may buffer
  out-of-order ones briefly; a small "out-of-order buffer" of ~10 entries
  is plenty for any realistic scenario).

**Iframe rules:**
- The `version` is a strict counter. Never decrement, never skip, never
  reuse. Even if the content is the same as the previous version, the
  counter still increments (e.g. a no-op `setValue` from a parent retry
  still produces a new `loadContentAck` with a bumped `version`).
- `loadContentAck.version` MUST match the counter after the load completes.

---

## 7. Security and origin handling

The existing protocol recommends `event.origin` checks on receive. The new
messages should follow the same pattern. The iframe should send its
messages with `targetOrigin: "*"` (matching current behavior and matching
how the host sends `loadContent` today). Hosts that want to lock it down
can override by setting `targetOrigin` in the `loadContent` envelope (a
proposed addition — see §9) or by validating `event.source` and
`event.origin` on receive.

**Threat model:** the new messages do not expand the attack surface in
either direction. The parent already trusts the iframe to render whatever
content it pushes; the new messages just expose the editor's state, which
the parent already controls.

---

## 8. Example host (parent) code

The minimum host that uses two-way sync:

```js
const iframe = document.getElementById("mdv");
let lastVersion = 0;
let latestText = "";

function whenReady(iframe) {
  return new Promise((resolve) => {
    function onMsg(e) {
      // Strict origin check in production
      if (e.origin !== "https://andesec.github.io") return;
      if (e.data?.type === "ready" || e.data?.type === "toolSelection") {
        if (e.source === iframe.contentWindow) {
          window.removeEventListener("message", onMsg);
          resolve();
        }
      }
    }
    window.addEventListener("message", onMsg);
  });
}

window.addEventListener("message", (e) => {
  if (e.origin !== "https://andesec.github.io") return;
  if (e.source !== iframe.contentWindow) return;
  if (e.data?.type !== "contentChange") return;
  if (e.data.version <= lastVersion) return; // out of order
  lastVersion = e.data.version;
  latestText = e.data.text;
  // e.g. update a "Save" button's enabled state, autosave to backend, etc.
});

await whenReady(iframe);
iframe.contentWindow.postMessage({
  type: "loadContent",
  filename: "README.md",
  text: "# Title\n\nInitial content."
}, "https://andesec.github.io");
```

The host's `latestText` is always within one debounce window of the
editor's actual state. For most use cases (upload on click, autosave on
idle, live preview in another pane) this is exactly right.

---

## 9. Proposed additions to the `loadContent` envelope

Optional, but recommended for symmetry. None of these are required for
two-way sync to work — they let the host be more explicit about what
they want.

```json
{
  "type": "loadContent",
  "filename": "README.md",
  "text": "...",
  "options": {
    "targetOrigin": "https://my-host.example.com",
    "skipAcks": false,
    "lockFilename": true
  }
}
```

| Option         | Type    | Default | Notes |
|----------------|---------|---------|-------|
| `targetOrigin` | string  | `"*"`   | The `targetOrigin` the iframe should use for its outbound messages. Lets the host restrict delivery to its own origin. The iframe should still validate `event.source` on the corresponding `loadContent` to confirm the host matches. |
| `skipAcks`     | boolean | `false` | If `true`, the iframe does not send `loadContentAck` for this load. Useful for streaming / high-frequency loads where the host doesn't need confirmation. |
| `lockFilename` | boolean | `false` | If `true`, the user cannot rename the file inside the iframe. The filename is treated as authoritative. |

If `options` is omitted or any sub-field is missing, the iframe uses the
defaults above. This is fully backward compatible.

---

## 10. Migration / rollout

The new messages are purely additive. The recommended rollout:

1. **Phase 1 (mdv.html only):** Implement `contentChange`, `ready`,
   `formatChange`, `error`, and the updated `loadContentAck.version` /
   `titleChange.version` fields in `mdv.html`. This covers the markdown
   editor use case and is the highest-demand tool.
2. **Phase 2 (jsv.html, pdf.html):** Port the same machinery. The only
   tool-specific bit is `format` (markdown / json+javascript / pdf) and
   the selection shape (text-offset vs page+offset for PDF).
3. **Phase 3 (embed.html docs):** Update `embed.html` with the new
   message types. Mark them as "available in v1.1+".

Hosts that don't care about the new messages keep working unchanged.

---

## 11. Reference summary

### Full message catalog (after this spec)

| Direction       | Type              | Added in   | Notes |
|-----------------|-------------------|------------|-------|
| parent → iframe | `loadContent`     | v1.0       | Updated: optional `options` envelope. |
| iframe → parent | `loadContentAck`  | v1.0       | Updated: `version` field added. |
| iframe → parent | `toolSelection`   | v1.0       | Unchanged. |
| iframe → parent | `titleChange`     | v1.0       | Updated: `version` field added. |
| iframe → parent | `ready`           | v1.1 (new) | One-shot on iframe load. |
| iframe → parent | `contentChange`   | v1.1 (new) | Debounced 300ms. Includes `version`. |
| iframe → parent | `formatChange`    | v1.1 (new) | Format toggled. |
| iframe → parent | `error`           | v1.1 (new) | Visible load / validation / internal errors. |
| parent → iframe | `appendContent`   | v1.1 (new) | Streaming: append one chunk. Not acked. |
| parent → iframe | `streamEnd`       | v1.1 (new) | Streaming: finalize (render / tree-build), then ack. |
| iframe → parent | `streamEndAck`    | v1.1 (new) | Reply to `streamEnd`. Includes `version` and `length`. |
| parent → iframe | `setViewMode`     | v1.1 (new) | Explicit code/render toggle, independent of streaming. |
| parent → iframe | `requestAssets`   | v1.2 (new) | Ask for the document plus its image bytes. |
| iframe → parent | `assetsResult`    | v1.2 (new) | Reply to `requestAssets`. Markdown rewritten to `assets/…` + ArrayBuffer bytes. |

### Versioning rules (post-v1.1)

- `version` starts at `1` after the first `loadContent` round-trip
  (i.e. after the iframe has acknowledged the initial content).
- Every `contentChange` increments `version` by 1.
- `loadContentAck.version` is the `version` after that load.
- `titleChange.version` reflects the document's current `version`.
- Parents MUST discard messages with `version <= lastSeen`.
- Iframes MUST NOT skip or reuse `version` values.

---

## 12. Open questions

These are flagged for discussion; the spec works without answers, but
they affect implementation ergonomics.

1. **Should `contentChange` include the change origin** (`user`, `undo`,
   `format`, `setValue`)? Useful for hosts that want to ignore programmatic
   changes, but adds noise for the common case. **Lean: no, keep the
   payload small. Hosts can diff if they need origin info.**

2. **Should the iframe batch `contentChange` events** if the parent
   doesn't respond to `loadContentAck` quickly? **Lean: no, the 300ms
   debounce is the batching mechanism. Don't over-engineer.**

3. **What happens on iframe unload?** Should the iframe send a final
   `contentChange` if there are unflushed changes? **Lean: yes, send a
   final synchronous-ish `contentChange` in a `beforeunload` handler.
   Best-effort — the parent may not receive it.**
