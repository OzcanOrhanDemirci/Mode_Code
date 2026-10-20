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
import { readText, writeAtomic } from '../../node/fsx.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Muted, Note, Row, Section, Table, useEnv, useHints, useScreenKeys, useT } from '../ui.js';
import { LinkList, type Link } from '../widgets.js';
import type { MessageKey } from '../../core/i18n/index.js';
import { evidenceText, flowTitle, statusText } from '../../core/flow-view.js';
import { stepName } from '../../core/guidance.js';
import { activeTime, nextStep as nextRunStep, progress as runProgress } from '../../core/run.js';
import { durationText } from '../../core/run-report.js';

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
    address: `memory/sessions/${s.id}`,
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
  const exportIt = () => {
    if (!s) return;
    try {
      const path = exportSession(s, data.layout.root);
      setExported(path);
      flash(t('session.exported'), 'ok');
    } catch (err) {
      flash(t('session.exportFailed', { detail: (err as Error).message }), 'bad');
    }
  };
  useScreenKeys((input) => {
    if (input === 'e' && s) {
      exportIt();
      return true;
    }
    return false;
  }, open);
  useHints([{ key: 'e', label: t('keys.export'), run: exportIt }], open && !!s);
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

/** A flow: where it stands, what each step's check found, the commands that verify it, its files, what happened. */
export function FlowCard({ id, width }: ScreenProps & { id: string }) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const f = data.flows().find((x) => x.id === id);
  if (!f) return <Empty>{t('flow.missing')}</Empty>;
  const files = data.flowFiles(f);
  const fileRows: [MessageKey, string | null][] = [
    ['flow.card.report', files.report],
    ['flow.card.plan', files.plan],
    ['flow.card.checkedReport', files.checkedReport],
    ['flow.card.approvedPlan', files.approvedPlan],
  ];
  const wide = Math.max(20, width - 24);
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        <Row label={t('flow.card.task')}>{f.task ? flowTitle(f, wide) : t('flow.noTask')}</Row>
        <Row label={t('flow.card.status')} {...(f.status === 'waiting' ? { color: theme.warn } : {})}>
          {statusText(f.status, lang)}
        </Row>
        <Row label={t('flow.card.folder')}>{shortPath(f.cwd, homedir(), wide)}</Row>
        <Row label={t('flow.card.updated')}>{ago(f.updatedAt, now, lang)}</Row>
      </Section>
      <Section title={t('flow.card.steps')}>
        {f.steps.map((s, i) => (
          <Box key={i}>
            <Box width={3} flexShrink={0}>
              <Text color={s.status === 'done' ? theme.ok : s.status === 'active' ? theme.warn : theme.muted}>
                {s.status === 'done' ? '✓' : s.status === 'active' ? '▶' : '·'}
              </Text>
            </Box>
            <Box width={16} flexShrink={0}>
              <Text>{stepName(s.kind, lang)}</Text>
            </Box>
            <Text color={theme.muted} wrap="truncate-end">
              {s.evidence ? evidenceText(s.evidence, lang) : t(`flow.step.status.${s.status}` as MessageKey)}
            </Text>
          </Box>
        ))}
      </Section>
      {f.verification.length ? (
        <Section title={t('flow.card.verification')}>
          {f.verification.map((v, i) => (
            <Text key={i} color={theme.accent} wrap="truncate-end">
              {v}
            </Text>
          ))}
        </Section>
      ) : null}
      {fileRows.some(([, p]) => p) ? (
        <Section title={t('flow.card.files')}>
          {fileRows.map(([k, p]) =>
            p ? (
              <Row key={k} label={t(k)}>
                {shortPath(p, homedir(), wide)}
              </Row>
            ) : null,
          )}
        </Section>
      ) : null}
      <Section title={t('flow.card.history')}>
        {f.history
          .slice(-6)
          .reverse()
          .map((h, i) => (
            <Box key={i}>
              <Box width={14} flexShrink={0}>
                <Text color={theme.muted}>{ago(h.at, now, lang)}</Text>
              </Box>
              <Text wrap="truncate-end">
                {t(`flow.history.${h.event}` as MessageKey)}
                {h.step ? ` · ${stepName(h.step, lang)}` : ''}
              </Text>
            </Box>
          ))}
      </Section>
    </Box>
  );
}

