// SPDX-License-Identifier: Apache-2.0
/** The eight categories and their pages, built from the current data. */
import { homedir } from 'node:os';
import { RULES, RULE_IDS } from '../core/belt/rules.js';
import type { RuleId } from '../core/belt/types.js';
import { ago, percent, shortPath } from '../core/format.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';
import { healthCounts } from '../app/health.js';
import type { NavNode, ScreenProps } from './nav.js';
import type { DataSource } from './store.js';
import { inboxEvents, Inbox, Overview } from './screens/home.js';
import { Folders, Quota, ReportScreen, Tokens, Tools } from './screens/measure.js';
import { FlowCard, FlowsEmpty, HandoffCard, HandoffsEmpty, ProjectCard, RunCard, RunsEmpty, SessionCard, sessionLabel } from './screens/work.js';
import { flowTitle, statusText } from '../core/flow-view.js';
import { Events, Protection, RuleDetail, Secrets, TestCommand } from './screens/security.js';
import { Extensions, Hooks, Instructions, Mcp, Packs, Permissions, Plugins, SettingsSources, Skills } from './screens/claude.js';
import { Templates } from './screens/templates.js';
import { History } from './screens/history.js';
import { Activity } from './screens/activity.js';
import { Bypass, Bypassed, ParallelAgents, RecentTasks } from './screens/automation.js';
import {
  About,
  Accessibility,
  Autonomy,
  FooterAndQuota,
  General,
  Keywords,
  Maintenance,
  Memory,
  MemoryHandoffs,
  MemoryStore,
  Sync,
  Modules,
  Projects,
} from './screens/settings.js';

const other = (lang: Lang): Lang => (lang === 'tr' ? 'en' : 'tr');

