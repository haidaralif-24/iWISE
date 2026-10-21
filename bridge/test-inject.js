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

/**
 * A fake element that records what the bridge did to it.
 *
 * `matches` lists the selectors the element answers to. A selector with no
 * attribute part ("textarea") also matches on the tag name alone.
 */
function makeElement({
  tagName,
  isContentEditable = false,
  matches = [],
  attributes = {},
  rect = { width: 400, height: 60, top: 500, left: 10 },
  visible = true,
  disabled = false,
  readOnly = false,
}) {
  const events = [];
  const element = {
    tagName,
    isContentEditable,
    matches,
    attributes,
    events,
    value: "",
    textContent: "",
    focused: false,
    disabled,
    readOnly,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    getBoundingClientRect() {
      return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
    },
    dispatchEvent(event) {
      events.push(event.type);
      return true;
    },
    focus() {
      element.focused = true;
    },
  };

  if (!visible) {
    // An element that is not on screen: the style lookup reports it hidden.
    element.style = { display: "none", visibility: "hidden", opacity: "0" };
  } else {
    element.style = { display: "block", visibility: "visible", opacity: "1" };
  }

  return element;
}

/** Builds a window/document pair that reports the given elements. */
function makeContext(elements, { execCommandResult = true } = {}) {
  const list = elements.filter(Boolean);
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
        setAttribute() {},
        remove() {},
      };
    },
    querySelectorAll(selector) {
      const tag = selector.split(/[\s\[>]/)[0];
      return list.filter((element) => {
        if (element.matches.includes(selector)) return true;
        // A bare tag selector matches on the tag name.
        return !selector.includes("[") && element.tagName.toLowerCase() === tag;
      });
    },
    execCommand(command, showUi, value) {
      if (command !== "insertText") return false;
      if (!execCommandResult) return false;
      const target = list.find((element) => element.isContentEditable);
      if (!target) return false;
      target.textContent = value;
      target.events.push("input");
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
    innerHeight: 800,
    getSelection: () => selection,
    getComputedStyle: (element) => element.style,
    // Retries are fired straight away so the suite does not wait on them.
    setTimeout: (fn) => setTimeout(fn, 0),
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
    Number,
    Array,
    Math,
    Infinity,
    console,
    setTimeout,
  });

  return context;
}

function runBridge(elements, options) {
  const context = makeContext(elements, options);
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
  const context = runBridge([]);
  assert.equal(typeof context.window.__pipInject, "function");
});

test("finds a textarea and writes to it", () => {
  const element = makeElement({ tagName: "TEXTAREA", matches: ["textarea"] });
  const context = runBridge([element]);

  const ok = context.window.__pipInject("hello from Pip");

  assert.equal(ok, true);
  assert.equal(element.value, "hello from Pip");
  assert.ok(element.events.includes("input"), "an input event should be fired");
});

test("fires input and change on a textarea", () => {
  const element = makeElement({ tagName: "TEXTAREA", matches: ["textarea"] });
  const context = runBridge([element]);

  context.window.__pipInject("text");

  assert.deepEqual(element.events, ["input", "change"]);
});

test("uses the native setter so React notices the change", () => {
  // A React-controlled textarea keeps the previous value on the node and
  // ignores a plain assignment. The bridge has to go through the prototype
  // setter, which this stub records.
  let usedNativeSetter = false;

  const element = makeElement({ tagName: "TEXTAREA", matches: ["textarea"] });
  const context = makeContext([element]);

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
    matches: ['div[contenteditable="true"][role="textbox"]'],
    isContentEditable: true,
  });
  const context = runBridge([element]);

  const ok = context.window.__pipInject("# Heading\n\nBody");

  assert.equal(ok, true);
  assert.equal(element.textContent, "# Heading\n\nBody");
  assert.ok(element.focused, "the element should have been focused");
});

test("falls back to textContent when execCommand is refused", () => {
  const element = makeElement({
    tagName: "DIV",
    matches: ['div[contenteditable="true"].ProseMirror'],
    isContentEditable: true,
  });
  const context = runBridge([element], { execCommandResult: false });

  context.window.__pipInject("fallback");

  assert.equal(element.textContent, "fallback");
  assert.ok(element.events.includes("input"), "an input event should still be fired");
});

test("reports failure when there is no message box", () => {
  const context = runBridge([]);
  assert.equal(context.window.__pipInject("text"), false);
});

test("ignores an empty payload", () => {
  const context = runBridge([]);
  assert.equal(context.window.__pipInject(""), false);
  assert.equal(context.window.__pipInject(undefined), false);
});

test("is idempotent — evaluating it twice does not redefine the bridge", () => {
  const context = runBridge([]);
  const first = context.window.__pipInject;
  vm.runInContext(source, context);
  assert.equal(context.window.__pipInject, first);
});

test("prefers the composer over a search box", () => {
  // A chat page has more than one editable box. The search field comes first
  // in the document but must not win.
  const search = makeElement({
    tagName: "INPUT",
    matches: ["input[type=\"text\"]"],
    attributes: { placeholder: "Search chats", type: "text" },
    rect: { width: 200, height: 30, top: 10, left: 10 },
  });
  const composer = makeElement({
    tagName: "TEXTAREA",
    matches: ["textarea"],
    attributes: { placeholder: "Send a message" },
    rect: { width: 600, height: 80, top: 600, left: 10 },
  });

  const context = runBridge([search, composer]);
  context.window.__pipInject("text");

  assert.equal(composer.value, "text");
  assert.equal(search.value, "", "the search box should have been left alone");
});

test("ignores a hidden textarea", () => {
  const hidden = makeElement({
    tagName: "TEXTAREA",
    matches: ["textarea"],
    visible: false,
    attributes: { placeholder: "Send a message" },
  });
  const real = makeElement({
    tagName: "TEXTAREA",
    matches: ["textarea"],
    attributes: { placeholder: "Send a message" },
  });

  const context = runBridge([hidden, real]);
  context.window.__pipInject("text");

  assert.equal(real.value, "text");
  assert.equal(hidden.value, "");
});

test("ignores a disabled box", () => {
  const disabled = makeElement({
    tagName: "TEXTAREA",
    matches: ["textarea"],
    disabled: true,
    attributes: { placeholder: "Send a message" },
  });
  const real = makeElement({
    tagName: "TEXTAREA",
    matches: ["textarea"],
    attributes: { placeholder: "Send a message" },
  });

  const context = runBridge([disabled, real]);
  context.window.__pipInject("text");

  assert.equal(real.value, "text");
  assert.equal(disabled.value, "");
});

test("finds a composer by its placeholder", () => {
  const composer = makeElement({
    tagName: "TEXTAREA",
    matches: ["textarea[placeholder]", "textarea"],
    attributes: { placeholder: "Ask anything" },
  });

  const context = runBridge([composer]);
  context.window.__pipInject("text");

  assert.equal(composer.value, "text");
});

console.log();
if (failed === 0) {
  console.log(`\x1b[32mAll ${passed} bridge tests passed.\x1b[0m`);
} else {
  console.log(`\x1b[31m${failed} of ${passed + failed} bridge tests failed.\x1b[0m`);
  process.exit(1);
}
