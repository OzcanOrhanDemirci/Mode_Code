// SPDX-License-Identifier: Apache-2.0
/**
 * The words the plugin carries. Claude Code does not read a hooks module over 1 MiB, and the two languages'
 * dictionaries were nearly half of the plugin's; most of their messages belong to the control center and the
 * command line. So the plugin keeps a message only when its own code names it, read from the plugin's code
 * bundled without the dictionaries (what esbuild left after dropping unused code):
 *
 * - a quoted string that is the key (a template setting's too: "ux.packs.items.*.opt.auto"), or the key after "@"
 *   ("@doc.title", as a few tables write one);
 * - a template that starts with part of a key (`auto.gate.name.${id}`): every key that starts so;
 * - a quoted string with a dot in it ("footer.acts.files", "auto.refuse."): every key beneath it, for a key
 *   joined from parts ("footer.acts.files" + ".one").
 *
 * A key the code builds any other way would be missed; the plugin then shows the key itself rather than fail
 * (src/core/i18n/index.ts), and test/dist/plugin-words.test.ts holds every key the plugin's sources name.
 */

/** The keys among `keys` that the plugin's `code` names. */
export function wordsUsed(code, keys) {
  const quoted = new Set();
  for (const m of code.matchAll(/["'`]@?([A-Za-z][\w*-]*(?:\.[\w*-]+)*\.?)["'`]/g)) quoted.add(m[1]);
  const heads = new Set();
  for (const m of code.matchAll(/`([A-Za-z][\w*-]*(?:\.[\w*-]*)*\.)\$\{/g)) heads.add(m[1]);
  const prefixes = [...heads, ...[...quoted].filter((q) => q.includes('.')).map((q) => (q.endsWith('.') ? q : `${q}.`))];
  return new Set(keys.filter((k) => quoted.has(k) || prefixes.some((p) => k.startsWith(p))));
}

/** The dictionary with only these keys, in its own order. */
export function only(dict, used) {
  return Object.fromEntries(Object.entries(dict).filter(([k]) => used.has(k)));
}

/**
 * An esbuild plugin that hands the bundle these dictionaries in place of src/core/i18n/en.ts and tr.ts (`words()`
 * answers the two objects, read when the bundle needs them).
 */
export function dictionaries(words) {
  return {
    name: 'plugin-words',
    setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]core[\\/]i18n[\\/](en|tr)\.ts$/ }, (a) => {
        const lang = /en\.ts$/.test(a.path) ? 'en' : 'tr';
        return { contents: `export const ${lang} = ${JSON.stringify(words()[lang])};`, loader: 'js' };
      });
    },
  };
}
