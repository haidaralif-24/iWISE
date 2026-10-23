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
};

export type SidecarStatus = {
  ready: boolean;
  /** "bundled" for a shipped helper, "script" for a development checkout. */
  kind: string;
  program: string;
  target: string;
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
