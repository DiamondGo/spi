# Runtime downloads (published in 0.1.3)

## Why 0.1.2 can appear frozen

The published 0.1.2 npm tarball is small; its personal Pi postinstall then downloads the matching full desktop archive. npm normally buffers lifecycle output, so the last visible `reify` line is not necessarily the active operation. The old downloader imposed a 180-second total timeout on a roughly 129 MB Linux archive, retried from zero and provided no live percentage. A real slow connection reproduced the failure; it is unrelated to warnings about another extension's Node engine.

The 0.1.2 package/assets are immutable and have not been patched in place. The changes below require 0.1.3; do not expect reinstalling 0.1.2 to obtain them. Do not delete an active installation lock, edit Pi/npm configuration or disable OS protections to work around a slow transfer.

## Percentage and phases

The new downloader emits an initial 0%, then a line every 10 seconds with received/total **MiB**, percentage, average **KiB/s** and attempt number, ending at 100% after complete size/hash verification:

```text
[sPi] Downloading runtime: 61.4/122.7 MiB (50%), 180 KiB/s, attempt 1/3
[sPi] Downloading runtime: 122.7/122.7 MiB (100%), 180 KiB/s, attempt 1/3
[sPi] Download verified; preparing the runtime.
[sPi] Checksum verified; extracting the runtime. Please wait.
```

Metadata lookup, retries, safe restart when a server ignores Range, and installation completion also have explicit messages. 100% describes the download, not a claim that extraction/application startup is finished.

For interactive npm postinstall, progress uses only the process's **own controlling terminal** when npm buffers stdout/stderr. It does not enumerate another terminal, open a new window or steal focus. Headless/no-terminal callers fall back to stderr. To expose lifecycle logs in a headless captured npm/Pi run, set `npm_config_foreground_scripts=true` for that command, without changing saved npm configuration.

## Bounded timeouts and retries

- Runtime archive: **60 minutes total across all attempts**, not three minutes per transfer.
- Network inactivity (including response headers): **60 seconds**; receiving data resets this timer. A healthy slow transfer is not considered stalled.
- At most **3 attempts**. Interrupted bodies use Range plus a strong ETag/If-Range when available, within the current private staging directory. If the server ignores Range and returns 200, discard that partial prefix and restart safely instead of appending duplicate data.
- Check resumed offsets, end/total lengths, validators, encoding and size limits. Always verify the complete archive's manifest size and SHA-256 before extraction/activation. Changed/corrupt content cannot activate a runtime.
- No permanent cache or resume across separate installer processes is promised. Failure cleans the owned stage/lock and preserves the previous current runtime. An externally killed process can leave a lock; do not remove it until ownership/liveness is checked.
- Metadata keeps its smaller size and total-time budget. HTTPS/host/redirect allowlists and safe extraction limits remain enforced.

`SPI_DOWNLOAD_TIMEOUT_SECONDS` optionally sets the archive's total budget to an integer from **60 through 21600** (six hours). The default is 3600. It does not alter the inactivity bound, skip verification or modify Pi/npm settings.

## Evidence

- 13 deterministic download/progress tests: scaled slow transfer, increasing percentages through 100%, dropped/stalled/short bodies, Range/If-Range, ignored/malformed ranges, changed validators, size/hash failure, redirect restrictions, exclusive files and an actual npm-buffered private PTY.
- A real public 0.1.2 archive downloaded and installed using the new source downloader into a private temporary root in **707 seconds** (about 12 minutes), on one uninterrupted attempt, with 0–100% progress and complete verification. This exceeds the old 180-second deadline and did not touch the user's formal installation or active GUI.
- Historical 0.1.3 publication passed the download acceptance below; current stable 0.1.4 also fixes desktop Node startup and adds manual runtime settings ([acceptance](verification.md)). Two fresh non-root x64 Docker containers separately passed public `pi install npm:spi-agent-gui@0.1.3` and unversioned latest install, with slow downloads lasting about 11 minutes, visible 0–100% progress and no old three-minute abort. Installed GUI/PTY/Pi RPC, icon/desktop entry ownership, single-instance forwarding, enabled renderer sandbox and actual editable-outbox/steer/follow-up behavior all passed. No host configuration/credentials/binaries were mounted. Native arm64 acceptance passed separately in GitHub Actions.
