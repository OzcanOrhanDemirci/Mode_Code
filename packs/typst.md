Typst documents: plain text in, PDF out, in a second.

**Commands:**

- `typst compile main.typ` (writes `main.pdf`; `typst compile main.typ out/report.pdf` names it),
- `typst watch main.typ` while the person looks at the PDF,
- `typst fonts` lists the fonts Typst sees; `--font-path fonts/` adds a folder,
- `--root .` when the document reads files from above its own folder.

**Turkish text:** `#set text(lang: "tr")` gives Turkish hyphenation and quotes; pick a font that has every Turkish letter (ı İ ğ Ğ ş Ş ç Ç ö Ö ü Ü) and check them in the PDF, not only in the source.

**Before calling it done:** it compiles with no warning; open the PDF (or render a page: `typst compile main.typ page-{p}.png --pages 1`) and look at the page breaks, tables and images; the text says what the person wrote, nothing invented.
