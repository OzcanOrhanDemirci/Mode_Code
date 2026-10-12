// SPDX-License-Identifier: Apache-2.0
/**
 * Where the tool keeps its data, inside one folder (`~/.terminal-code` by default). Pure: both the mod
 * (through `$.fs`) and Node code (through `node:fs`) compute the same paths from the same folder.
 *
 * Every runtime file has exactly one writer, so no two processes ever race on a file:
 *   config.json                      the person (through the interface or an editor)
 *   state/quota.json                 the mod (the latest rate-limit reading)
 *   state/sessions/<id>.mod.json     the mod (mode, budget, approvals for this session)
 *   state/sessions/<id>.hook.json    the safety-net hook
 *   events/<yyyy-mm>/<id>.<who>.jsonl  one writer per file: belt and keyword events, append-only
 *   index.db                         the control center (session index)
 *   install/manifest.json            the installer (every change it made, so removal undoes exactly that)
 *   state/doctor.json                the maintenance check (its last summary, which the control center shows)
 *   marketplace/                     the installer (the local plugin marketplace Claude Code reads)
 */
import { joinPath } from './paths.js';
import { APP_ID } from './app.js';

export interface Layout {
  root: string;
  config: string;
  stateDir: string;
  quota: string;
  sessionsDir: string;
  eventsDir: string;
  index: string;
  installDir: string;
  manifest: string;
  backupsDir: string;
  marketplace: string;
  pluginDir: string;
  logsDir: string;
}

export function layout(root: string): Layout {
  const marketplace = joinPath(root, 'marketplace');
  return {
    root,
    config: joinPath(root, 'config.json'),
    stateDir: joinPath(root, 'state'),
    quota: joinPath(root, 'state', 'quota.json'),
    sessionsDir: joinPath(root, 'state', 'sessions'),
    eventsDir: joinPath(root, 'events'),
    index: joinPath(root, 'index.db'),
    installDir: joinPath(root, 'install'),
    manifest: joinPath(root, 'install', 'manifest.json'),
    backupsDir: joinPath(root, 'install', 'backups'),
    marketplace,
    pluginDir: joinPath(marketplace, 'plugins', APP_ID),
    logsDir: joinPath(root, 'logs'),
  };
}

/** Session ids come from Claude Code; anything outside this shape is never used in a file name. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function safeId(id: string | undefined | null): string | null {
  return id && SAFE_ID.test(id) ? id : null;
}

export function sessionFile(l: Layout, sessionId: string, writer: 'mod' | 'hook'): string | null {
  const id = safeId(sessionId);
  return id ? joinPath(l.sessionsDir, `${id}.${writer}.json`) : null;
}

/** The event file for a session and a writer, in the month the event happened (UTC). */
export function eventsFile(l: Layout, sessionId: string, writer: 'mod' | 'hook' | 'cli', at: number): string {
  const id = safeId(sessionId) ?? 'unknown';
  const d = new Date(at);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return joinPath(l.eventsDir, month, `${id}.${writer}.jsonl`);
}
