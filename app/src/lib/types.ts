export type ConvertResult = {
  source: string;
  name: string;
  extension: string;
  bytes: number;
  pages: number;
  selectedPages: number[];
  markdown: string;
  rawText: string;
  truncated: boolean;
  markdownChars: number;
  rawChars: number;
  markdownTokens: number;
  rawTokens: number;
  /**
   * True when the document has no text layer at all — a scanned PDF, or an
   * image-only file. The conversion "succeeds" but returns nothing useful, so
   * the UI has to say so rather than showing an empty preview.
   */
  noTextLayer?: boolean;
};

export type SidecarStatus = {
  ready: boolean;
  python: string;
  script: string;
  detail: string;
};

export type PendingApproval = {
  id: string;
  tool: string;
  arguments: unknown;
  reason: string;
  createdAt: string;
};

export type AuditEntry = {
  timestamp: string;
  tool: string;
  arguments: unknown;
  allowed: boolean;
  approved: boolean | null;
  reason: string | null;
  actor: string;
};

export type NoteFile = {
  name: string;
  path: string;
  preview: string;
  modified: string;
  bytes: number;
};
