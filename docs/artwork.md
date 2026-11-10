# Application icon — Nightfall

<img src="../resources/icon.svg" width="192" height="192" alt="sPi female-spy silhouette icon" />

The original artwork in `resources/icon.svg` depicts a female spy in profile: a tilted fedora, flowing hair, winged eye and trench coat. Ivory and coral silhouettes contrast with a midnight background. It uses no external icon pack, font, photo or remote image; the project's licensing is unchanged.

## Build

`npm run build:icons` deterministically generates ignored files in `build/icons/`:

- `icon.png`: 512px, for Linux and native windows.
- `icon.ico`: 16/24/32/48/64/128/256px PNG representations for Windows packaging.
- `icon.icns`: standard and Retina PNG representations through 1024px for future macOS packaging.

Vite automatically runs the generator for development, builds and preview. Electron Builder explicitly selects the platform icon and copies the window PNG into application resources. The renderer also uses the original SVG as its favicon. Only the vector source and generator are tracked; generated binary assets are not committed.

On Linux, the application identifies itself as `spi.desktop`. Default personal installs can create an ownership-tracked entry in `$XDG_DATA_HOME/applications/spi.desktop` (default `~/.local/share/applications`) with the custom icon, so desktop shells can associate the window with it. Unknown/modified entries and linked directories are not overwritten. Updates/rollback refresh the owned entry, and uninstall checks ownership before removal. Custom runtime roots do not automatically modify the user's desktop entries.

## Verification and release scope

- `npm run test:icons`: PNG/ICO/ICNS dimensions, deterministic generation, desktop escaping/ownership/rollback and link protection.
- Installer tests additionally cover desktop-entry update, rollback, modified-entry protection and uninstall in temporary XDG roots.
- A Linux x64 unpacked build passed real PTY, GUI, Pi RPC and single-instance checks on a private Xvfb server. The test compared the packaged PNG with the generated artwork and checked the owned window's native `_NET_WM_ICON` representation plus the SVG favicon; the renderer sandbox remained enabled.
- The optional native-icon smoke assertion is enabled by `SPI_ASSERT_APP_ICON=1` and requires `xprop`/`xwininfo` on the isolated test display. Windows/macOS icon formats are validated, not claimed to have passed native application tests.

The artwork is included in Linux desktop Release v0.1.1. Its matching npm package is awaiting publication; existing Pi installs need that new launcher package for the owned desktop-entry integration. Published v0.1.0 assets/npm packages were not replaced. Close and reopen the application after installing the new version to refresh the running window's icon.
