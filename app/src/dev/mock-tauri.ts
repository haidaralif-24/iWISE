/**
 * A stand-in for the Tauri IPC, so the real UI can be rendered and driven in
 * a plain browser.
 *
 * This is a development tool. It is never imported by the app itself — only
 * by `dev-harness.html`, which Vite serves in dev mode. The production build
 * does not include it.
 *
 * It is built on Tauri's own `mockIPC`/`mockWindows` helpers, so the event
 * system is real enough that a drag-and-drop can be fired at the app from the
 * test script.
 */

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

/** Everything the app asked for, so a test can assert on it. */
export const calls: { cmd: string; args: unknown }[] = [];

const SAMPLE_MARKDOWN = `# Buoyancy and Archimedes' Principle

Archimedes' principle states that the upward force on a submerged object is equal to the weight of
the fluid it displaces.

## Key ideas

- Buoyant force = weight of displaced fluid
- An object floats when its density is less than the fluid's
- Pressure at depth: p = p0 + rho g h

## Worked example

A 1000 cm3 block of wood (density 600 kg/m3) is held underwater. What is the buoyant force?

1. Weight of displaced water: Fb = rho_water g V = 1000 x 9.81 x 0.001 = 9.81 N
2. Weight of the block: W = 600 x 9.81 x 0.001 = 5.89 N
3. The block is pushed up with a net force of 3.92 N
`;

const SAMPLE_RAW = `Buoyancy and Archimedes' Principle

Archimedes' principle states that the upward force on a submerged object is equal to the weight of
the fluid it displaces.

Key ideas
Buoyant force = weight of displaced fluid
An object floats when its density is less than the fluid's
Pressure at depth: p = p0 + rho g h

Worked example
A 1000 cm3 block of wood (density 600 kg/m3) is held underwater. What is the buoyant force?
1. Weight of displaced water: Fb = rho_water g V = 1000 x 9.81 x 0.001 = 9.81 N
2. Weight of the block: W = 600 x 9.81 x 0.001 = 5.89 N
3. The block is pushed up with a net force of 3.92 N
`;

const SAMPLE_NOTES = [
  {
    name: "buoyancy-summary.md",
    path: "/Users/you/.pip/notes/buoyancy-summary.md",
    preview:
      "# Buoyancy summary\n\nArchimedes' principle: the upward force equals the weight of displaced fluid.",
    modified: "2026-10-21T13:44:02.000Z",
    bytes: 142,
  },
  {
    name: "physics-formulas.md",
    path: "/Users/you/.pip/notes/physics-formulas.md",
    preview: "p = p0 + rho g h\nF_b = rho_fluid g V\nW = m g",
    modified: "2026-10-20T09:12:41.000Z",
    bytes: 58,
  },
];

const SAMPLE_AUDIT = [
  {
    timestamp: "2026-10-21T13:44:02.000Z",
    tool: "list_files",
    arguments: { folder: "/Users/you/.pip/notes" },
    allowed: true,
    approved: null,
    reason: null,
    actor: "mcp",
  },
  {
    timestamp: "2026-10-21T13:44:05.000Z",
    tool: "create_note",
    arguments: { title: "buoyancy-summary", text: "…" },
    allowed: true,
    approved: true,
    reason: "writing a new note",
    actor: "mcp",
  },
  {
    timestamp: "2026-10-21T13:51:18.000Z",
    tool: "read_document_as_markdown",
    arguments: { path: "/etc/passwd" },
    allowed: false,
    approved: null,
    reason: "path is outside the allowed folders",
    actor: "mcp",
  },
];

/** What `plugin:dialog|message` should answer with. */
let dialogAnswer: "Ok" | "Cancel" = "Ok";
/** What `plugin:dialog|open` should answer with. */
let openDialogAnswer: string | null = null;
/** The pending approval the app should be shown. */
let pendingApproval: unknown[] = [];

/** Every native dialog the app put up, and what it answered. */
export const dialogs: { message: string; title?: string; answer: string }[] = [];
/** Every approval the app answered. */
export const answers: { id: string; approved: boolean }[] = [];

