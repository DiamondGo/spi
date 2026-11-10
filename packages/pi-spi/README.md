# sPi - Simple Pi Agent GUI

Lightweight Pi package and desktop installer. Desktop binaries are downloaded from the matching GitHub Release, not included in this npm package. No AppImage, FUSE, native compilation or second copy of Pi is required.

The fixed npm package name is `spi-agent-gui` (planned; not yet published). After a personal `pi install npm:spi-agent-gui`, run `spi`. The package registers `/spi` and `/spi-install`; it never launches a GUI just because an extension was loaded. Project/temporary/CI installs and `SPI_SKIP_INSTALL=1` skip automatic system-wide side effects. If lifecycle scripts are disabled, use `/spi-install` or explicitly run `npx --package spi-agent-gui spi install`.

`spi --help`, `spi doctor`, `spi update`, `spi rollback`, `spi uninstall`. Use `--bin-dir` if Pi's PATH directory is not writable or another spi command exists. No shell profile is edited. User preferences and Pi sessions survive uninstall. `pi remove` removes this package, not the independently installed desktop runtime.

The installer requires Node.js 22.19+; the installed command can use its private Electron runtime's Node mode. Supported platforms are only those present in the verified Release manifest. Unsigned Windows/macOS binaries may trigger OS warnings; do not disable OS protections. Linux needs a glibc desktop environment.
