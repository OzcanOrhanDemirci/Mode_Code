// SPDX-License-Identifier: Apache-2.0
/**
 * Shapes shared by the shell parsers. A parser turns a command string into simple commands; the analyzer
 * turns those into invocations (what actually runs, after wrappers such as `sudo`, `env` or `bash -c`).
 */

export type Dialect = 'bash' | 'powershell' | 'cmd';

export interface Word {
  /** The value after quotes and escapes are removed. Parameter expansions stay spelled as written ($HOME). */
  text: string;
  /** True when part of the value is only known at run time: $VAR, $(…), `…`, %VAR%, $env:X. */
  dynamic: boolean;
  /** True when the value has an unquoted glob character (* ? [). */
  glob: boolean;
}

export interface Redirect {
  /** The operator as written: >, >>, <, <<, <<-, <<<, &>, >|, 2>, *>, ... */
  op: string;
  /** The target word, when the operator takes one (a file, or a here-string). */
  target?: Word;
  /** True for operators that write to the target file. */
  writes: boolean;
}

export interface SimpleCommand {
  dialect: Dialect;
  /** Leading NAME=value assignments (bash) or `$x =` assignment targets (PowerShell). */
  assigns: string[];
  argv: Word[];
  redirects: Redirect[];
  /** Here-document bodies fed to this command, in order. */
  heredocs: { body: string; expands: boolean }[];
  /** The source text of this command, for messages. */
  raw: string;
  /** Where `raw` stands in the text parsed (bash only), so the text between commands can be read as what it is. */
  at?: number;
  /** It reads the output of the command before it (`a | b`, not `a || b`). */
  piped?: boolean;
}

export interface ParsedScript {
  dialect: Dialect;
  /** Every simple command in source order, including those inside groups, subshells and control flow. */
  commands: SimpleCommand[];
  /** Command strings that run as part of this script: $(…), `…`, <(…), script blocks, $( ) in strings. */
  nested: ParsedScript[];
  /** Problems that may make the parse incomplete. A non-empty list means "do not trust a clean result". */
  issues: string[];
  /**
   * Where comments (each from its `#` to the end of its line) and here-document bodies (each with its closing line)
   * stand in the text this script was parsed from, as offsets (bash only). Those inside `$(…)`, `<(…)` and `>(…)` are
   * listed here too: they are read in the same text. A script parsed from a piece of text (backticks, a `${…}`
   * operand, the body of a here-document) has offsets into that piece, in its `at`, `comments` and `bodies` alike.
   */
  comments?: readonly (readonly [number, number])[];
  bodies?: readonly (readonly [number, number])[];
}

export const MAX_DEPTH = 12;

/** The operator that joined a command to the one before it (`&&`, `;`, `|`, …), cut from its raw text. */
export const LEADING_OPERATOR = /^[;&|]+\s*/;