export function buildTree(data: DataSource, lang: Lang, now: number): NavNode[] {
  const t = (k: MessageKey, p?: Record<string, string | number>) => tIn(lang, k, p);
  /** A node whose label also matches its name in the other language in the palette. */
  const n = (id: string, key: MessageKey, rest: Omit<NavNode, 'id' | 'label'>): NavNode => ({
    id,
    label: t(key),
    keywords: [tIn(other(lang), key), id],
    ...rest,
  });
  const d = (key: MessageKey) => t(key);

  const home = n('home', 'cat.home', {
    description: d('desc.home'),
    badge: (() => {
      const h = data.health();
      const c = healthCounts(h);
      if (c.red) return { text: `${c.red}`, state: 'red' as const };
      const unseen = inboxEvents(data.events(14), data.lastSeen()).length;
      return unseen ? { text: t('badge.new', { n: unseen }), state: 'gray' as const } : undefined;
    })(),
    children: () => [
      n('overview', 'page.overview', { description: d('desc.overview'), screen: (p) => <Overview {...p} /> }),
      n('inbox', 'page.inbox', {
        description: d('desc.inbox'),
        badge: (() => {
          const k = inboxEvents(data.events(14), data.lastSeen()).length;
          return k ? { text: String(k), state: 'gray' as const } : undefined;
        })(),
        screen: (p) => <Inbox {...p} />,
      }),
      n('activity', 'page.activity', { description: d('desc.activity'), screen: (p) => <Activity {...p} /> }),
    ],
  });

  const flows = data.flows();
  const waiting = flows.filter((f) => f.status === 'waiting').length;
  const flowsNode = n('flows', 'page.flows', {
    description: d('desc.flows'),
    ...(waiting
      ? { badge: { text: t('badge.waiting', { n: waiting }), state: 'gray' as const } }
      : flows.length
        ? { badge: { text: String(flows.length), state: 'info' as const } }
        : {}),
    ...(flows.length
      ? {
          children: () =>
            flows.map((f) => ({
              id: f.id,
              label: `${f.status === 'waiting' ? '⏸ ' : ''}${flowTitle(f, 48)}`,
              description: d('desc.flow'),
              badge: { text: statusText(f.status, lang), state: f.status === 'waiting' ? ('gray' as const) : ('info' as const) },
              keywords: [f.id, f.task],
              screen: (p: ScreenProps) => <FlowCard id={f.id} {...p} />,
            })),
        }
      : { screen: (p: ScreenProps) => <FlowsEmpty {...p} /> }),
  });

  const runs = data.runs();
  const runsNode = n('runs', 'page.runs', {
    description: d('desc.runs'),
    ...(runs.some((r) => r.status === 'active')
      ? { badge: { text: t('badge.running', { n: runs.filter((r) => r.status === 'active').length }), state: 'info' as const } }
      : runs.length
        ? { badge: { text: String(runs.length), state: 'info' as const } }
        : {}),
    ...(runs.length
      ? {
          children: () =>
            runs.map((r) => ({
              id: r.id,
              label: `${r.status === 'paused' || r.status === 'stuck' ? '⏸ ' : ''}${(r.task || r.id).split('\n')[0]!.slice(0, 48)}`,
              description: d('desc.run'),
              badge: {
                text: tIn(lang, `auto.status.${r.status}` as MessageKey),
                state: r.status === 'stuck' ? ('red' as const) : r.status === 'paused' ? ('gray' as const) : ('info' as const),
              },
              keywords: [r.id, r.task],
              screen: (p: ScreenProps) => <RunCard id={r.id} {...p} />,
            })),
        }
      : { screen: (p: ScreenProps) => <RunsEmpty {...p} /> }),
  });

  const handoffs = data.handoffs();
  const handoffsNode = n('handoffs', 'page.handoffs', {
    description: d('desc.handoffs'),
    ...(handoffs.length ? { badge: { text: String(handoffs.length), state: 'info' as const } } : {}),
    ...(handoffs.length
      ? {
          children: () =>
            handoffs.map((h) => ({
              id: h.path.split('/').slice(-2).join('-').replace(/\.md$/, ''),
              label: `${h.project} · ${h.next.slice(0, 40) || h.trigger}`,
              description: d('desc.handoff'),
              badge: { text: ago(h.at, now, lang), state: 'info' as const },
              keywords: [h.project, h.next],
              screen: (p: ScreenProps) => <HandoffCard path={h.path} {...p} />,
            })),
        }
      : { screen: (p: ScreenProps) => <HandoffsEmpty {...p} /> }),
  });

  const projects = n('projects', 'cat.projects', {
    description: d('desc.projects'),
    ...(waiting ? { badge: { text: t('badge.waiting', { n: waiting }), state: 'gray' as const } } : {}),
    children: () => [
      flowsNode,
      handoffsNode,
      ...data.folders(90).map((f) => ({
        id: encodeURIComponent(f.cwd),
        label: shortPath(f.cwd, homedir(), 48),
        description: d('desc.project'),
        badge: { text: ago(f.lastTs, now, lang), state: 'info' as const },
        keywords: [f.cwd],
        screen: (p: ScreenProps) => <ProjectCard cwd={f.cwd} {...p} />,
      })),
    ],
  });

  const sessions = n('sessions', 'cat.sessions', {
    description: d('desc.sessions'),
    children: () =>
      data.sessions({ limit: 300 }).map((s) => ({
        id: s.id,
        label: sessionLabel(s),
        description: d('desc.session'),
        badge: { text: ago(s.lastTs, now, lang), state: 'info' as const },
        keywords: [s.cwd ?? '', s.firstPrompt ?? ''],
        screen: (p) => <SessionCard id={s.id} {...p} />,
      })),
  });

  const measure = n('measure', 'cat.measure', {
    description: d('desc.measure'),
    children: () => [
      n('quota', 'page.quota', {
        description: d('desc.quota'),
        badge: (() => {
          const q = data.quota();
          const w = q.assessment.week;
          return w
            ? {
                text: percent(w.used, lang),
                state: q.assessment.level === 'stop' ? ('red' as const) : q.assessment.level === 'wrapUp' ? ('gray' as const) : ('info' as const),
              }
            : undefined;
        })(),
        screen: (p) => <Quota {...p} />,
      }),
      n('report', 'page.report', { description: d('desc.report'), screen: (p) => <ReportScreen {...p} /> }),
      n('tokens', 'page.tokens', { description: d('desc.tokens'), screen: (p) => <Tokens {...p} /> }),
      n('tools', 'page.tools', { description: d('desc.tools'), minView: 'recommended', screen: (p) => <Tools {...p} /> }),
      n('folders', 'page.folders', { description: d('desc.folders'), minView: 'recommended', screen: (p) => <Folders {...p} /> }),
    ],
  });

  const security = n('security', 'cat.security', {
    description: d('desc.security'),
    badge: (() => {
      const blocked = data.events(1).filter((e) => e.kind === 'belt' && e.verdict === 'deny').length;
      const belt = data.health().features.find((f) => f.id === 'belt');
      if (belt?.state === 'red') return { text: t('health.state.red'), state: 'red' as const };
      return blocked ? { text: t('badge.blocked', { n: blocked }), state: 'gray' as const } : undefined;
    })(),
    children: () => [
      n('protection', 'page.protection', { description: d('desc.protection'), screen: (p) => <Protection {...p} /> }),
      n('rules', 'page.rules', {
        description: d('desc.rules'),
        badge: { text: String(RULE_IDS.length), state: 'info' },
        children: () =>
          RULE_IDS.map((id) => {
            const info = RULES[id];
            const v = data.config().belt.verdicts?.[id] ?? info.verdict;
            const off = !info.locked && data.config().belt.disabled?.includes(id);
            return {
              id,
              label: t(`rulename.${id}` as MessageKey),
              description: t(`rule.${id}` as MessageKey),
              badge: {
                text: (info.locked ? '🔒 ' : '') + (off ? t('verdict.off') : t(`verdict.${v}` as MessageKey)),
                state: v === 'deny' ? ('red' as const) : v === 'ask' ? ('gray' as const) : ('info' as const),
              },
              keywords: [id, tIn(other(lang), `rulename.${id}` as MessageKey)],
              screen: (p) => <RuleDetail id={id as RuleId} {...p} />,
            } satisfies NavNode;
          }),
      }),
      n('events', 'page.events', { description: d('desc.events'), screen: (p) => <Events {...p} /> }),
      n('test', 'page.test', { description: d('desc.test'), screen: (p) => <TestCommand {...p} /> }),
      n('secrets', 'page.secrets', { description: d('desc.secrets'), screen: (p) => <Secrets {...p} /> }),
    ],
  });

  const claude = n('claude-code', 'cat.claude-code', {
    description: d('desc.claude'),
    children: () => [
      n('instructions', 'page.instructions', { description: d('desc.instructions'), screen: (p) => <Instructions {...p} /> }),
      n('settings', 'page.ccsettings', { description: d('desc.ccsettings'), screen: (p) => <SettingsSources {...p} /> }),
      n('hooks', 'page.hooks', { description: d('desc.hooks'), minView: 'recommended', screen: (p) => <Hooks {...p} /> }),
      n('permissions', 'page.permissions', { description: d('desc.permissions'), screen: (p) => <Permissions {...p} /> }),
      n('mcp', 'page.mcp', { description: d('desc.mcp'), screen: (p) => <Mcp {...p} /> }),
      n('plugins', 'page.plugins', { description: d('desc.plugins'), screen: (p) => <Plugins {...p} /> }),
      n('packs', 'page.packs', {
        description: d('desc.packs'),
        screen: (p) => <Packs {...p} />,
        keywords: ['paket', 'paketler', 'packs', 'automatic use', 'otomatik kullan'],
      }),
      n('skills', 'page.skills', {
        description: d('desc.skills'),
        screen: (p) => <Skills {...p} />,
        keywords: ['beceri', 'beceriler', 'skills', 'komutlar', 'commands'],
      }),
      n('templates', 'page.templates', { description: d('desc.templates'), screen: (p) => <Templates {...p} /> }),
      n('extensions', 'page.extensions', { description: d('desc.extensions'), minView: 'recommended', screen: (p) => <Extensions {...p} /> }),
    ],
  });

  // Automation (the person, 2026-10-15): the special ways of working, off until turned on, in one place.
  const bypassCalls = data.events(1).filter((e) => e.kind === 'bypass' && e.action === 'call').length;
  const automation = n('automation', 'cat.automation', {
    description: d('desc.automation'),
    ...(runs.some((r) => r.status === 'active')
      ? { badge: { text: t('badge.running', { n: runs.filter((r) => r.status === 'active').length }), state: 'info' as const } }
      : data.config().bypass.enabled
        ? { badge: { text: '⚡', state: 'gray' as const } }
        : {}),
    children: () => [
      n('full-auto', 'page.autonomy', {
        description: d('desc.autonomy'),
        badge: { text: t(data.config().autonomy.enabled ? 'set.on' : 'set.off'), state: 'info' },
        screen: (p) => <Autonomy {...p} />,
      }),
      n('prompts', 'page.autoPrompts', {
        description: d('desc.autoPrompts'),
        ...(data.autoPrompts().length ? { badge: { text: String(data.autoPrompts().length), state: 'gray' as const } } : {}),
        screen: (p) => <RecentTasks {...p} />,
      }),
      runsNode,
      n('bypass', 'page.bypass', {
        description: d('desc.bypass'),
        badge: { text: t(data.config().bypass.enabled ? 'set.on' : 'set.off'), state: data.config().bypass.enabled ? 'gray' : 'info' },
        screen: (p) => <Bypass {...p} />,
      }),
      n('bypassed', 'page.bypassed', {
        description: d('desc.bypassed'),
        ...(bypassCalls ? { badge: { text: String(bypassCalls), state: 'gray' as const } } : {}),
        screen: (p) => <Bypassed {...p} />,
      }),
      n('agents', 'page.agents', {
        description: d('desc.agents'),
        badge: { text: t(data.config().agents.enabled ? 'set.on' : 'set.off'), state: 'info' },
        screen: (p) => <ParallelAgents {...p} />,
        keywords: ['ajan', 'ajanlar', 'agents', 'paralel', 'parallel'],
      }),
    ],
  });

  const settings = n('settings', 'cat.settings', {
    description: d('desc.settings'),
    badge: data.configProblems().length ? { text: t('badge.problems', { n: data.configProblems().length }), state: 'gray' } : undefined,
    children: () => [
      n('general', 'page.general', { description: d('desc.general'), screen: (p) => <General {...p} /> }),
      n('modules', 'page.modules', { description: d('desc.modules'), screen: (p) => <Modules {...p} /> }),
      n('footer-quota', 'page.footerQuota', { description: d('desc.footerQuota'), screen: (p) => <FooterAndQuota {...p} /> }),
      n('memory', 'page.memory', {
        description: d('desc.memory'),
        badge: (() => {
          const v = data.memory();
          if (!v.store) return { text: t('mem.notSetUp'), state: 'gray' as const };
          if (!v.inUse || v.last?.result.pull === 'conflict' || v.last?.result.pull === 'diverged')
            return { text: t('health.state.red'), state: 'red' as const };
          return { text: t(`msetup.place.${v.store.place}` as MessageKey), state: 'info' as const };
        })(),
        children: () => [
          n('store', 'page.memoryStore', { description: d('desc.memoryStore'), screen: (p) => <MemoryStore {...p} /> }),
          n('handoffs', 'page.memoryHandoffs', { description: d('desc.memoryHandoffs'), screen: (p) => <MemoryHandoffs {...p} /> }),
          n('protected', 'page.memoryProtected', { description: d('desc.memoryProtected'), screen: (p) => <Memory {...p} /> }),
        ],
      }),
      n('sync', 'page.sync', {
        description: d('desc.sync'),
        badge: (() => {
          const v = data.sync();
          if (!v.setting) return { text: t('mem.notSetUp'), state: 'gray' as const };
          if (!v.exists) return { text: t('health.state.red'), state: 'red' as const };
          if (v.pending.length) return { text: t('sync.badge.waiting', { n: v.pending.length }), state: 'red' as const };
          return { text: v.setting.machine.name, state: 'info' as const };
        })(),
        screen: (p) => <Sync {...p} />,
      }),
      n('projects', 'page.projects', { description: d('desc.projectsSet'), screen: (p) => <Projects {...p} /> }),
      n('keywords', 'page.keywords', { description: d('desc.keywords'), screen: (p) => <Keywords {...p} /> }),
      n('accessibility', 'page.accessibility', { description: d('desc.accessibility'), screen: (p) => <Accessibility {...p} /> }),
      n('history', 'page.history', { description: d('desc.history'), screen: (p) => <History {...p} /> }),
      n('maintenance', 'page.maintenance', { description: d('desc.maintenance'), screen: (p) => <Maintenance {...p} /> }),
      n('about', 'page.about', { description: d('desc.about'), screen: (p) => <About {...p} /> }),
    ],
  });

  return [home, projects, sessions, measure, security, claude, automation, settings];
}
