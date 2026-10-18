Python code intelligence through Anthropic's official `pyright-lsp` plugin: after each edit, Pyright's type diagnostics reach Claude without running anything.

It needs `pyright-langserver` on this computer (`npm install -g pyright`, or `pip install pyright`); it reads the project's `pyproject.toml` or `pyrightconfig.json` and its virtual environment.

The diagnostics do not replace the project's checks: before calling a change done, run its tests (`pytest`) and linter.
