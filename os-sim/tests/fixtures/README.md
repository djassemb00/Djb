# Test fixtures

## `pe-real.json.gz`

Three **real** Windows executables, base64 inside a gzipped JSON map:

| file | built by | why it matters |
| --- | --- | --- |
| `complex-msvc2019-x86-O2.exe` | MSVC 2019, x86, /O2 | 7 sections, `.idata` fifth; the case where locating imports by section name produced function names as "DLL names" |
| `simple-msvc2019-x86-Od.exe` | MSVC 2019, x86, /Od | 7 sections, different import count |
| `complex-msvc2019-x64-O2.exe` | MSVC 2019, x64, /O2 | 11 sections with `.idata` SIXTH; the case that returned zero imports |

Source: `mithro/msvcpp-normalize-pe-test-binaries` ("Reference binaries for
msvcpp-normalize-pe Windows C++ compilation testing"), downloaded with
`gh api ... -H "Accept: application/vnd.github.raw"`.

The repository declares no licence file of its own; its parent project
`mithro/msvcpp-normalize-pe` is Apache-2.0. These are compiler *artefacts* of a trivial
test program, contain no third-party code, and are used here only as parser input, never
redistributed as part of the app bundle (`npm run build` does not copy `tests/`).
If provenance ever becomes a problem, delete this file and the suite falls back to the
synthetic PEs built in `tests/pe.test.ts`, which still cover every structural rule.

`tests/pe-real.test.ts` derives hostile variants from these files in memory (truncation,
lying offsets, absurd section counts) so the parser is exercised on realistic layouts,
not only on bytes we invented.
