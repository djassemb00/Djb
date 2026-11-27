# os-dos — the programs we ship

Small, real DOS programs written for this project and released as public domain.
They are the proof of the product's only promise that is fully in our hands:
**a PC program runs, with no operating system around it**.

| file | what it is |
| --- | --- |
| `menu.c` → `MENU.COM` | the app drawer shown after boot: pick a program, it hides, the program runs; returning brings the menu back (DOS `EXEC`, int 21h/4Bh) |
| `snake.c` → `SNAKE.COM` | Snake: arrows, score, food, game over |
| `pong.c` → `PONG.COM` | Pong against the CPU: W/S, first to 10 |

Built with `gcc -m16` + a linker script (`com.ld`) that lays every section from
0x100, because a `.COM` file is one flat chunk: any section placed elsewhere is
simply never loaded (this cost us a silent hang — see RESEARCH.md §٦٢).

`./build.sh` regenerates all three. The bundled floppy
`public/images/dos-games.img` is built from them by
`os-sim/.probe/games.test.ts`, which also proves them end to end in a real
emulated PC.
