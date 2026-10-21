/**
 * A layout audit for the Pip UI.
 *
 * Development tool. This is the substitute for looking at a screenshot on a
 * machine where screen capture is not permitted: it reads the rendered page
 * and reports the things a screenshot would reveal — text clipped by its box,
 * content hanging outside the window, controls with no label, and so on.
 *
 * The report is written into the page so `--dump-dom` can pick it up.
 */

export type Finding = {
  kind: string;
  detail: string;
};

/**
 * An error message the app chose to show.
 *
 * These are not problems — a scanned document is *supposed* to say it has no
 * text — so they are reported separately from the layout findings.
 */
export type ShownError = {
  detail: string;
};

function visible(element: Element): boolean {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function describe(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const cls = element.className && typeof element.className === "string"
    ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return `${element.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
}

/** Runs the audit against the rendered page. */
export function audit(): Finding[] {
  const findings: Finding[] = [];

  // The audit box is the app itself when the harness has constrained it to
  // the real window size; otherwise it is the whole viewport.
  const boxSelector = (window as any).__pipAuditBox as string | undefined;
  const box = (boxSelector ? document.querySelector(boxSelector) : null) as HTMLElement | null;
  const boxRect = box?.getBoundingClientRect();
  const width = boxRect?.width ?? window.innerWidth;
  const height = boxRect?.height ?? window.innerHeight;
  const left = boxRect?.left ?? 0;

  // The whole page scrolling sideways means something is too wide.
  const root = document.documentElement;
  if (root.scrollWidth > width + 1) {
    findings.push({
      kind: "page-overflow-x",
      detail: `the page scrolls sideways: scrollWidth ${root.scrollWidth} > viewport ${width}`,
    });
  }
  if (root.scrollHeight > height + 1) {
    findings.push({
      kind: "page-overflow-y",
      detail: `the page scrolls vertically: scrollHeight ${root.scrollHeight} > viewport ${height}`,
    });
  }

  const all = Array.from(document.querySelectorAll("*"));

  for (const element of all) {
    if (!visible(element)) continue;

    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    // Content hanging outside the window.
    if (rect.right > left + width + 1 || rect.left < left - 1) {
      findings.push({
        kind: "outside-window",
        detail: `${describe(element)} spans x ${rect.left.toFixed(0)}..${rect.right.toFixed(0)} in a ${width}px window`,
      });
    }

    // Text clipped horizontally by its own box. A deliberate ellipsis is not
    // a bug — a one-line preview is meant to be cut short.
    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
    const deliberate = style.textOverflow === "ellipsis";
    const hasText = (element.textContent ?? "").trim().length > 0;
    const noChildText = !Array.from(element.children).some(
      (child) => (child.textContent ?? "").trim().length > 0,
    );
    if (
      clipsX &&
      !deliberate &&
      hasText &&
      noChildText &&
      element.scrollWidth > element.clientWidth + 1
    ) {
      findings.push({
        kind: "text-clipped-x",
        detail: `${describe(element)} needs ${element.scrollWidth}px but has ${element.clientWidth}px`,
      });
    }

    // Text clipped vertically by its own box — the most common UI bug in a
    // small fixed window.
    const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
    if (clipsY && element.scrollHeight > element.clientHeight + 1 && element.clientHeight > 0) {
      findings.push({
        kind: "text-clipped-y",
        detail: `${describe(element)} needs ${element.scrollHeight}px but has ${element.clientHeight}px`,
      });
    }

    // A control with no accessible name.
    const tag = element.tagName.toLowerCase();
    if (tag === "button" && !(element.textContent ?? "").trim() && !element.getAttribute("aria-label")) {
      findings.push({
        kind: "button-without-label",
        detail: `${describe(element)} has no text and no aria-label`,
      });
    }

    // A tiny hit target.
    if ((tag === "button" || tag === "select" || tag === "input") && rect.height > 0 && rect.height < 16) {
      findings.push({
        kind: "tiny-control",
        detail: `${describe(element)} is only ${rect.height.toFixed(0)}px tall`,
      });
    }
  }

  return findings;
}

/**
 * The error messages the app is showing, if any.
 *
 * A `.bad` element on its own is an error message. It is also combined with
 * others (`tag bad`), so the class list is matched exactly.
 */
export function shownErrors(): ShownError[] {
  const errors: ShownError[] = [];

  for (const element of Array.from(document.querySelectorAll("*"))) {
    if (!visible(element)) continue;
    if ((element.textContent ?? "").trim() === "") continue;
    const classes = String(element.className ?? "").split(/\s+/).filter(Boolean);
    if (classes.length === 1 && classes[0] === "bad") {
      errors.push({ detail: describe(element) });
    }
  }

  return errors;
}

/**
 * Builds the report and returns it.
 *
 * It deliberately does not touch the DOM: the caller may take a screenshot
 * straight afterwards, and a report element bolted onto the page would show
 * up in it.
 */
export function report(): string {
  const findings = audit();
  const errors = shownErrors();
  const lines: string[] = [];
  const boxSelector = (window as any).__pipAuditBox as string | undefined;
  const box = (boxSelector ? document.querySelector(boxSelector) : null) as HTMLElement | null;
  lines.push(
    `app box:  ${box ? `${box.getBoundingClientRect().width}x${box.getBoundingClientRect().height}` : `viewport ${window.innerWidth}x${window.innerHeight}`}`,
  );
  lines.push(`findings: ${findings.length}`);
  for (const finding of findings) {
    lines.push(`  [${finding.kind}] ${finding.detail}`);
  }
  if (errors.length) {
    lines.push(`errors shown (${errors.length}):`);
    for (const error of errors) {
      lines.push(`  [error] ${error.detail}`);
    }
  }

  // The visible text, so the content can be read without a picture.
  lines.push("--- visible text ---");
  const main = document.querySelector(".body");
  if (main) {
    const text = (main.textContent ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    lines.push(text);
  }

  const output = lines.join("\n");

  return output;
}
