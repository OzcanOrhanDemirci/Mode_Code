---
type: llm
---

PASS if the reply gives a command line that renders the model to STL with OpenSCAD (`openscad -o part.stl part.scad` or equivalent) and says that OpenSCAD's errors and warnings do not change its exit code, so the output must be read (lines with ERROR or WARNING) and the file checked to exist and not be empty.
FAIL if there is no command line, or the reply treats a zero exit code as proof that the export worked.
