// SPDX-License-Identifier: Apache-2.0
/**
 * Secret detection and masking. Used before anything leaves the machine or lands in a shared place:
 * session exports, "report a problem" drafts, memory folders that sync through git, files Claude writes.
 *
 * Precision first: well-known token formats are matched by their documented prefixes and shapes; the
 * generic "password = …" form also needs the value to look random (entropy and mixed characters), so a
 * placeholder such as `password = "changeme"` is not reported. Nothing is ever logged unmasked.
 */

export interface SecretMatch {
  /** Kind of secret, e.g. "github-token". */
  kind: string;
  start: number;
  end: number;
  /** A masked preview that is safe to show and store. */
  masked: string;
  /** high: a documented token format · medium: a generic assignment that looks random. */
  confidence: 'high' | 'medium';
}

interface Pattern {
  kind: string;
  re: RegExp;
  /** Characters kept visible at the start of the secret (its documented prefix). */
  keep: number;
  confidence: 'high' | 'medium';
  /** Capture group that holds the secret itself, when the match includes surrounding text. */
  group?: number;
}

const PATTERNS: Pattern[] = [
  {
    kind: 'private-key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    keep: 0,
    confidence: 'high',
  },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, keep: 7, confidence: 'high' },
  { kind: 'openai-key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g, keep: 3, confidence: 'high' },
  { kind: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g, keep: 4, confidence: 'high' },
  { kind: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, keep: 6, confidence: 'high' },
  { kind: 'aws-access-key-id', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, keep: 4, confidence: 'high' },
  { kind: 'aws-secret-key', re: /\baws_secret_access_key\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})\b/gi, keep: 0, confidence: 'high', group: 1 },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, keep: 4, confidence: 'high' },
  { kind: 'google-oauth-secret', re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g, keep: 7, confidence: 'high' },
  { kind: 'slack-token', re: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g, keep: 5, confidence: 'high' },
  { kind: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/g, keep: 34, confidence: 'high' },
  { kind: 'stripe-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/g, keep: 8, confidence: 'high' },
  { kind: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g, keep: 4, confidence: 'high' },
  { kind: 'pypi-token', re: /\bpypi-[A-Za-z0-9_-]{50,}\b/g, keep: 5, confidence: 'high' },
  { kind: 'huggingface-token', re: /\bhf_[A-Za-z0-9]{34,}\b/g, keep: 3, confidence: 'high' },
  { kind: 'telegram-bot-token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, keep: 0, confidence: 'high' },
  {
    kind: 'url-credentials',
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|https?|ftp):\/\/[^\s:/@"']+:([^\s@/"']{6,})@/g,
    keep: 0,
    confidence: 'high',
    group: 1,
  },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, keep: 3, confidence: 'medium' },
  {
    kind: 'assigned-secret',
    re: /\b(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|token)\b["']?\s*[:=]\s*["']?([^\s"',;]{12,})/gi,
    keep: 0,
    confidence: 'medium',
    group: 1,
  },
];

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const chars = [...s];
  if (!chars.length) return 0;
  const counts = new Map<string, number>();
  for (const ch of chars) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / chars.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER =
  /^(?:x{4,}|\*{4,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\$[A-Z_]+|%[A-Z_]+%|your[_-]?\w*|change[_-]?me\w*|example\w*|placeholder\w*|dummy\w*|test\w*|sample\w*|redacted\w*|todo\w*|null|none|undefined|true|false)$/i;

/** A generic value counts as a secret only when it is long, varied and not an obvious placeholder. */
function looksRandom(v: string): boolean {
  if (PLACEHOLDER.test(v)) return false;
  if (/^(?:process\.env|os\.environ|import\.meta|env\(|getenv|config\.|settings\.)/i.test(v)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(v)).length;
  return classes >= 2 && entropy(v) >= 3.5;
}

function mask(secret: string, keep: number): string {
  const visible = secret.slice(0, Math.min(keep, Math.max(0, secret.length - 4)));
  const tail = secret.length > 12 ? secret.slice(-2) : '';
  return `${visible}•••${tail} (${secret.length})`;
}

/** Finds secrets in text. Overlapping matches keep the most specific (earliest pattern in the list). */
export function scanSecrets(text: string): SecretMatch[] {
  const out: SecretMatch[] = [];
  const taken: [number, number][] = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      const full = m[0];
      const secret = p.group !== undefined ? m[p.group] : full;
      if (!secret) continue;
      const offset = p.group !== undefined ? full.indexOf(secret) : 0;
      const start = (m.index ?? 0) + Math.max(0, offset);
      const end = start + secret.length;
      if (overlaps(start, end)) continue;
      if (p.confidence === 'medium' && p.kind === 'assigned-secret' && !looksRandom(secret)) continue;
      taken.push([start, end]);
      out.push({ kind: p.kind, start, end, masked: mask(secret, p.keep), confidence: p.confidence });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Returns the text with every detected secret replaced by its masked form. */
export function maskSecrets(text: string): string {
  const found = scanSecrets(text);
  if (!found.length) return text;
  let out = '';
  let at = 0;
  for (const f of found) {
    out += text.slice(at, f.start) + `[${f.kind}: ${f.masked}]`;
    at = f.end;
  }
  return out + text.slice(at);
}
