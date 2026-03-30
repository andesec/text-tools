# Future: SVG Connector Lines for Split Diff View

## Status
Deferred from V1. Planned for a future iteration.

## Description
In split view, SVG or Canvas "connector lines" draw a visual path between changed
blocks in the left and right panes, making it easy to track which deleted lines
correspond to which added lines across large files.

## How to Implement

### Approach
1. After each diff run, query the MergeView's DOM for `.cm-changedLine`,
   `.cm-insertedLine`, and `.cm-deletedLine` elements in both panes.
2. For each pair of corresponding changed hunks (matched by index), read their
   `getBoundingClientRect()` coordinates.
3. Draw Bézier curves on a transparent `<svg>` overlay that sits between the two
   panes (z-index above editors, pointer-events: none).
4. On scroll, re-query positions and update the SVG paths.

### Key Challenges
- **Scroll sync**: MergeView already synchronizes scroll positions, but the SVG
  listener must fire `after` the scroll event to read updated positions.
- **Performance**: Throttle the SVG update to every ~16ms (requestAnimationFrame)
  to avoid layout thrashing on large files.
- **Collapsed hunks**: Connectors should not be drawn for hunks inside collapsed
  unchanged sections.
- **Responsive**: Disable / hide connectors on narrow viewports where split view
  is not shown.

### Reference implementations
- VS Code's diff editor uses a canvas-based approach.
- GitHub Desktop uses SVG paths with matching hunk IDs.

## API Sketch

```js
function drawConnectors(mergeView) {
  const svg = document.getElementById('connector-svg');
  svg.innerHTML = '';
  const leftLines  = mergeView.a.dom.querySelectorAll('.cm-changedLine, .cm-deletedLine');
  const rightLines = mergeView.b.dom.querySelectorAll('.cm-changedLine, .cm-insertedLine');
  const count = Math.min(leftLines.length, rightLines.length);
  for (let i = 0; i < count; i++) {
    const l = leftLines[i].getBoundingClientRect();
    const r = rightLines[i].getBoundingClientRect();
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const x1 = l.right, y1 = l.top + l.height / 2;
    const x2 = r.left,  y2 = r.top + r.height / 2;
    const cx = (x1 + x2) / 2;
    path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
    path.setAttribute('stroke', '#6366f1');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', '0.5');
    svg.appendChild(path);
  }
}
```
