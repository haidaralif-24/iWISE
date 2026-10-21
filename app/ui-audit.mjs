#!/usr/bin/env node
/**
 * Renders the real Pip UI in headless Chrome and audits it.
 *
 * This is how the interface gets checked on a machine where screen recording
 * is not permitted: the app is rendered for real, driven through the Chrome
 * DevTools Protocol, and then measured.
 *
 * For every tab it produces:
 *   - a PNG of the app at its real size (420x680)
 *   - a text report of the layout findings
 *   - any console errors the page logged
 *
 * Usage:
 *   node app/ui-audit.mjs [--out docs/screenshots] [--size 420x680]
 *
 * It needs a Chrome binary. Set CHROME to point at one.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

// ----------------------------------------------------------------- arguments
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const outDir = path.resolve(repo, option("out", "docs/screenshots"));
const [width, height] = option("size", "420x680").split("x").map(Number);
const port = Number(option("port", "9333"));

// ---------------------------------------------------------------- the browser
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    path.join(os.homedir(), "Documents/random/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error("no Chrome found — set CHROME=/path/to/chrome");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pip-ui-audit-"));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

function cleanup() {
  chrome.kill("SIGKILL");
  fs.rmSync(profile, { recursive: true, force: true });
}
process.on("exit", cleanup);

// ------------------------------------------------------------ the dev server
const server = spawn("npx", ["vite", "--port", "1433", "--strictPort"], {
  cwd: path.join(repo, "app"),
  stdio: "ignore",
  env: process.env,
});
process.on("exit", () => server.kill("SIGKILL"));

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch("http://localhost:1433/dev-harness.html");
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// -------------------------------------------------------------- the protocol
class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 30_000);
    });
  }

  on(listener) {
    this.listeners.push(listener);
  }
}

async function connect() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", reject, { once: true });
        });
        return new Session(socket);
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome did not open a debugging port");
}

// ------------------------------------------------------------------- the run
const SCENARIOS = [
  { name: "01-chat", query: "tab=chat" },
  { name: "02-timer", query: "tab=timer" },
  { name: "03-docs-empty", query: "tab=docs" },
  { name: "04-docs-converted", query: "tab=docs&drop=/Users/you/Documents/Assignment_1.pdf" },
  { name: "05-notes", query: "tab=notes" },
  { name: "06-apps", query: "tab=apps" },
  { name: "07-log", query: "tab=log" },
  { name: "08-approval", query: "tab=chat&approval=1" },
  {
    name: "09-docs-scanned",
    query: "tab=docs&drop=/Users/you/Documents/Scanned_Worksheet.pdf",
  },
  {
    name: "10-docs-two-files",
    query: "tab=docs&drop=/Users/you/Documents/Assignment_1.pdf,/Users/you/Documents/Notes.txt",
  },
];

if (!(await waitForServer())) {
  console.error("the harness server did not start");
  cleanup();
  process.exit(1);
}

console.log(`chrome:  ${chromePath}`);
console.log(`server:  http://localhost:1433`);
console.log(`size:    ${width}x${height}`);
console.log(`output:  ${outDir}`);
console.log();

const session = await connect();

const consoleErrors = [];
session.on((message) => {
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(
      message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
    );
  }
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    consoleErrors.push(details.exception?.description ?? details.text);
  }
});

await session.send("Runtime.enable");
await session.send("Page.enable");
// The exact window size, so the layout is measured at the size it ships at.
await session.send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 2,
  mobile: false,
});

async function evaluate(expression) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return result.result.value;
}

let totalFindings = 0;
let totalErrors = 0;
let approvalFailures = 0;

for (const scenario of SCENARIOS) {
  consoleErrors.length = 0;

  const url = `http://localhost:1433/dev-harness.html?${scenario.query}&audit=1`;
  await session.send("Page.navigate", { url });

  // Wait for the harness to finish its own script.
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      ready = await evaluate("window.__pipReady === true");
    } catch {
      ready = false;
    }
    if (ready) break;
  }

  // Let the layout settle before measuring.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const report = await evaluate("window.__pipAudit ? window.__pipAudit() : '(no audit)'");
  const screenshot = await session.send("Page.captureScreenshot", { format: "png" });

  const file = path.join(outDir, `${scenario.name}.png`);
  fs.writeFileSync(file, Buffer.from(screenshot.data, "base64"));

  // The findings line is the only count that matters; the "errors shown" list
  // is the app doing its job.
  const findings = Number(report.match(/^findings: (\d+)/m)?.[1] ?? 0);
  totalFindings += findings;
  totalErrors += consoleErrors.length;

  console.log(`===== ${scenario.name} =====`);
  console.log(report);
  if (consoleErrors.length) {
    console.log(`  console errors (${consoleErrors.length}):`);
    for (const error of consoleErrors) console.log(`    ${error}`);
  }

  // The approval flow ends in a native dialog, which cannot be pictured. The
  // calls it made can be checked, though.
  if (scenario.query.includes("approval=1")) {
    const dialogs = await evaluate("JSON.stringify(window.__pipMock.dialogs)");
    const answers = await evaluate("JSON.stringify(window.__pipMock.answers)");
    console.log(`  native dialog: ${dialogs}`);
    console.log(`  approval answer: ${answers}`);
    if (dialogs === "[]" || answers === "[]") {
      console.log("  [FAIL] the approval never reached the user");
      approvalFailures += 1;
    }
  }
  console.log();
}

console.log(`total layout findings: ${totalFindings}`);
console.log(`total console errors:  ${totalErrors}`);
console.log(`approval flow failures: ${approvalFailures}`);
console.log(`screenshots in:        ${outDir}`);

cleanup();
process.exit(totalErrors > 0 || totalFindings > 0 || approvalFailures > 0 ? 1 : 0);
