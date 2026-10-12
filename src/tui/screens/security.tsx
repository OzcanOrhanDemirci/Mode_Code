// SPDX-License-Identifier: Apache-2.0
/** Security: the protection's own health, the belt's rules and what they did, testing a command, secrets. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { RULES } from '../../core/belt/rules.js';
import type { BeltDecision, RuleId } from '../../core/belt/types.js';
import { evaluateToolCall } from '../../core/belt/evaluate.js';
import { ago, shortPath } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import { beltContext } from '../../node/context.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Muted, Note, Row, Section, StateMark, useEnv, useScreenKeys, useT } from '../ui.js';
import { TextField } from '../widgets.js';
import { eventTitle } from './home.js';

export function Protection({ width }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const h = data.health();
  const ours = h.env.hooks.filter((x) => x.ours);
  const isWin = process.platform === 'win32';
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        {h.features
          .filter((f) => f.protection || f.id === 'mod')
          .map((f) => (
            <Box key={f.id} flexDirection="column">
              <Box>
                <Box width={24} flexShrink={0}>
                  <Text>{t(`feature.${f.id}` as MessageKey)}</Text>
                </Box>
                <StateMark state={f.state} />
              </Box>
              {f.reason ? (
                <Box marginLeft={24}>
                  <Muted>{t(f.reason.key as MessageKey, f.reason.params)}</Muted>
                </Box>
              ) : null}
            </Box>
          ))}
      </Section>
      <Section title={t('protect.layers')}>
        <Row label={t('protect.layer1')}>{t('protect.layer1Text', { n: ours.length })}</Row>
        <Row label={t('protect.layer2')}>{t('protect.layer2Text')}</Row>
        <Row label={t('protect.layer3')}>{t(isWin ? 'protect.layer3Win' : 'protect.layer3Text')}</Row>
      </Section>
      <Note kind={isWin ? 'warn' : 'info'}>{t(isWin ? 'protect.limitWin' : 'protect.limit')}</Note>
      <Box marginTop={1}>
        <Text color={theme.muted} wrap="wrap">
          {t('protect.self')}
        </Text>
      </Box>
    </Box>
  );
}

export function RuleDetail({ id, width }: ScreenProps & { id: RuleId }) {
  const { data, theme } = useEnv();
  const t = useT();
  const info = RULES[id];
  const cfg = data.config().belt;
  const disabled = !info.locked && cfg.disabled?.includes(id);
  const verdict = cfg.verdicts?.[id] ?? info.verdict;
  const hits = data.events(30).filter((e) => e.rules?.includes(id));
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        <Row label={t('rule.action')} color={verdict === 'deny' ? theme.bad : verdict === 'ask' ? theme.warn : undefined}>
          {disabled ? t('verdict.off') : t(`verdict.${verdict}` as MessageKey)}
          {cfg.verdicts?.[id] ? ` (${t('rule.changed', { from: t(`verdict.${info.verdict}` as MessageKey) })})` : ''}
        </Row>
        <Row label={t('rule.category')}>{t(`rulecat.${info.category}` as MessageKey)}</Row>
        <Row label={t('rule.locked')}>{info.locked ? `${theme.sym.lock} ${t('rule.lockedYes')}` : t('rule.lockedNo')}</Row>
        {info.pack ? <Row label={t('rule.pack')}>{cfg.packs?.[info.pack] ? t('set.on') : t('set.off')}</Row> : null}
        <Row label={t('rule.hits')}>{t('rule.hitsText', { n: hits.length })}</Row>
        <Row label="id">
          <Text color={theme.muted}>{id}</Text>
        </Row>
      </Section>
      <Muted>{t(`verdict.explain.${verdict}` as MessageKey)}</Muted>
      <Box marginTop={1}>
        <Muted>{t(info.locked ? 'rule.howLocked' : 'rule.howChange', { id })}</Muted>
      </Box>
    </Box>
  );
}

export function Events({ width, height }: ScreenProps) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const list = data.events(30).filter((e) => e.kind === 'belt' || e.kind === 'chat' || e.kind === 'quota' || e.kind === 'resume');
  if (!list.length) return <Empty>{t('belt.noEvents', { n: 30 })}</Empty>;
  return (
    <Box flexDirection="column" width={width}>
      {list.slice(0, Math.max(4, Math.floor((height - 2) / 2))).map((e, i) => (
        <Box key={i} flexDirection="column">
          <Box>
            <Box width={14} flexShrink={0}>
              <Text color={theme.muted}>{ago(e.at, now, lang)}</Text>
            </Box>
            <Text color={e.verdict === 'deny' ? theme.bad : e.verdict === 'ask' ? theme.warn : undefined}>{eventTitle(e, t)}</Text>
            <Text color={theme.muted}> {(e.rules ?? []).join(', ')}</Text>
          </Box>
          {e.reasons?.[0] ? (
            <Box marginLeft={14}>
              <Muted wrap="truncate-end">{e.reasons[0]}</Muted>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

const TOOLS = ['Bash', 'PowerShell', 'Write'] as const;

export function TestCommand({ width, open }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const [tool, setTool] = useState(0);
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ input: string; d: BeltDecision } | null>(null);
  const [busy, setBusy] = useState(false);
  useScreenKeys((_input, key) => {
    if (key.tab) {
      setTool((i) => (i + 1) % TOOLS.length);
      setResult(null);
      return true;
    }
    return false;
  }, open);
  const run = (v: string) => {
    if (!v.trim()) return;
    setBusy(true);
    const name = TOOLS[tool]!;
    const input = name === 'Write' ? { file_path: v.trim(), content: '' } : { command: v };
    void evaluateToolCall(name, input, beltContext({ cwd: data.cwd, config: data.config(), layout: data.layout, lang: data.lang })).then(
      (d) => {
        setResult({ input: v, d });
        setBusy(false);
      },
      () => setBusy(false),
    );
  };
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('test.intro')}</Muted>
      <Box marginTop={1}>
        {TOOLS.map((x, i) => (
          <Text key={x} inverse={i === tool} color={i === tool ? undefined : theme.muted}>
            {' '}
            {x === 'Write' ? t('test.path') : x}{' '}
          </Text>
        ))}
        {open ? <Text color={theme.muted}> {t('test.tabHint')}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <TextField
          label={TOOLS[tool] === 'Write' ? t('test.pathLabel') : t('test.commandLabel')}
          value={text}
          onChange={setText}
          onSubmit={run}
          active={open}
          placeholder={open ? '' : t('test.openHint')}
        />
      </Box>
      {busy ? <Muted>…</Muted> : null}
      {result ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={result.d.verdict === 'deny' ? theme.bad : result.d.verdict === 'ask' ? theme.warn : theme.ok}>
            {t(`verdict.${result.d.verdict}` as MessageKey)} <Text color={theme.muted}>{t('belt.testNote')}</Text>
          </Text>
          {result.d.findings.map((f, i) => (
            <Text key={i} wrap="wrap">
              {'  '}
              {f.reason} <Text color={theme.muted}>[{f.rule}]</Text>
            </Text>
          ))}
          {result.d.verdict === 'allow' ? <Muted>{t('test.allowed')}</Muted> : null}
        </Box>
      ) : null}
    </Box>
  );
}

export function Secrets({ width, open }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const [run, setRun] = useState(0);
  useScreenKeys((input) => {
    if (input === 's') {
      setRun((n) => n + 1);
      return true;
    }
    return false;
  }, open);
  const dirs = data.config().memory.dirs;
  if (!dirs.length) return <Empty>{t('secrets.noMemory')}</Empty>;
  if (!open && run === 0) return <Muted>{t('secrets.openToScan', { n: dirs.length })}</Muted>;
  const r = data.scanMemory();
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('secrets.scope', { dirs: dirs.map((d) => shortPath(d, homedir(), 40)).join(', ') })}</Muted>
      <Box marginTop={1} flexDirection="column">
        {r.findings.length ? (
          <>
            <Text color={theme.bad}>{t('secrets.found', { n: r.findings.length, files: r.files })}</Text>
            {r.findings.slice(0, 30).map((f, i) => (
              <Text key={i} wrap="truncate-end">
                {'  '}
                {shortPath(f.path, homedir(), Math.max(20, width - 40))}:{f.line} <Text color={theme.warn}>{f.kind}</Text>{' '}
                <Text color={theme.muted}>{f.masked}</Text>
              </Text>
            ))}
            <Box marginTop={1}>
              <Muted>{t('secrets.note')}</Muted>
            </Box>
          </>
        ) : (
          <Note kind="ok">{t('secrets.clean', { n: r.files })}</Note>
        )}
      </Box>
      {open ? <Muted>{t('secrets.rescanHint')}</Muted> : null}
    </Box>
  );
}
