import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { mergeParts, promptHeader, tidy } from "./lib/markdown";
import {
  allTemplates,
  loadCustomTemplates,
  saveCustomTemplates,
  templateId,
  type Template,
} from "./lib/templates";
import { estimateTokens, formatTokens, savedPercent } from "./lib/tokens";
import type { ConvertResult, SidecarStatus } from "./lib/types";

type Item = {
  id: string;
  path: string;
  name: string;
  pages: number;
  pageSpec: string;
  original: string;
  text: string;
  rawTokens: number;
  markdownTokens: number;
  bytes: number;
  truncated: boolean;
  /** The file has content but nothing to read — a scan or an image. */
  noTextLayer: boolean;
};

const FILE_FILTERS = [
  {
    name: "Documents",
    extensions: ["pdf", "docx", "pptx", "xlsx", "csv", "html", "htm", "md", "txt"],
  },
];

function newId(path: string, pageSpec: string): string {
  return `${path}::${pageSpec}`;
}

type Props = {
  /** True while a file is hovering over the window. */
  dragging: boolean;
  /** Files that were just dropped, waiting to be converted. */
  dropped: { paths: string[]; id: number } | null;
  /** Called once the dropped files have been picked up. */
  onDroppedHandled: () => void;
};

export default function Documents({ dragging, dropped, onDroppedHandled }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mergeAll, setMergeAll] = useState(false);
  const [sidecar, setSidecar] = useState<SidecarStatus | null>(null);

  // The instruction goes above the document in the prompt. It is kept separate
  // from the document body so both stay editable.
  const [instruction, setInstruction] = useState("");
  const [customTemplates, setCustomTemplates] = useState<Template[]>(loadCustomTemplates);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const counter = useRef(0);

  useEffect(() => {
    invoke<SidecarStatus>("sidecar_status").then(setSidecar).catch(() => setSidecar(null));
  }, []);

  const convert = useCallback(async (path: string, pageSpec = "") => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await invoke<ConvertResult>("convert_document", {
        path,
        pages: pageSpec || null,
      });

      const id = newId(path, pageSpec);
      counter.current += 1;

      const item: Item = {
        id,
        path: result.source || path,
        name: result.name || path.split("/").pop() || path,
        pages: result.pages,
        pageSpec,
        original: result.markdown,
        text: result.markdown,
        rawTokens: result.rawTokens,
        markdownTokens: result.markdownTokens,
        bytes: result.bytes,
        truncated: result.truncated,
        noTextLayer: Boolean(result.noTextLayer),
      };

      setItems((previous) => {
        const without = previous.filter((entry) => entry.id !== id);
        return [...without, item];
      });
      setActiveId(id);

      if (result.noTextLayer) {
        // The panel below says this in more detail; a second copy of it
        // would just be noise.
        setNotice(null);
      } else if (result.truncated) {
        setNotice("That document was too long, so it was cut off. Check the preview.");
      }
      if (pageSpec && !result.noTextLayer) {
        setNotice(`Read pages ${pageSpec}.`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // Files dropped anywhere in the window arrive here. They may have been
  // dropped while another tab was showing, which is why the window owns the
  // drop handler and hands the paths over.
  useEffect(() => {
    if (!dropped) return;
    for (const path of dropped.paths) {
      void convert(path);
    }
    onDroppedHandled();
  }, [dropped, convert, onDroppedHandled]);

  async function pickFiles() {
    try {
      const picked = await open({ multiple: true, filters: FILE_FILTERS });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      for (const path of paths) {
        await convert(path);
      }
    } catch (err) {
      setError(String(err));
    }
  }

  function updateText(id: string, text: string) {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, text } : item)),
    );
  }

  function setPages(item: Item, spec: string) {
    if (item.pageSpec === spec) return;
    void convert(item.path, spec);
  }

  function remove(id: string) {
    setItems((previous) => previous.filter((item) => item.id !== id));
    if (activeId === id) setActiveId(null);
  }

  const active = items.find((item) => item.id === activeId) ?? null;

  const sending = useMemo(() => {
    const parts = (mergeAll ? items : active ? [active] : [])
      .filter((item) => item.text.trim().length > 0)
      .map((item) => ({ name: item.name, text: item.text.trim() }));

    if (parts.length === 0) return { text: "", tokens: 0, parts };

    const head = [instruction.trim(), promptHeader(parts)].filter(Boolean).join("\n\n");
    const text = head + mergeParts(parts);
    return { text, tokens: estimateTokens(text), parts };
  }, [items, active, mergeAll, instruction]);

  function applyTemplate(id: string) {
    setSelectedTemplate(id);
    const template = allTemplates(customTemplates).find((entry) => entry.id === id);
    if (template) setInstruction(template.prompt);
  }

  function saveCurrentAsTemplate() {
    const text = instruction.trim();
    if (!text) {
      setError("Write an instruction first, then save it as a template.");
      return;
    }

    const name = window.prompt("Name this prompt template");
    if (!name || !name.trim()) return;

    const template: Template = {
      id: templateId(name),
      name: name.trim(),
      prompt: text,
      builtin: false,
    };
    const next = [...customTemplates, template];
    setCustomTemplates(next);
    saveCustomTemplates(next);
    setSelectedTemplate(template.id);
    setNotice(`Saved the template "${template.name}".`);
  }

  function deleteSelectedTemplate() {
    const template = allTemplates(customTemplates).find((entry) => entry.id === selectedTemplate);
    if (!template || template.builtin) return;

    const next = customTemplates.filter((entry) => entry.id !== template.id);
    setCustomTemplates(next);
    saveCustomTemplates(next);
    setSelectedTemplate("");
  }

  // The baseline is what the same document would cost if it were pasted by
  // hand, straight out of Word or a PDF viewer.
  const baseline = useMemo(() => {
    if (mergeAll) return items.reduce((total, item) => total + item.rawTokens, 0);
    return active?.rawTokens ?? 0;
  }, [items, active, mergeAll]);

  const markdownTotal = useMemo(() => {
    if (mergeAll) return items.reduce((total, item) => total + item.markdownTokens, 0);
    return active?.markdownTokens ?? 0;
  }, [items, active, mergeAll]);

  const percent = savedPercent(baseline, sending.tokens);

  async function sendToChat() {
    if (!sending.text.trim()) return;
    setError(null);
    try {
      await invoke("inject_into_chat", { text: sending.text });
      setNotice("Sent to the chat window.");
    } catch (err) {
      setError(String(err));
    }
  }

  async function copyToClipboard() {
    if (!sending.text.trim()) return;
    try {
      await navigator.clipboard.writeText(sending.text);
      setNotice("Copied to the clipboard.");
    } catch {
      setError("Could not reach the clipboard.");
    }
  }

  return (
    <section className="card docs">
      <div className="timer-head">
        <h2>Documents</h2>
        <span className={busy ? "pill live" : "pill"}>{busy ? "working" : "ready"}</span>
      </div>

      {sidecar && !sidecar.ready && <p className="bad">{sidecar.detail}</p>}

      <div
        className={dragging ? "dropzone over" : "dropzone"}
        onClick={() => void pickFiles()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") void pickFiles();
        }}
      >
        <strong>Drop a file here</strong>
        <span className="muted">
          PDF, DOCX, PPTX, XLSX, CSV, HTML, TXT, MD — or click to choose
        </span>
      </div>

      {items.length > 0 && (
        <div className="doclist">
          {items.map((item) => (
            <div
              key={item.id}
              className={item.id === activeId ? "docitem on" : "docitem"}
              onClick={() => setActiveId(item.id)}
            >
              <div className="docname">
                <span title={item.path}>{item.name}</span>
                <button className="x" title="Remove" onClick={(event) => {
                  event.stopPropagation();
                  remove(item.id);
                }}>
                  ×
                </button>
              </div>
              <div className="docmeta">
                {item.pages > 0 && <span>{item.pages} pages</span>}
                {item.noTextLayer ? (
                  <span className="bad">no text</span>
                ) : (
                  <span>~{formatTokens(item.markdownTokens)} tokens</span>
                )}
                {item.pageSpec && <span className="tag">pages {item.pageSpec}</span>}
                {item.truncated && <span className="bad">truncated</span>}
              </div>
              {item.pages > 0 && item.id === activeId && (
                <div className="pagesel">
                  <label>
                    pages
                    <input
                      value={item.pageSpec}
                      placeholder="1-3,5"
                      spellCheck={false}
                      onChange={(event) => setPages(item, event.currentTarget.value)}
                    />
                  </label>
                  <span className="muted">blank sends the whole file</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {items.length > 1 && (
        <label className="merge">
          <input
            type="checkbox"
            checked={mergeAll}
            onChange={(event) => setMergeAll(event.currentTarget.checked)}
          />
          Merge every file into one prompt
        </label>
      )}

      {items.length > 0 && (
        <div className="templates">
          <select
            value={selectedTemplate}
            onChange={(event) => applyTemplate(event.currentTarget.value)}
          >
            <option value="">Prompt template…</option>
            {allTemplates(customTemplates).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button title="Save this instruction as a template" onClick={saveCurrentAsTemplate}>
            +
          </button>
          {selectedTemplate &&
            !allTemplates(customTemplates).find((entry) => entry.id === selectedTemplate)?.builtin && (
              <button title="Delete this template" onClick={deleteSelectedTemplate}>
                ×
              </button>
            )}
        </div>
      )}

      {items.length > 0 && (
        <textarea
          className="instruction"
          value={instruction}
          spellCheck={false}
          placeholder="Instruction for the AI (optional)"
          onChange={(event) => setInstruction(event.currentTarget.value)}
        />
      )}

      {active && !mergeAll && (
        <>
          <div className="editor-head">
            <span className="muted">Preview — edit before sending</span>
            <button
              className="link"
              onClick={() => updateText(active.id, tidy(active.original))}
              title="Undo your edits"
            >
              reset
            </button>
          </div>
          <textarea
            className="editor"
            value={active.text}
            spellCheck={false}
            onChange={(event) => updateText(active.id, event.currentTarget.value)}
          />
        </>
      )}

      {mergeAll && (
        <div className="editor-head">
          <span className="muted">Merged prompt</span>
        </div>
      )}
      {mergeAll && (
        <pre className="merged">{sending.text}</pre>
      )}

      {sending.parts.length > 0 && (
        <div className="readout">
          <div>
            <span className="label">paste by hand</span>
            <span className="value">{baseline > 0 ? `~${formatTokens(baseline)}` : "—"}</span>
          </div>
          <div>
            <span className="label">clean markdown</span>
            <span className="value">~{formatTokens(markdownTotal)}</span>
          </div>
          <div className="highlight">
            <span className="label">you send</span>
            <span className="value">~{formatTokens(sending.tokens)}</span>
          </div>
        </div>
      )}

      {percent > 0 && (
        <p className="ok">
          {percent}% fewer tokens than pasting the file by hand
          {baseline > sending.tokens ? " — pages were trimmed" : ""}.
        </p>
      )}
      {sending.parts.length > 0 && percent === 0 && baseline > 0 && (
        <p className="muted">
          About the same size as the raw text, but structured — which is what the model
          actually needs.
        </p>
      )}
      {sending.parts.length > 0 && baseline === 0 && (
        <p className="muted">
          There is no plain-text version to compare against for this file, so only the
          markdown and the final prompt are counted.
        </p>
      )}

      {active?.noTextLayer && (
        <p className="bad">
          There is no text in this file. It is probably a scan or a picture — Pip reads
          text, not images, so it cannot convert it. Open it and copy the text by hand.
        </p>
      )}

      {error && <p className="bad">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <div className="actions">
        <button className="primary" onClick={() => void sendToChat()} disabled={!sending.text.trim()}>
          Send to chat
        </button>
        <button onClick={() => void copyToClipboard()} disabled={!sending.text.trim()}>
          Copy
        </button>
        <button
          onClick={() => {
            setItems([]);
            setActiveId(null);
            setNotice(null);
          }}
          disabled={items.length === 0}
        >
          Clear
        </button>
      </div>
    </section>
  );
}
