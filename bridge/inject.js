// Pip bridge: inserts converted Markdown into the chat input.
//
// This script runs inside the chat page, which is a third-party site, so it is
// kept deliberately small: it writes text into the message box and nothing
// else. It never touches privileged APIs, and it carries no tool calls — tool
// access goes through the local MCP server (see docs/CONCEPT.md §5).
//
// The Rust side embeds this file and evaluates it into the chat webview, then
// calls window.__pipInject(text).

(function () {
  if (window.__pipInject) return;

  const SELECTORS = [
    // Claude: a ProseMirror contenteditable.
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]',
    // Le Chat and most other chat UIs.
    'textarea',
    'input[type="text"]',
  ];

  function findInput() {
    for (const selector of SELECTORS) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function setTextarea(element, text) {
    // React tracks the previous value on the DOM node, so a plain
    // `element.value = text` is swallowed. Calling the native setter and then
    // firing an input event is what makes React notice.
    const prototype =
      element.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setContentEditable(element, text) {
    element.focus();

    // execCommand('insertText') is the only way that reliably produces the
    // beforeinput/input pair that editors like ProseMirror listen for.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch (error) {
      inserted = false;
    }

    if (!inserted) {
      element.textContent = text;
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
      );
    }
  }

  function toast(message) {
    const existing = document.getElementById("pip-toast");
    if (existing) existing.remove();

    const node = document.createElement("div");
    node.id = "pip-toast";
    node.textContent = message;
    node.style.cssText = [
      "position:fixed",
      "bottom:24px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "padding:8px 14px",
      "border-radius:8px",
      "background:rgba(20,20,22,0.92)",
      "color:#fff",
      "font:13px/1.3 -apple-system,BlinkMacSystemFont,sans-serif",
      "box-shadow:0 6px 24px rgba(0,0,0,0.3)",
      "pointer-events:none",
    ].join(";");

    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function attempt(text, triesLeft) {
    const element = findInput();
    if (!element) {
      if (triesLeft > 0) {
        setTimeout(() => attempt(text, triesLeft - 1), 400);
        return false;
      }
      toast("Pip: could not find the message box");
      return false;
    }

    try {
      if (element.isContentEditable) {
        setContentEditable(element, text);
      } else {
        setTextarea(element, text);
      }
      toast(`Pip: inserted ${text.length.toLocaleString()} characters`);
      return true;
    } catch (error) {
      toast("Pip: could not insert the text");
      return false;
    }
  }

  window.__pipInject = function (text) {
    if (typeof text !== "string" || text.length === 0) return false;
    return attempt(text, 10);
  };
})();
