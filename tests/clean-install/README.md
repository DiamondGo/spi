# Clean public-install test (Linux x64)

This image contains Node/Pi and desktop prerequisites, but **no sPi binary, package, configuration or npm/GitHub credentials**. Docker's build context is allowlisted to the Dockerfile and three test scripts. The test installs the published package from the public npm registry and downloads binaries from the public GitHub Release.

```bash
docker build -f tests/clean-install/Dockerfile -t spi-clean-install .
docker run --rm --init --shm-size=512m --security-opt seccomp=unconfined spi-clean-install
# Also verify the README's unversioned/latest install in another fresh container:
docker run --rm --init --shm-size=512m --security-opt seccomp=unconfined \
  -e SPI_VERIFY_PACKAGE=spi-agent-gui -e SPI_EXPECTED_VERSION=0.1.1 spi-clean-install
```

The process runs as the non-root `node` user. There are no host mounts, host X sockets, authentication variables, privileged mode or additional capabilities. The outer Docker seccomp profile is relaxed solely to allow Chromium to create its own sandbox namespaces; **the application is not started with `--no-sandbox`**. The test explicitly asserts that an owned Chromium renderer has `NoNewPrivs=1` and its own `Seccomp=2` filter. Host policies may independently restrict user namespaces; do not disable the application's sandbox to make this test pass.

Checks: pristine environment; `pi install npm:spi-agent-gui@0.1.1`; owned Linux desktop entry and new spy icon (including the actual native window icon); spi next to user-owned pi on PATH; version/doctor; actual Pi extension command registration; native PTY; real Electron GUI on a private Xvfb display; real Pi RPC permission handshake; repeated cwd forwarding to one session; renderer sandbox. No cloud model request/authentication is required or claimed.

Docker x64 verifies the actual x64 public installation chain; arm64 is validated independently on a native GitHub Actions arm64 runner, not by pretending x64 Docker is an arm64 test.
