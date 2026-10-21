// Pip bridge: inserts converted Markdown into the chat input.
//
// This script runs inside the chat page, which is a third-party site, so it is
// kept deliberately small: it writes text into the message box and nothing
// else. It never touches privileged APIs, and it carries no tool calls — tool
// access goes through the local MCP server (see docs/CONCEPT.md §5).
//
// The Rust side embeds this file and evaluates it into the chat webview, then
// calls window.__pipInject(text).
//
// The chat sites change their markup without notice, so finding the message
// box is done by scoring candidates rather than by trusting one selector.
// The score prefers a large, visible box whose label talks about messages,
// and the text of the page is never read.

(function () {
  if (window.__pipInject) return;

  // Ordered from most specific to most general. The first match is not
  // automatically the winner — every candidate is scored — but the order
  // breaks ties.
  const SELECTORS = [
    // Claude: a ProseMirror composer.
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][data-contents]',
    'div[contenteditable="true"][aria-label*="message" i]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][aria-label*="ask" i]',
    'div[contenteditable="true"]',
    // Le Chat and most other chat UIs.
    'textarea[placeholder]',
    'textarea',
    'input[type="text"][placeholder]',
    'input[type="text"]',
  ];

  // Words that suggest a box is the composer rather than a search field.
  const COMPOSER_WORDS =
    /message|ask|send|prompt|reply|chat|type|write|tell|question|assistant|claude|message/i;

  function isVisible(element) {
    if (element.disabled || element.readOnly) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 24 && rect.height > 12;
  }

  function labelOf(element) {
    const parts = [
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-placeholder"),
    ];
    return parts.filter(Boolean).join(" ");
  }

  /**
   * Higher is better. A chat page usually has more than one editable box —
   * a search field, a hidden attachment input — so the composer has to be
   * picked out rather than taken in document order.
   */
  function score(element, order) {
    let value = 100 - order; // earlier selectors win ties

    const rect = element.getBoundingClientRect();
    const label = labelOf(element);

    if (COMPOSER_WORDS.test(label)) value += 40;
    if (/search/i.test(label)) value -= 60;

    if (element.tagName === "TEXTAREA") value += 20;
    if (element.isContentEditable) value += 20;
    if (element.getAttribute("role") === "textbox") value += 10;

    // The composer sits low on the page.
    const viewportHeight = window.innerHeight || 800;
    if (rect.top > viewportHeight * 0.35) value += 15;

    // A real text box, not a sliver.
    if (rect.width > 200) value += 15;
    if (rect.height > 40) value += 10;

    // A hidden textarea kept around for a paste handler should not win.
    if (rect.height < 20) value -= 50;

    return value;
  }

  function findInput() {
    let best = null;
    let bestScore = -Infinity;

    SELECTORS.forEach((selector, order) => {
      let found;
      try {
        found = document.querySelectorAll(selector);
      } catch (error) {
        return; // an unsupported selector must not stop the search
      }

      for (const element of Array.from(found)) {
        if (!isVisible(element)) continue;
        const value = score(element, order);
        if (value > bestScore) {
          bestScore = value;
          best = element;
        }
      }
    });

    return best;
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
    node.setAttribute("role", "status");

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
