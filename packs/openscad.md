OpenSCAD models, rendered from the command line.

**Render:** `openscad -o part.stl part.scad` (binary STL: add `--export-format binstl`); a value from outside: `-D 'width=40'`; a preview image: `openscad -o part.png --imgsize=800,600 part.scad`. Development snapshots render much faster with `--backend=manifold`.

**Its errors do not change the exit code.** A failed `assert`, an undefined variable or an empty result can still exit 0. After every render:

1. read the whole output: any line with `ERROR:` or `WARNING:` is a failure until explained; `--hardwarnings` stops at the first warning,
2. check that the file exists and is not empty,
3. for a part that must fit, print the measures you meant (`echo(...)`) and compare them with the person's numbers.

**Care:** keep every measure a named variable at the top; never change a dimension the person gave without saying so; the printer's own limits (tolerances, overhangs, wall thickness) are the person's to confirm.
