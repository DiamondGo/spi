# Pi startup and Node.js (published in Linux desktop/npm 0.1.4)

## What failed and why older tests missed it

A desktop-started or already-running GUI can inherit a PATH that differs from the user's current terminal (for example after switching/removing an nvm Node installation). sPi 0.1.3 found Pi's launcher, but on Unix passed the unchanged GUI environment to it. Finding Pi with `bash -lc 'command -v pi'` did not transfer that shell's Node path. An env-based Node shebang could then exit 127, and sPi reduced the useful cause to `pi process exited`.

The previous clean containers had a working Node on PATH. They did exercise real new sessions/RPC and the outbox, but did not exercise this environment variant. Passing those tests was not proof of desktop/nvm startup compatibility.

The regression was reproduced against the actual old 0.1.3 packaged GUI in a private profile, with Node absent from its PATH and available only via a synthetic login shell. It failed with the same `session:open … pi process exited` error. The new regression must run on installed/extracted binaries, not only development source.

## Automatic detection

0.1.4 resolves a compatible Node from the GUI PATH, alongside the Pi launcher, Pi's standard managed runtime location, or a bounded login-shell query. It checks Node >=22.19 and prepends its directory **only to the new RPC child's PATH**. It does not rewrite system PATH, shell startup files, Pi settings, model profiles, authentication or global permission rules.

Pi shell/native launchers and argv are preserved; no Pi path/tool arguments are interpolated into a shell command. A custom launcher that explicitly selects a different Node retains its own behavior. Probes use constant commands and do not receive the private RPC bridge token, Electron Node-mode flag or Node preload hooks.

## Settings → Node.js runtime

When automatic lookup cannot find Node, open Settings and:

1. Enter the absolute path to the actual `node` executable, or use **Browse…**.
2. Choose **Save Node path**. The main process checks executable/version before saving. Invalid paths do not replace the previous setting.
3. Retry opening a session. No existing session is restarted or killed.

The optional path is stored privately/atomically as `nodePath` in sPi's own `spi-config.json`, alongside its other app configuration. It is not stored in Pi settings. It survives app restarts. **Detect automatically** clears the override. A saved path that later disappears fails explicitly; it never silently falls back to another Node. With env-based Pi launchers, the selected Node directory is preferred in the child environment; explicitly self-managed custom launchers still retain their own configuration.

This changes subsequent new/reopened sessions, not the executable already running an existing session. No GUI restart is required just to change/clear the override.

## Diagnostics and evidence

- Startup failures include exit code/signal and safe missing-Node/dependency classifications. Arbitrary extension stderr (which could contain credentials) is not copied into IPC errors. Commands sent after a child has already exited fail immediately instead of waiting for a timeout.
- Unit coverage checks sparse/stale PATH, login/managed Node, exact argv/wrapper preservation, JS entries, manual priority, invalid paths, private atomic persistence/clear, probe token isolation and early-exit diagnostics.
- Nine real GUI/Pi tests cover new sessions without desktop Node, a private loopback/read roundtrip, history reopening, another new session, invalid manual input, manual Node when login detection is unavailable, removal of a saved executable without killing existing sessions, app restart/history persistence, and clearing back to automatic lookup.
- Tests use private HOME/XDG/agent/profile/workspace and a private Xvfb/loopback model, not real authentication/history/extensions. No user GUI or active queue is replaced. Both native Linux archives passed this regression. Two fresh non-root x64 containers then passed the public pinned/latest Pi install with all 9 startup/manual-setting checks and existing workspace/GUI/PTY/RPC/sandbox coverage. No host credentials/configuration/binaries were mounted.

The patch version is **0.1.4**, not four-component `0.1.3.1`, because npm requires valid three-component SemVer. Published 0.1.3 assets/npm are immutable and unchanged.
