// SPDX-License-Identifier: Apache-2.0
/**
 * A request's method and body written in every form the programs take (curl, wget, PowerShell's web cmdlets, httpie and xh,
 * gh api), for the tests of the belt (test/core/taint.test.ts) and of the restricted modes (test/core/guard.test.ts,
 * test/core/effects-forms.test.ts), which read them with one reader (src/core/shell/requests.ts).
 */

/** The methods that read, in any case. */
export const READS = ['GET', 'HEAD', 'OPTIONS', 'get', 'Head', 'oPtIoNs'];
/**
 * Every other method sends: the four that change what is there, WebDAV's and other extensions, the two the read list leaves
 * out on purpose (TRACE echoes the request's headers back, CONNECT opens a tunnel), a name nobody listed, in any case.
 */
export const SENDING = ['POST', 'PUT', 'PATCH', 'DELETE', 'MKCOL', 'PROPFIND', 'PROPPATCH', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'TRACE', 'CONNECT', 'FROBNICATE']
  .flatMap((m) => [m, m.toLowerCase()])
  .concat(['Delete', 'VERSION-CONTROL']);
export const URL_ = 'https://x.example/a';

export interface Form {
  form: string;
  command: (method: string) => string;
  dialect?: 'powershell';
  /** httpie and xh take a method of letters only. */
  letters?: true;
}
/** A method written in every form of the programs that name one: short and long option, attached and separate, in a cluster. */
export const FORMS: Form[] = [
  { form: 'curl -X M', command: (m) => `curl -X ${m} ${URL_}` },
  { form: 'curl -XM', command: (m) => `curl -X${m} ${URL_}` },
  { form: 'curl --request M', command: (m) => `curl --request ${m} ${URL_}` },
  { form: 'curl --request=M', command: (m) => `curl --request=${m} ${URL_}` },
  { form: 'curl -sS -X M', command: (m) => `curl -sS -X ${m} ${URL_}` },
  { form: 'curl -sSX M', command: (m) => `curl -sSX ${m} ${URL_}` },
  { form: 'curl -sSXM', command: (m) => `curl -sSX${m} ${URL_}` },
  { form: 'curl, the method after the URL', command: (m) => `curl ${URL_} -X ${m} -H 'a: b'` },
  { form: 'wget --method=M', command: (m) => `wget --method=${m} ${URL_}` },
  { form: 'wget --method M', command: (m) => `wget --method ${m} ${URL_}` },
  { form: 'gh api -X M', command: (m) => `gh api -X ${m} repos/a/b` },
  { form: 'gh api -XM', command: (m) => `gh api -X${m} repos/a/b` },
  { form: 'gh api --method M', command: (m) => `gh api --method ${m} repos/a/b` },
  { form: 'gh api --method=M', command: (m) => `gh api --method=${m} repos/a/b` },
  { form: 'gh api -X=M', command: (m) => `gh api -X=${m} repos/a/b` },
  { form: 'gh api -iX=M', command: (m) => `gh api -iX=${m} repos/a/b` },
  { form: 'http M url', command: (m) => `http ${m} ${URL_}`, letters: true },
  { form: 'https M url', command: (m) => `https ${m} x.example/a`, letters: true },
  { form: 'xh M url', command: (m) => `xh ${m} x.example/a`, letters: true },
  { form: 'xh with options before the method', command: (m) => `xh --follow --auth bob:pw -p hb ${m} x.example/a`, letters: true },
  { form: '-Method M', command: (m) => `Invoke-WebRequest -Uri ${URL_} -Method ${m}`, dialect: 'powershell' },
  { form: '-Method:M', command: (m) => `Invoke-WebRequest -Uri ${URL_} -Method:${m}`, dialect: 'powershell' },
  { form: '-Method M, Invoke-RestMethod', command: (m) => `Invoke-RestMethod ${URL_} -Method ${m}`, dialect: 'powershell' },
  { form: '-Method M, iwr', command: (m) => `iwr ${URL_} -Method ${m} -UseBasicParsing`, dialect: 'powershell' },
  { form: '-CustomMethod M', command: (m) => `Invoke-WebRequest -Uri ${URL_} -CustomMethod ${m}`, dialect: 'powershell' },
  { form: '-customMETHOD:M', command: (m) => `irm ${URL_} -customMETHOD:${m}`, dialect: 'powershell' },
  { form: '-Meth M, shortened', command: (m) => `Invoke-WebRequest -Uri ${URL_} -Meth ${m}`, dialect: 'powershell' },
  { form: '-Cu:M, shortened', command: (m) => `Invoke-RestMethod ${URL_} -Cu:${m}`, dialect: 'powershell' },
  { form: "-Method M through PowerShell's curl alias", command: (m) => `curl ${URL_} -Method ${m}`, dialect: 'powershell' },
];

