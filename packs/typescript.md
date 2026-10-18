TypeScript and JavaScript code intelligence through Anthropic's official `typescript-lsp` plugin: after each edit, the language server's diagnostics reach Claude without running the compiler.

It needs `typescript-language-server` on this computer (`npm install -g typescript-language-server typescript`); the project's own TypeScript is used where it has one.

The diagnostics do not replace the project's checks: before calling a change done, run its type check (`npx tsc --noEmit`), linter and tests.
