// Tests for bridge/inject.js.
//
// The bridge is the one piece of Pip that runs inside a third-party page, so
// it is worth testing on its own. These stubs are deliberately minimal: they
// only implement the parts of the DOM the bridge actually touches.
//
//   node bridge/test-inject.js

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "inject.js"), "utf8");

/** A fake element that records what the bridge did to it. */
function makeElement({ tagName, isContentEditable = false, selector }) {
  const events = [];
  const element = {
    tagName,
    isContentEditable,
    selector,
    events,
    value: "",
    textContent: "",
    focused: false,
    dispatchEvent(event) {
      events.push(event.type);
      return true;
    },
    focus() {
      element.focused = true;
    },
  };

  return element;
}

/** Builds a window/document pair that reports `element` for one selector. */
function makeContext(element, { execCommandResult = true } = {}) {
  const range = { selectNodeContents() {} };
  const selection = {
    removeAllRanges() {},
    addRange() {},
  };

  const document = {
    body: { appendChild() {} },
    getElementById: () => null,
    createElement(tagName) {
      // Enough of a node for the toast: it sets style, textContent, id and
      // removes itself later.
      return {
        tagName,
        id: "",
        style: { cssText: "" },
        textContent: "",
        remove() {},
      };
    },
    querySelector(selector) {
      return element && element.selector === selector ? element : null;
    },
    execCommand(command, showUi, value) {
      if (command !== "insertText") return false;
      if (!execCommandResult) return false;
      element.textContent = value;
      element.events.push("input");
      return true;
    },
    createRange: () => range,
  };

  class FakeTextAreaElement {}
  class FakeInputElement {}
  // The prototype setter writes to the element's own `value`, the way a real
  // textarea does.
  Object.defineProperty(FakeTextAreaElement.prototype, "value", {
    get() {
      return this.value;
    },
    set(next) {
      this.value = next;
    },
    configurable: true,
  });
  Object.defineProperty(FakeInputElement.prototype, "value", {
    get() {
      return this.value;
    },
    set(next) {
      this.value = next;
    },
    configurable: true,
  });

  const window = {
    HTMLTextAreaElement: FakeTextAreaElement,
    HTMLInputElement: FakeInputElement,
    getSelection: () => selection,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  const context = vm.createContext({
    window,
    document,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    InputEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.bubbles = init.bubbles;
        this.inputType = init.inputType;
        this.data = init.data;
      }
    },
    Object,
    String,
    console,
    setTimeout,
  });

  return context;
}

function runBridge(element, options) {
  const context = makeContext(element, options);
  vm.runInContext(source, context);
  return context;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}`);
    console.log(`       ${error.message}`);
    failed += 1;
  }
}

console.log("bridge/inject.js");

test("defines window.__pipInject", () => {
  const context = runBridge(null);
  assert.equal(typeof context.window.__pipInject, "function");
});

test("finds a textarea and writes to it", () => {
  const element = makeElement({ tagName: "TEXTAREA", selector: "textarea" });
  const context = runBridge(element);

  const ok = context.window.__pipInject("hello from Pip");

  assert.equal(ok, true);
  assert.equal(element.value, "hello from Pip");
  assert.ok(element.events.includes("input"), "an input event should be fired");
});

test("fires input and change on a textarea", () => {
  const element = makeElement({ tagName: "TEXTAREA", selector: "textarea" });
  const context = runBridge(element);

  context.window.__pipInject("text");

  assert.deepEqual(element.events, ["input", "change"]);
});

test("uses the native setter so React notices the change", () => {
  // A React-controlled textarea keeps the previous value on the node and
  // ignores a plain assignment. The bridge has to go through the prototype
  // setter, which this stub records.
  let usedNativeSetter = false;

  const element = makeElement({ tagName: "TEXTAREA", selector: "textarea" });
  const context = makeContext(element);

  class Tracked {}
  Object.defineProperty(Tracked.prototype, "value", {
    get() {
      return this.value;
    },
    set(next) {
      usedNativeSetter = true;
      this.value = next;
    },
    configurable: true,
  });
  context.window.HTMLTextAreaElement = Tracked;

  vm.runInContext(source, context);
  context.window.__pipInject("text");

  assert.ok(usedNativeSetter, "the prototype setter should have been used");
});

test("writes into a ProseMirror contenteditable with insertText", () => {
  const element = makeElement({
    tagName: "DIV",
    selector: 'div[contenteditable="true"][role="textbox"]',
    isContentEditable: true,
  });
  const context = runBridge(element);

  const ok = context.window.__pipInject("# Heading\n\nBody");

  assert.equal(ok, true);
  assert.equal(element.textContent, "# Heading\n\nBody");
  assert.ok(element.focused, "the element should have been focused");
});

test("falls back to textContent when execCommand is refused", () => {
  const element = makeElement({
    tagName: "DIV",
    selector: 'div[contenteditable="true"].ProseMirror',
    isContentEditable: true,
  });
  const context = runBridge(element, { execCommandResult: false });

  context.window.__pipInject("fallback");

  assert.equal(element.textContent, "fallback");
  assert.ok(element.events.includes("input"), "an input event should still be fired");
});

test("reports failure when there is no message box", () => {
  const context = runBridge(null);
  assert.equal(context.window.__pipInject("text"), false);
});

test("ignores an empty payload", () => {
  const context = runBridge(null);
  assert.equal(context.window.__pipInject(""), false);
  assert.equal(context.window.__pipInject(undefined), false);
});

test("is idempotent — evaluating it twice does not redefine the bridge", () => {
  const context = runBridge(null);
  const first = context.window.__pipInject;
  vm.runInContext(source, context);
  assert.equal(context.window.__pipInject, first);
});

console.log();
if (failed === 0) {
  console.log(`\x1b[32mAll ${passed} bridge tests passed.\x1b[0m`);
} else {
  console.log(`\x1b[31m${failed} of ${passed + failed} bridge tests failed.\x1b[0m`);
  process.exit(1);
}