/** A request body in every form of the programs that carry one: a one-letter option whole, attached, bundled; a long one. */
export const BODIES: { form: string; command: string; dialect?: 'powershell' }[] = [
  ...[
    // curl: -d, -F and -T, alone, with the value attached, after other letters, after a letter that takes no value.
    'curl -d x=1 https://x.example/a',
    'curl -dx=1 https://x.example/a',
    'curl -d@f https://x.example/a',
    'curl -sd x=1 https://x.example/a',
    'curl -sSd x=1 https://x.example/a',
    'curl -sSdx=1 https://x.example/a',
    'curl -sSLd@f https://x.example/a',
    'curl -F a=b https://x.example/a',
    'curl -Fa=@f https://x.example/a',
    'curl -sF a=@f https://x.example/a',
    'curl -sSFa=@f https://x.example/a',
    'curl -T f https://x.example/a',
    'curl -Tf https://x.example/a',
    'curl -sT f https://x.example/a',
    'curl -sSLTf https://x.example/a',
    'curl -H "a: b" -sd x https://x.example/a',
    'curl https://x.example/a -sSd x',
    'curl -X GET -sd x https://x.example/a',
    // curl, long: whole or with `=`.
    'curl --data x https://x.example/a',
    'curl --data=x https://x.example/a',
    'curl --data-binary @f https://x.example/a',
    'curl --data-raw x https://x.example/a',
    'curl --data-urlencode q=x https://x.example/a',
    'curl --data-ascii x https://x.example/a',
    'curl --form a=b https://x.example/a',
    'curl --form-string a=b https://x.example/a',
    'curl --json x https://x.example/a',
    'curl --upload-file f https://x.example/a',
    'curl --upload-file=f https://x.example/a',
    // wget: long only.
    'wget --post-data=x https://x.example/a',
    'wget --post-data x https://x.example/a',
    'wget --post-file f https://x.example/a',
    'wget --body-data=x https://x.example/a',
    'wget --body-file f https://x.example/a',
    // httpie and xh: items, and the raw body.
    'http x.example/a a=1',
    'http x.example/a a:=1',
    'http x.example/a a@f',
    'http x.example/a --raw x',
    'http x.example/a --raw=x',
    'xh x.example/a --raw x',
    'xh x.example/a a=1',
    // gh api: a field or input, a one-letter option whole, attached (`=` only separates) and after other letters.
    'gh api repos/a/b -f title=x',
    'gh api repos/a/b -F n=1',
    'gh api repos/a/b -ft=x',
    'gh api repos/a/b -f=t=x',
    'gh api repos/a/b -if title=x',
    'gh api repos/a/b -iFn=1',
    'gh api repos/a/b --field n=1',
    'gh api repos/a/b --field=n=1',
    'gh api repos/a/b --raw-field t=x',
    'gh api repos/a/b --raw-field=t=x',
    'gh api repos/a/b --input f.json',
    'gh api repos/a/b --input=f.json',
  ].map((command) => ({ form: command, command })),
  ...[
    // PowerShell: the whole name or what no other parameter starts with, a colon, any case, through its aliases too.
    'Invoke-WebRequest -Uri https://x.example/a -Body x',
    'Invoke-WebRequest -Uri https://x.example/a -body:x',
    'Invoke-WebRequest -Uri https://x.example/a -BODY x',
    'Invoke-WebRequest -Uri https://x.example/a -Bo x',
    'Invoke-WebRequest -Uri https://x.example/a -InFile f',
    'Invoke-WebRequest -Uri https://x.example/a -infile:f',
    'Invoke-RestMethod https://x.example/a -Form @{a=1}',
    'Invoke-RestMethod https://x.example/a -Fo @{a=1}',
    'iwr https://x.example/a -Body x',
    'irm https://x.example/a -InFile f',
    'curl https://x.example/a -Body x',
    'wget https://x.example/a -InFile f',
  ].map((command) => ({ form: command, command, dialect: 'powershell' as const })),
];

/** The program a command starts with, as the analysis names it (PowerShell's aliases for its cmdlets resolved). */
export function programOf(command: string): string {
  const first = command.split(' ')[0]!.toLowerCase();
  return first === 'iwr' ? 'invoke-webrequest' : first === 'irm' ? 'invoke-restmethod' : first;
}

/**
 * Whether the restricted modes (chat, research, plan) take a method for a read of the network in a program: GET, HEAD or
 * OPTIONS; for `gh api` GET alone; for wget none, a method named at all is a change outside (src/core/shell/effects.ts).
 */
export function guardReads(program: string, method: string): boolean {
  if (program === 'wget') return false;
  return (program === 'gh' ? /^get$/i : /^(?:get|head|options)$/i).test(method);
}