function respond(cmd: string, args: any): unknown {
  switch (cmd) {
    case "hotkey_status":
      return { hotkey: "CmdOrCtrl+Shift+Space", registered: true, error: null };

    case "sidecar_status":
      return {
        ready: true,
        python: "/Users/you/iWISE/sidecars/markitdown/.venv/bin/python",
        script: "/Users/you/iWISE/sidecars/markitdown/convert.py",
        detail: "ready",
      };

    case "convert_document": {
      const pages = args?.pages;
      const selected = typeof pages === "string" && pages.length > 0 ? 2 : 6;
      // Roughly what the real converter returns when pages are selected.
      const scale = selected / 6;
      // A scanned document has nothing to read.
      const scanned = (args?.path ?? "").includes("Scanned");
      // Only a PDF has pages; everything else reports zero.
      const isPdf = (args?.path ?? "").toLowerCase().endsWith(".pdf");
      return {
        source: args?.path ?? "/Users/you/Assignment.pdf",
        name: (args?.path ?? "document.pdf").split("/").pop() ?? "document.pdf",
        extension: ".pdf",
        bytes: 210_728,
        pages: isPdf ? 6 : 0,
        selectedPages: Array.from({ length: selected }, (_, i) => i + 1),
        markdown: scanned ? "" : SAMPLE_MARKDOWN,
        rawText: scanned ? "" : SAMPLE_RAW,
        truncated: false,
        noTextLayer: scanned,
        markdownChars: scanned ? 0 : Math.round(SAMPLE_MARKDOWN.length * scale),
        rawChars: scanned ? 0 : Math.round(SAMPLE_RAW.length * scale),
        markdownTokens: scanned ? 0 : Math.round((SAMPLE_MARKDOWN.length * scale) / 4),
        rawTokens: scanned ? 0 : Math.round((SAMPLE_RAW.length * scale) / 4),
      };
    }

    case "pending_approvals":
      return pendingApproval;

    case "answer_approval":
      answers.push({ id: args?.id, approved: Boolean(args?.approved) });
      return null;

    case "audit_log":
      return SAMPLE_AUDIT.map((entry) => JSON.stringify(entry));

    case "list_notes":
      return SAMPLE_NOTES;

    case "open_chat":
    case "inject_into_chat":
      return null;

    // --- plugin commands -------------------------------------------------
    case "plugin:window|set_always_on_top":
    case "plugin:window|show":
    case "plugin:window|set_focus":
    case "plugin:window|minimize":
    case "plugin:window|close":
    case "plugin:window|hide":
    case "plugin:window|start_dragging":
      return null;

    case "plugin:dialog|message":
      dialogs.push({
        message: args?.message ?? "",
        title: args?.title,
        answer: dialogAnswer,
      });
      return dialogAnswer;
    case "plugin:dialog|open":
      return openDialogAnswer;

    case "plugin:opener|open_url":
    case "plugin:opener|open_path":
    case "plugin:opener|reveal_item_in_dir":
      return null;

    case "plugin:notification|is_permission_granted":
      return true;

    default:
      return null;
  }
}

/** Installs the mock. Call before anything imports the Tauri API. */
export function installMock() {
  mockWindows("main");

  mockIPC(
    (cmd, args: any) => {
      calls.push({ cmd, args });
      return respond(cmd, args);
    },
    // Without this, the event plugin is passed through to the handler above
    // and no listener is ever registered — so a drag-and-drop would go
    // nowhere.
    { shouldMockEvents: true },
  );

  // A small test API the harness and the screenshot script drive.
  (window as any).__pipMock = {
    calls,
    dialogs,
    answers,

    /** Fire a synthetic drag-and-drop at the app. */
    async dropFiles(paths: string[]) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:event|emit", {
        event: "tauri://drag-drop",
        payload: { type: "drop", paths, position: { x: 10, y: 10 } },
      });
      await invoke("plugin:event|emit", {
        event: "tauri://drag-leave",
        payload: { type: "leave" },
      });
    },

    /** Make a tool approval appear on the next poll. */
    queueApproval(request: unknown) {
      pendingApproval = [request];
    },

    /** Answer the next native dialog. */
    answerDialog(answer: "Ok" | "Cancel") {
      dialogAnswer = answer;
    },

    /** Answer the file picker. */
    answerFilePicker(path: string | null) {
      openDialogAnswer = path;
    },

    /** Press a tab by its label, so a screenshot can show it. */
    selectTab(label: string) {
      const wanted = label.trim().toLowerCase();
      const button = Array.from(document.querySelectorAll(".tabs button")).find(
        (node) => (node.textContent ?? "").trim().toLowerCase() === wanted,
      ) as HTMLButtonElement | undefined;
      if (!button) {
        const labels = Array.from(document.querySelectorAll(".tabs button")).map(
          (node) => (node.textContent ?? "").trim(),
        );
        throw new Error(`no tab called "${label}" — the tabs are: ${labels.join(", ")}`);
      }
      button.click();
      return true;
    },
  };
}
