#!/usr/bin/env node
/**
 * Turns docs/slides.md into a self-contained HTML deck.
 *
 * The deck is written in Markdown so it can be edited in any editor and
 * diffed in a pull request. This script renders it to one HTML file with no
 * dependencies and no network access, so the talk does not depend on
 * anything being installed on the machine that is presenting it.
 *
 *   node tools/slides-to-html.mjs
 *   node tools/slides-to-html.mjs --in docs/slides.md --out docs/slides.html
 *
 * In the browser:
 *   -> / space / page down   next slide
 *   <- / page up             previous slide
 *   n                       show or hide the speaker notes
 *   f                       full screen
 *   ?                       show the shortcuts
 *   ctrl/cmd + p            print, which is how the PDF is produced
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const input = path.resolve(repo, option("in", "docs/slides.md"));
const output = path.resolve(repo, option("out", "docs/slides.html"));

// ------------------------------------------------------------------- parsing

/**
 * Splits the file into slides.
 *
 * A slide starts after a line of three dashes. Anything before the first
 * `---` is the deck title and is dropped. Inside a slide, a line of `Notes:`
 * starts the speaker notes, which run to the end of the slide.
 */
function parse(source) {
  const chunks = source
    .split(/^---[ \t]*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  return chunks.map((chunk) => {
    const lines = chunk.split("\n");
    const body = [];
    const notes = [];
    let inNotes = false;

    for (const line of lines) {
      if (!inNotes && /^notes\s*:\s*$/i.test(line.trim())) {
        inNotes = true;
        continue;
      }
      if (inNotes) notes.push(line);
      else body.push(line);
    }

    return {
      body: body.join("\n").trim(),
      notes: notes.join("\n").trim(),
    };
  });
}

// ------------------------------------------------------------- tiny markdown
//
// Only what a slide needs: headings, bullets, bold, italics, inline code,
// links, blockquotes, horizontal rules and paragraphs. Anything more is
// printed as it was written, which is fine for a talk.

// A placeholder for inline code, so the other replacements leave it alone.
const SENTINEL = "\u0000";

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(text) {
  let out = escapeHtml(text);

  // Inline code first, so its contents are not touched by the others.
  const code = [];
  out = out.replace(/`([^`]+)`/g, (_, body) => {
    code.push(body);
    return `${SENTINEL}${code.length - 1}${SENTINEL}`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");

  out = out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${code[Number(index)]}</code>`);

  return out;
}

