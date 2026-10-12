// SPDX-License-Identifier: Apache-2.0
/** Projects and sessions: where work happened and what each session did. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ago, compact, dateTime, duration, integer, percent, shortPath } from '../../core/format.js';
import { maskSecrets } from '../../core/secrets/scan.js';
import { cacheHitRate, type SessionRow } from '../../node/index-db.js';
import { repoStatus, git } from '../../node/git.js';
import { readTail } from '../../node/tail.js';
import { writeAtomic } from '../../node/fsx.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Muted, Note, Row, Section, Table, useEnv, useScreenKeys, useT } from '../ui.js';
import { LinkList, type Link } from '../widgets.js';

export function ProjectCard({ cwd, width, height, open }: ScreenProps & { cwd: string }) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const sessions = data.sessions({ cwd, limit: 100 });
  const project = data.config().projects.find((p) => p.path && p.path.replace(/\\/g, '/').toLowerCase() === cwd.replace(/\\/g, '/').toLowerCase());
  const repo = open ? repoStatus(cwd) : null;
  const branch = open && repo?.isRepo ? git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).out : null;
  const tokens = sessions.reduce((n, s) => n + s.tokens, 0);
  const links: Link[] = sessions.map((s) => ({
    key: s.id,
    label: s.title ?? s.firstPrompt ?? s.id.slice(0, 8),
    right: `${compact(s.tokens, lang)} · ${ago(s.lastTs, now, lang)}`,
    address: `sessions/${s.id}`,
  }));
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        <Row label={t('project.folder')}>{shortPath(cwd, homedir(), width - 24)}</Row>
        {project ? <Row label={t('project.keyword')}>{project.names.map((n) => `${n} devam`).join(', ')}</Row> : null}
        <Row label={t('project.sessions')}>{integer(sessions.length, lang)}</Row>
        <Row label={t('project.last')}>{sessions[0] ? ago(sessions[0].lastTs, now, lang) : '?'}</Row>
        <Row label={t('project.tokens')}>{compact(tokens, lang)}</Row>
        {repo ? (
          <Row label={t('project.git')} {...(repo.dirty ? { color: theme.warn } : {})}>
            {repo.isRepo
              ? `${branch || '?'} · ${repo.dirty ? t('project.dirty', { n: repo.dirty }) : t('project.clean')}${repo.ahead ? ' · ' + t('project.ahead', { n: repo.ahead }) : ''}`
              : t('project.noGit')}
          </Row>
        ) : (
          <Row label={t('project.git')}>
            <Text color={theme.muted}>{t('project.openForGit')}</Text>
          </Row>
        )}
      </Section>
      <Section title={t('project.recent')}>
        <LinkList items={links} height={Math.max(3, height - 12)} width={width} open={open} emptyText={t('cli.sessions.none')} />
      </Section>
    </Box>
  );
}

export function SessionCard({ id, width, height, open }: ScreenProps & { id: string }) {
  const { data, lang, now, theme, flash } = useEnv();
  const t = useT();
  const [exported, setExported] = useState<string | null>(null);
  const s = data.session(id);
  const totals = data.sessionTotals(id);
  const tools = open ? data.tools({ session: id }) : [];
  useScreenKeys((input) => {
    if (input === 'e' && s) {
      try {
        const path = exportSession(s, data.layout.root);
        setExported(path);
        flash(t('session.exported'), 'ok');
      } catch (err) {
        flash(t('session.exportFailed', { detail: (err as Error).message }), 'bad');
      }
      return true;
    }
    return false;
  }, open);
  if (!s) return <Empty>{t('session.missing')}</Empty>;
  const all = totals ? totals.input + totals.cacheWrite + totals.cacheRead + totals.output : 0;
  const hit = totals ? cacheHitRate(totals) : null;
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        <Text bold wrap="wrap">
          {s.title ?? t('session.untitled')}
        </Text>
        {s.firstPrompt ? <Muted>“{s.firstPrompt}”</Muted> : null}
      </Section>
      <Section>
        <Row label={t('session.folder')}>{shortPath(s.cwd, homedir(), width - 24)}</Row>
        <Row label={t('session.when')}>{`${dateTime(s.firstTs, lang)} · ${duration(s.lastTs - s.firstTs, lang)} · ${ago(s.lastTs, now, lang)}`}</Row>
        <Row label={t('session.prompts')}>{integer(s.prompts, lang)}</Row>
        <Row
          label={t('session.model')}
        >{`${s.model ?? '?'}${s.version ? ' · Claude Code ' + s.version : ''}${s.branch && s.branch !== 'HEAD' ? ' · ' + s.branch : ''}`}</Row>
        <Row label={t('session.tokens')}>
          {totals
            ? `${compact(all, lang)} · ${t('tokens.output').toLowerCase()} ${compact(totals.output, lang)} · ${t('tokens.cacheHit').toLowerCase()} ${hit === null ? '?' : percent(hit * 100, lang)}`
            : '?'}
        </Row>
        {totals && totals.agentTokens ? <Row label={t('tokens.agents')}>{compact(totals.agentTokens, lang)}</Row> : null}
        <Row label={t('session.tools')} {...(s.toolErrors ? { color: theme.warn } : {})}>
          {t('session.toolsText', { n: s.tools, e: s.toolErrors })}
        </Row>
        <Row label="id">
          <Text color={theme.muted}>{s.id}</Text>
        </Row>
      </Section>
      {open && tools.length ? (
        <Section title={t('session.toolsTitle')}>
          <Table
            widths={[22, 8, 8]}
            right={[1, 2]}
            rows={[
              [t('tools.tool'), t('tools.calls'), t('tools.errors')],
              ...tools.slice(0, Math.max(3, height - 22)).map((x) => [x.name, String(x.calls), String(x.errors)]),
            ]}
          />
        </Section>
      ) : null}
      {exported ? <Note kind="ok">{t('session.exportedTo', { path: exported })}</Note> : open ? <Muted>{t('session.exportHint')}</Muted> : null}
    </Box>
  );
}

/** Writes the session's conversation as Markdown, with secrets masked, under the data folder's exports. */
export function exportSession(s: SessionRow, root: string): string {
  if (!s.file) throw new Error('no transcript');
  const lines = readTail(s.file, 64 * 1024 * 1024);
  const out: string[] = [
    `# ${maskSecrets(s.title ?? s.id)}`,
    '',
    `- session: ${s.id}`,
    `- folder: ${s.cwd ?? '?'}`,
    `- started: ${new Date(s.firstTs).toISOString()}`,
    '',
  ];
  for (const l of lines) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(l) as Record<string, unknown>;
    } catch {
      continue;
    }
    if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain === true || o.isMeta === true) continue;
    const c = (o.message as Record<string, unknown> | undefined)?.content;
    const texts =
      typeof c === 'string'
        ? [c]
        : Array.isArray(c)
          ? (c as Record<string, unknown>[]).flatMap((b) =>
              b?.type === 'text' ? [String(b.text ?? '')] : b?.type === 'tool_use' ? [`\`[tool: ${String(b.name)}]\``] : [],
            )
          : [];
    const text = texts.join('\n').trim();
    if (!text) continue;
    out.push(`## ${o.type === 'user' ? 'Person' : 'Claude'}`, '', maskSecrets(text), '');
  }
  const path = join(root, 'exports', `${s.id}.md`);
  writeAtomic(path, out.join('\n'));
  return path;
}

export function sessionLabel(s: SessionRow): string {
  return s.title ?? s.firstPrompt ?? s.id.slice(0, 8);
}
