Technical Specification: Professional Web-Based Diff Tool

1. Overview

A high-performance, developer-centric, frontend-only diffing application designed to run entirely within the browser. It provides a GitHub-inspired interface with advanced visual feedback, real-time live editing capabilities, and a robust symbol-based navigation system. The tool is engineered to handle large-scale codebases with the fluidity and responsiveness expected of a desktop-class IDE, while remaining accessible through a simple web interface.

2. Core Tech Stack

Editor Engine: CodeMirror 6. Chosen for its modular architecture, excellent accessibility features, and superior performance. CM6 allows for granular control over the editor state and easy integration of custom extensions.

Styling: Tailwind CSS. Utilized for a utility-first, highly responsive, and easily themeable UI that adapts to various screen dimensions without overhead.

Themes: Native Dark/Light mode support. The tool implements a dynamic theme-switching engine that monitors system preferences or manual toggles to maintain 1:1 visual parity with the broader text-tools repository ecosystem.

Diff Engine: diff-match-patch enhanced with a "Patience Diff" variant. This combination provides the speed of Google's industry-standard algorithm with the superior "Move Detection" and human-readable results typical of the Git version control system.

Syntax Highlighting: @codemirror/language-data. This allows for automatic language detection and high-fidelity highlighting for over 100 languages, including complex parsers for JSX, TypeScript, and Rust.

3. Functional Requirements

3.1 View Modes

Split View: A classic side-by-side comparison. This mode features synchronized bi-directional scrolling and visual connecting lines (SVG-based) that draw a direct path between changed blocks, making it easy to track modifications across files.

Unified View: A single-column inline comparison where additions and deletions are interleaved. This is the default mode for mobile devices and narrow viewports to maximize readability.

Live Sync: The "Live Diffing" feature ensures that as a user types in either the "Original" or "Modified" pane, the diff is re-calculated on the fly. A 200ms debounce prevents performance stutters during rapid typing while maintaining the feeling of real-time feedback.

3.2 Diff Logic & Options

Granularity: The tool provides character-level highlighting within changed lines (intra-line diffing). This allows developers to see exactly which word or symbol changed in a long line of code, rather than just seeing the entire line marked as "changed."

Move Detection: The engine identifies blocks of code that have been relocated within the file. These are visually distinct from standard additions/deletions, preventing "false positives" where a simple refactor looks like a total rewrite.

Toggleable Options:

Ignore Whitespace: Users can choose to ignore trailing whitespace, changes in indentation (e.g., Tab vs. Space), or all whitespace changes entirely to focus on logic modifications.

Case Sensitivity: A toggle to treat VariableA and variablea as identical, useful for certain configuration files or non-case-sensitive languages.

Collapse Unchanged: To reduce visual noise, unchanged blocks of code can be collapsed. Users can "Expand context" (e.g., +20 lines) by clicking icons in the gutter, similar to the GitHub Pull Request interface.

3.3 Symbol Outline (Navigation)

Code Support: A collapsible sidebar on the left-hand side provides a tree-view outline of the file structure. It dynamically parses the code to show classes, functions, methods, and fields.

Markdown Support: For documentation files, the outline intelligently displays H1-H6 headings, as well as complex elements like Tables and fenced Code Blocks for quick navigation.

Interaction: The outline is fully interactive. Clicking a symbol instantly scrolls both the Original and Modified editors to that specific line, with a brief highlight animation to guide the user's eye.

3.4 File & Data Handling

Persistence: The tool uses localStorage to save the current text buffers, active diff options, and theme preferences. This ensures that a page refresh or accidental tab closure does not result in lost work.

Privacy: A dedicated "Clear Workspace" button provides a single-click solution to wipe all stored data from the browser's memory and storage.

Input Methods:

Direct Entry: Manual text entry with standard editor features (auto-close brackets, linting).

Drag-and-Drop: Users can drop two files onto the interface to automatically populate the left and right panes.

File Picker: Integration with the browser's File System Access API for opening and loading local files.

Export: Functionality to save individual panes or a combined "Diff Report" as a text or HTML file.

4. UI/UX Design (Tailwind Integration)

4.1 Responsive Layout

Mobile-First Engineering: The layout is designed to be fully functional on touch devices. On small screens, the UI automatically collapses the sidebar and forces a Unified view to prevent horizontal scrolling.

Edge-to-Edge Design: To maximize the usable workspace, margins and paddings are minimized on mobile. The editor spans the full width of the screen, providing an "immersive" editing experience.

Professional Toolbar: A compact, high-density toolbar at the top houses essential controls. Icons are clearly labeled with tooltips, ensuring the interface remains uncluttered for power users.

4.2 Visual Feedback

Gutter Markers: The CodeMirror gutter features clear + (green) and - (red) markers. Moved blocks are marked with a distinct icon (e.g., a double arrow).

Highlight Colors:

Additions: A soft green background for the line, with a more saturated green for character-level changes.

Deletions: A soft red/pink background for the line, with a darker red for specific removed characters.

Moves: Amber/Yellow accents used for the gutter and background to signify code that exists in both files but in different positions.

Empty States: When no text is present, the tool displays a clean, professional placeholder with "Get Started" instructions and drag-and-drop targets.

5. Technical Implementation Details

5.1 CodeMirror 6 Configuration

Merge Extension: Leverage the official @codemirror/merge package to handle the heavy lifting of UI synchronization and diff gutter rendering.

State Management: Use Compartments to allow the user to switch languages or themes without re-initializing the entire editor instance.

Dynamic Parsing: Utilize lezer (CM6's incremental parser) to build the Symbol Outline. This ensures the outline updates instantly as the user types without causing UI lag.

5.2 Performance Optimization

Virtual Scrolling: Only the lines currently visible in the viewport are rendered to the DOM. This allows the tool to handle files exceeding 50,000 lines with zero degradation in scrolling performance.

Web Worker Integration: Diff calculations—especially for very large files—are offloaded to a background Web Worker. This keeps the main UI thread free for user interactions, preventing the browser from hanging during complex "Move Detection" passes.

5.3 Integration Note (Referencing mdv.html / jsv.html)

Design Parity: The implementation must strictly adhere to the CSS variables established in the text-tools repository. Key variables like --bg-primary, --accent-color, and --border-style must be used to ensure the diff tool feels like a native module.

Code Reuse: Where possible, the file-handling logic and navigation components from mdv.html should be abstracted or mirrored to provide a consistent user experience across the entire suite of tools.

6. Future Roadmap

3-Way Diffing: Planned support for a "Merge Conflict" style view (Base vs. Mine vs. Theirs) with a resolution pane.

Patch Generation: The ability to generate standard Unix .patch or .diff strings that can be copied to the clipboard or saved for use in CLI environments.

Image Diffing: A future extension to visually compare two images using an "onion skin" or "slider" overlay.