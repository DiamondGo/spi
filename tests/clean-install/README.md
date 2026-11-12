# Clean public-install test (Linux x64)

**0.2.0 desktop/npm are public; fixed-version and latest public Pi installs both passed in independent fresh UID-1000 containers, including the packaged remote access check.** Both ran all five GUI suites with the normal trash prerequisite installed, alongside GUI/PTY/Pi RPC, icon/desktop ownership, single-instance and active renderer sandbox checks. The earlier desktop-bootstrap-only result is recorded separately, not substituted for public npm acceptance.

This image contains Node/Pi and desktop prerequisites, but **no sPi binary, package, configuration or npm/GitHub credentials**. Docker's build context is allowlisted to the Dockerfile and ten test scripts. The test installs the published package from the public npm registry and downloads binaries from the public GitHub Release.

```bash
docker build -f tests/clean-install/Dockerfile -t spi-clean-install .
docker run --rm --init --shm-size=512m --security-opt seccomp=unconfined spi-clean-install
# Also verify the README's unversioned/latest install in another fresh container:
docker run --rm --init --shm-size=512m --security-opt seccomp=unconfined \
  -e SPI_VERIFY_PACKAGE=spi-agent-gui -e SPI_EXPECTED_VERSION=0.2.0 spi-clean-install
```

Desktop prerequisites include `libglib2.0-bin` for the real Linux `gio` trash backend; missing trash support must fail safely, not permanently delete history. Python 3/Xlib are used only by the native window-placement test.

The process runs as the non-root `node` user. There are no host mounts, host X sockets, authentication variables, privileged mode or additional capabilities. The outer Docker seccomp profile is relaxed solely to allow Chromium to create its own sandbox namespaces; **the application is not started with `--no-sandbox`**. The test explicitly asserts that an owned Chromium renderer has `NoNewPrivs=1` and its own `Seccomp=2` filter. Host policies may independently restrict user namespaces; do not disable the application's sandbox to make this test pass.

Checks: pristine environment; `pi install npm:spi-agent-gui@0.2.0`; owned Linux desktop entry and new spy icon (including the actual native window icon); spi next to user-owned pi on PATH; version/doctor; actual Pi extension command registration; native PTY; real Electron GUI on a private Xvfb display; real Pi RPC permission handshake; repeated cwd forwarding to one session; renderer sandbox. The installed package must expose the actual editable-outbox/Yolo/divider APIs, not the old queue-count-only UI. A loopback-only model then verifies follow-up tail appends/newest-steer head insertion, edit/cancel, fixed composer anchoring, active-session highlighting and path abbreviation in the published runtime. A second private GUI regression removes Node from the desktop PATH and validates login-shell recovery, fresh/history sessions and manual Node settings/persistence/stale-path errors/clear. Additional private suites verify manual/AI names and preview without chat pollution, confirmed trash/cancellation, terminal visibility/context menus and clipboard interaction, restored window placement after restart, and passive send-triggered RPC failure/recovery. No cloud model request/authentication is required or claimed.

The install phase allows 75 minutes so the runtime's bounded 60-minute slow-download budget is not incorrectly cut short by the former four-minute test deadline. GUI/RPC tests retain their own shorter limits. The container exposes npm lifecycle logs via a per-command foreground setting, with no saved npm configuration change. Interactive buffered-npm progress is independently tested on a private PTY.

Docker x64 verifies the actual x64 public installation chain; arm64 is validated independently on a native GitHub Actions arm64 runner, not by pretending x64 Docker is an arm64 test.