/** A full-autonomy run: where it stands, its milestones and the ways back, what waits for the person, its files. */
export function RunCard({ id, width }: ScreenProps & { id: string }) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const r = data.runs().find((x) => x.id === id);
  if (!r) return <Empty>{t('run.missing')}</Empty>;
  const files = data.runFiles(r);
  const wide = Math.max(20, width - 24);
  const status =
    r.status === 'paused' && r.pause
      ? t('auto.report.statusPaused', { reason: t(`auto.pause.${r.pause.reason}` as MessageKey) })
      : t(`auto.status.${r.status}` as MessageKey);
  const p = runProgress(r);
  const next = nextRunStep(r);
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        <Row label={t('auto.report.task')}>{(r.task || r.id).split('\n')[0]!.slice(0, wide)}</Row>
        <Row label={t('auto.report.status')} {...(r.status === 'paused' || r.status === 'stuck' ? { color: theme.warn } : {})}>
          {`${status} · ${r.phase === 'plan' || !r.plan ? t('auto.phase.plan') : next ? `${p.done}/${p.of}` : t('auto.phase.finish')}`}
        </Row>
        <Row label={t('auto.report.folder')}>{shortPath(r.cwd, homedir(), wide)}</Row>
        <Row label={t('auto.report.time')}>{`${durationText(activeTime(r, now), lang)} · ${ago(r.updatedAt, now, lang)}`}</Row>
        <Row label={t('auto.cli.budget')}>{`${r.budget.weeklyTarget}% (${r.budget.source})`}</Row>
      </Section>
      {r.plan ? (
        <Section title={t('auto.report.milestones')}>
          {r.plan.steps.map((s) => {
            const m = r.milestones.find((x) => x.n === s.n);
            return (
              <Box key={s.n}>
                <Box width={3} flexShrink={0}>
                  <Text color={m ? theme.ok : next?.n === s.n ? theme.warn : theme.muted}>{m ? '✓' : next?.n === s.n ? '▶' : '·'}</Text>
                </Box>
                <Box width={Math.max(10, Math.min(40, wide - 30))} flexShrink={0}>
                  <Text wrap="truncate-end">{`${s.n}. ${s.title}`}</Text>
                </Box>
                <Text color={theme.muted} wrap="truncate-end">
                  {m ? `${m.commit.slice(0, 12)} · ${t(`auto.verdict.${m.review.verdict}` as MessageKey)}` : ''}
                </Text>
              </Box>
            );
          })}
        </Section>
      ) : null}
      {r.deferred.length ? (
        <Section title={t('auto.report.deferred')}>
          {r.deferred.map((d, i) => (
            <Text key={i} wrap="truncate-end">
              <Text color={theme.warn}>{t(`auto.defer.${d.kind}` as MessageKey)}</Text> <Text color={theme.accent}>{d.what}</Text>
              {d.count > 1 ? <Text color={theme.muted}>{` ×${d.count}`}</Text> : null}
            </Text>
          ))}
        </Section>
      ) : null}
      {r.blockers.length ? (
        <Section title={t('auto.report.blockers')}>
          {r.blockers.map((b, i) => (
            <Text key={i} wrap="truncate-end">{`${t(`auto.blocker.${b.kind}` as MessageKey)}: ${b.text}`}</Text>
          ))}
        </Section>
      ) : null}
      <Section title={t('flow.card.files')}>
        {(
          [
            ['auto.cli.fileReport', files.report],
            ['auto.cli.filePlan', files.plan],
            ['auto.cli.fileDrafts', files.drafts],
            ['auto.cli.fileNotes', files.notes],
          ] as [MessageKey, string | null][]
        ).map(([k, path]) =>
          path ? (
            <Row key={k} label={t(k)}>
              {shortPath(path, homedir(), wide)}
            </Row>
          ) : null,
        )}
        <Muted>{t('run.rollbackHint', { id: r.id })}</Muted>
      </Section>
    </Box>
  );
}

/** Working › Full-autonomy runs before there is one: what full autonomy is, and how a run starts. */
export function RunsEmpty({ width }: ScreenProps) {
  const t = useT();
  return (
    <Box flexDirection="column" width={width}>
      <Muted wrap="wrap">{t('runs.empty')}</Muted>
      <Box marginTop={1}>
        <Note>{t('runs.howTo')}</Note>
      </Box>
    </Box>
  );
}

/** Working › Flows before there is one: what a flow is and how to start one. */
export function FlowsEmpty({ width }: ScreenProps) {
  const t = useT();
  return (
    <Box flexDirection="column" width={width}>
      <Muted wrap="wrap">{t('flows.empty')}</Muted>
      <Box marginTop={1}>
        <Note>{t('flows.howTo')}</Note>
      </Box>
    </Box>
  );
}

/** Memory and projects › Handoffs: one handoff note, as it is kept in the memory (docs/memory.md). */
export function HandoffCard({ path, width }: ScreenProps & { path: string }) {
  const { data, lang } = useEnv();
  const t = useT();
  const item = data.handoffs().find((h) => h.path === path);
  const text = readText(path) ?? '';
  const body = text.replace(/^---[\s\S]*?\n---\n+/, '');
  return (
    <Box flexDirection="column" width={width}>
      {item ? (
        <Section>
          <Row label={t('handoff.project')}>{item.project}</Row>
          <Row label={t('handoff.when')}>{`${dateTime(item.at, lang)}${item.machine ? ` · ${item.machine}` : ''}`}</Row>
          <Row label={t('handoff.why')}>{t(`handoff.trigger.${item.trigger}` as MessageKey)}</Row>
          <Row label={t('handoff.file')}>{shortPath(path, homedir(), width - 24)}</Row>
        </Section>
      ) : null}
      <Text wrap="wrap">{body.split('\n').slice(0, 60).join('\n')}</Text>
    </Box>
  );
}

/** Memory and projects › Handoffs before there is one: what a handoff note is and how one is written. */
export function HandoffsEmpty({ width }: ScreenProps) {
  const t = useT();
  return (
    <Box flexDirection="column" width={width}>
      <Muted wrap="wrap">{t('handoff.empty')}</Muted>
      <Box marginTop={1}>
        <Note>{t('handoff.howTo')}</Note>
      </Box>
    </Box>
  );
}
