// SPDX-License-Identifier: Apache-2.0
/** The seven categories and their pages, built from the current data. */
import React from 'react';
import { homedir } from 'node:os';
import { RULES, RULE_IDS } from '../core/belt/rules.js';
import type { RuleId } from '../core/belt/types.js';
import { ago, compact, percent, shortPath } from '../core/format.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';
import { healthCounts } from '../app/health.js';
import type { NavNode } from './nav.js';
import type { DataSource } from './store.js';
import { inboxEvents, Inbox, Overview } from './screens/home.js';
import { Folders, Quota, Tokens, Tools } from './screens/measure.js';
import { ProjectCard, SessionCard, sessionLabel } from './screens/work.js';
import { Events, Protection, RuleDetail, Secrets, TestCommand } from './screens/security.js';
import { Extensions, Hooks, Instructions, Mcp, Permissions, Plugins, SettingsSources } from './screens/claude.js';
import { About, Accessibility, FooterAndQuota, General, Keywords, Maintenance, Memory, Modules, Projects } from './screens/settings.js';

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
    ],
  });

  const projects = n('projects', 'cat.projects', {
    description: d('desc.projects'),
    children: () =>
      data.folders(90).map((f) => ({
        id: encodeURIComponent(f.cwd),
        label: shortPath(f.cwd, homedir(), 48),
        description: d('desc.project'),
        badge: { text: ago(f.lastTs, now, lang), state: 'info' as const },
        keywords: [f.cwd],
        screen: (p) => <ProjectCard cwd={f.cwd} {...p} />,
      })),
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
      n('extensions', 'page.extensions', { description: d('desc.extensions'), minView: 'recommended', screen: (p) => <Extensions {...p} /> }),
    ],
  });

  const settings = n('settings', 'cat.settings', {
    description: d('desc.settings'),
    badge: data.configProblems().length ? { text: t('badge.problems', { n: data.configProblems().length }), state: 'gray' } : undefined,
    children: () => [
      n('general', 'page.general', { description: d('desc.general'), screen: (p) => <General {...p} /> }),
      n('modules', 'page.modules', { description: d('desc.modules'), screen: (p) => <Modules {...p} /> }),
      n('footer-quota', 'page.footerQuota', { description: d('desc.footerQuota'), minView: 'recommended', screen: (p) => <FooterAndQuota {...p} /> }),
      n('memory', 'page.memory', { description: d('desc.memory'), screen: (p) => <Memory {...p} /> }),
      n('projects', 'page.projects', { description: d('desc.projectsSet'), screen: (p) => <Projects {...p} /> }),
      n('keywords', 'page.keywords', { description: d('desc.keywords'), screen: (p) => <Keywords {...p} /> }),
      n('accessibility', 'page.accessibility', { description: d('desc.accessibility'), screen: (p) => <Accessibility {...p} /> }),
      n('maintenance', 'page.maintenance', { description: d('desc.maintenance'), screen: (p) => <Maintenance {...p} /> }),
      n('about', 'page.about', { description: d('desc.about'), screen: (p) => <About {...p} /> }),
    ],
  });

  return [home, projects, sessions, measure, security, claude, settings];
}