function render(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let list = null;

  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(---|===)$/.test(trimmed)) {
      closeList();
      html.push("<hr>");
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      if (list !== "ul") {
        closeList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (list !== "ol") {
        closeList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inline(trimmed)}</p>`);
  }

  closeList();
  return html.join("\n");
}

// ------------------------------------------------------------------ the page

const STYLES = `
  :root {
    --bg: #0d0d10;
    --panel: #16161b;
    --ink: #ececf1;
    --muted: #9a9aa6;
    --accent: #6f8bff;
    --bad: #ff7a7a;
    --ok: #6ee7a8;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: 100%;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body { display: flex; flex-direction: column; }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 20px;
    border-bottom: 1px solid #23232b;
    font-size: 12.5px;
    color: var(--muted);
    flex: 0 0 auto;
  }
  header strong { color: var(--ink); font-weight: 600; }
  header .spacer { flex: 1; }
  header button {
    background: #1e1e25;
    color: var(--ink);
    border: 1px solid #2d2d37;
    border-radius: 6px;
    padding: 4px 10px;
    font: inherit;
    cursor: pointer;
  }
  header button:hover { background: #26262f; }
  #stage { flex: 1 1 auto; overflow: hidden; position: relative; }
  .slide {
    display: none;
    height: 100%;
    overflow-y: auto;
    padding: 44px 64px;
  }
  .slide.active { display: block; }
  .slide h1 { font-size: 46px; line-height: 1.15; margin: 0 0 22px; letter-spacing: -0.02em; }
  .slide h2 { font-size: 34px; line-height: 1.2; margin: 0 0 20px; letter-spacing: -0.015em; }
  .slide h3 { font-size: 22px; margin: 26px 0 10px; color: var(--accent); }
  .slide p { font-size: 19px; line-height: 1.55; margin: 0 0 14px; max-width: 60ch; }
  .slide ul, .slide ol { font-size: 19px; line-height: 1.55; margin: 0 0 14px; padding-left: 26px; max-width: 64ch; }
  .slide li { margin-bottom: 9px; }
  .slide li strong { color: var(--accent); }
  .slide blockquote {
    margin: 18px 0;
    padding: 14px 18px;
    border-left: 3px solid var(--accent);
    background: var(--panel);
    border-radius: 0 8px 8px 0;
    font-size: 18px;
    color: #d8d8e2;
  }
  .slide code {
    background: #22222b;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }
  .slide hr { border: 0; border-top: 1px solid #2a2a33; margin: 22px 0; }
  .slide .lead { font-size: 24px; color: #d5d5de; }
  .slide .muted { color: var(--muted); }
  .slide .bad { color: var(--bad); }
  .slide .ok { color: var(--ok); }
  .slide table { border-collapse: collapse; font-size: 17px; margin: 14px 0; }
  .slide th, .slide td { border: 1px solid #2c2c35; padding: 8px 14px; text-align: left; }
  .slide th { background: var(--panel); }
  #notes {
    display: none;
    flex: 0 0 auto;
    max-height: 32vh;
    overflow-y: auto;
    border-top: 1px solid #23232b;
    padding: 14px 64px;
    background: #111116;
    color: #b9b9c5;
    font-size: 14.5px;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  #notes.open { display: block; }
  #notes strong { color: var(--accent); }
  #help {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(8, 8, 11, 0.94);
    color: var(--ink);
    padding: 60px;
    font-size: 17px;
    line-height: 2;
  }
  #help.open { display: block; }
  #help kbd {
    background: #22222b;
    border: 1px solid #33333d;
    border-radius: 5px;
    padding: 2px 9px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 15px;
  }
  @media print {
    @page { size: 1280px 720px; margin: 0; }
    header, #notes, #help { display: none !important; }
    #stage { overflow: visible; }
    .slide {
      display: block !important;
      height: 720px;
      page-break-after: always;
      overflow: hidden;
    }
    body { background: #fff; }
  }
`;

const SCRIPT = `
  const slides = Array.from(document.querySelectorAll(".slide"));
  const notes = document.getElementById("notes");
  const counter = document.getElementById("counter");
  const help = document.getElementById("help");
  let index = 0;

  function show(next) {
    index = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
    counter.textContent = (index + 1) + " / " + slides.length;
    const note = slides[index].dataset.notes || "";
    notes.textContent = note ? "Notes\\n\\n" + note : "";
    location.hash = String(index + 1);
  }

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "ArrowRight":
      case " ":
      case "PageDown":
        show(index + 1);
        break;
      case "ArrowLeft":
      case "PageUp":
        show(index - 1);
        break;
      case "Home":
        show(0);
        break;
      case "End":
        show(slides.length - 1);
        break;
      case "n":
      case "N":
        notes.classList.toggle("open");
        break;
      case "f":
      case "F":
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
        break;
      case "?":
        help.classList.toggle("open");
        break;
      case "Escape":
        help.classList.remove("open");
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  document.getElementById("toggle-notes").addEventListener("click", () => {
    notes.classList.toggle("open");
  });
  document.getElementById("toggle-help").addEventListener("click", () => {
    help.classList.toggle("open");
  });

  const start = Number(location.hash.slice(1));
  show(Number.isFinite(start) && start > 0 ? start - 1 : 0);
`;

const slides = parse(fs.readFileSync(input, "utf8"));

const body = slides
  .map((slide, index) => {
    const notes = slide.notes.replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
    const label = `Slide ${index + 1}`;
    return `      <section class="slide" data-notes="${notes}" aria-label="${label}">
${render(slide.body)}
      </section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pip — iWISE Regional Final</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <header>
      <strong>Pip</strong>
      <span>a lightweight AI assistant window</span>
      <span class="spacer"></span>
      <button id="toggle-notes" type="button">notes</button>
      <button id="toggle-help" type="button">shortcuts</button>
      <span id="counter"></span>
    </header>

    <main id="stage">
${body}
    </main>

    <aside id="notes"></aside>

    <div id="help">
      <p><kbd>→</kbd> <kbd>space</kbd> next &nbsp; <kbd>←</kbd> previous</p>
      <p><kbd>n</kbd> speaker notes &nbsp; <kbd>f</kbd> full screen &nbsp; <kbd>?</kbd> this list</p>
      <p><kbd>cmd</kbd>+<kbd>p</kbd> print to a PDF, one slide per page</p>
      <p>Press <kbd>esc</kbd> to close this.</p>
    </div>

    <script>${SCRIPT}</script>
  </body>
</html>
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);

console.log(`${path.relative(repo, input)} -> ${path.relative(repo, output)}`);
console.log(`${slides.length} slides`);
