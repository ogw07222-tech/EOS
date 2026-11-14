# TERRA Android VirtualDisplay test setup

This setup reuses the ECLIPSE host app to create and capture an off-screen Android display. The host APK and ECLIPSE files are not modified. TERRA runs as a development server in Termux and a TERRA-only Android WebView host displays it on the virtual display.

## Isolated TERRA server

Run from the TERRA checkout. This uses a dedicated port and a temporary save directory so the normal `data/worlds` saves are untouched:

```sh
mkdir -p "$TMPDIR/terra-vd/worlds"
TERRA_SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')" \
PORT=38173 \
TERRA_SAVE_DIR="$TMPDIR/terra-vd/worlds" \
NODE_ENV=development npm run dev
```

The server listens on the local Android host at port 38173. The development panel is only enabled in this development process. Load `http://127.0.0.1:38173/` through the TERRA WebView host below. Stop the process with Ctrl+C; its disposable save data can be removed from `$TMPDIR/terra-vd`.

## Android browser routing and TERRA WebView host

On the tested SM-X820, the Samsung Internet Activity did not stay on a virtual display after an explicit `am start --display 16`; Android/Samsung placed its task under the physical display's hidden `MinimizedDesk` freeform root. Do not use the browser Activity for this test. The separately built `dev.terra.vdtest` app hosts Android System WebView, accepts only `127.0.0.1:38173`, and exits before loading if Android gives it Display 0.

Build and install only the TERRA test app:

```sh
cd ~/EOS
sh android-vd-host/build.sh
adb install -r android-vd-host/build/terra-vdtest.apk
```

For a disposable farming fixture, initialize an isolated save directory and cookie before starting the server. Keep these exports in the same shell session:

```sh
export TERRA_SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export TERRA_SAVE_DIR="$TMPDIR/terra-vd-qa/worlds"
export TERRA_QA_COOKIE_FILE="$TMPDIR/terra-vd-qa/cookie.txt"
mkdir -p "$TERRA_SAVE_DIR"
node android-vd-host/prepare-fixture.mjs
PORT=38173 NODE_ENV=development node server.mjs
```

The fixture supplies a wooden hoe, watering can, seeds and mature crops to this throwaway guest only. It is a UI interaction fixture, not a new player progression balance. Use the live display ID after confirming ownership and `removeMode 1`:

```sh
QA_COOKIE="$(cat "$TERRA_QA_COOKIE_FILE")"
adb shell am start --user 0 --display DISPLAY_ID \
  -n dev.terra.vdtest/.BrowserActivity \
  -a android.intent.action.VIEW -d http://127.0.0.1:38173/ \
  --es terraCookie "$QA_COOKIE"
```

Verify the host's `CREATE display=<ID>` log and Window Manager `mDisplayId=<ID>` before interaction. Capture only through the existing ECLIPSE host's owned Surface, and send touch commands only with `adb shell input -d DISPLAY_ID ...`. The TERRA host records `files/webgl.csv` and `files/touches.csv`; retrieve them with `adb exec-out run-as dev.terra.vdtest cat files/<name>`. Source, build output and evidence are under [`android-vd-host`](../android-vd-host/).

## ECLIPSE virtual display control

Use the existing ECLIPSE host lifecycle commands without rebuilding or reinstalling it:

```sh
cd ~/eclipse-studio/studio/virtual-display
sh scripts/termux-vd.sh status
```

If no display is active, start the already-installed host with `sh scripts/termux-vd.sh start` and note the returned display ID. Before opening TERRA or sending input, inspect `state.json` and `cmd display get-displays`; confirm that the live nonzero display is owned by `dev.eclipse.vdisplay`, is 1280×720, and reports `removeMode 1`. Samsung Internet routed to Display 0 on the tested firmware, and Chrome was not running; do not use a browser Activity for this QA. The shared `vd.py` controller hard-codes the ECLIPSE game package and display name, so its `launch`, `input`, and `snapshot` commands must not be used for TERRA. Launch only `dev.terra.vdtest/.BrowserActivity` with the explicit `--display DISPLAY_ID` command above. Send test input only to the checked display ID:

```sh
adb shell input -d DISPLAY_ID tap X Y
```

Replace `DISPLAY_ID` only with the ID just verified against the live display. For a screenshot, request the existing host's capture and copy its app-owned PNG:

```sh
adb shell am start-foreground-service --user 0 \
  -n dev.eclipse.vdisplay/.HostService \
  --es op snapshot --es request terra-browser
adb exec-out run-as dev.eclipse.vdisplay cat files/latest.png > terra-browser.png
```

Do not fall back to display 0 if the virtual display is missing or ownership checks fail. Stop the browser session and server, then stop the host with `sh scripts/termux-vd.sh stop`.

## Verified QA result (2026-11-14)

Wireless ADB reconnected as `127.0.0.1:45911` on an SM-X820. Live VirtualDisplay 16 was 1280×720, owned by `dev.eclipse.vdisplay`, with `removeMode 1`. Samsung Internet was routed into Display 0's hidden `MinimizedDesk`; it was not used for touches. The TERRA-only WebView host stayed on Display 16, rendered a 1280×720 WebGL canvas, and produced an owned-surface PNG with the TERRA island, HUD and developer panel visible. One intermediate camera-orbit capture was black while Android reported the virtual-display task sleeping; explicitly resuming the TERRA Activity on Display 16 restored frames and the final capture passed. The host's Display 0 guard and the recorded Window Manager display ID were checked. Every recorded QA touch had display ID 16.

Using touch inputs on Display 16 and the disposable fixture, QA successfully tilled tile `(0,0,0)`, planted a seed there, watered it (uses 10→9), waited until stage 4, and harvested the planted crop. Server state ended at revision 6 with 2 wheat, 5 seeds, and the planted crop ID in `harvestedCrops`. One early harvest tap missed the growing plant; after inspecting the secondary-display capture, the tap was aligned to the visible crop and the retry succeeded. The WebGL probe initially serialized a nested JSON string, preventing its CSV evidence write; the host logger was corrected, rebuilt, and revalidated with `webgl:true`. Details and evidence: [`android-vd-host/evidence`](../android-vd-host/evidence/).

No ECLIPSE APK/source/signing key or Android display setting was changed. The additional installed package is `dev.terra.vdtest`. No GitHub Actions were run. These results apply to the dedicated WebView host on this device; they do not establish Samsung Internet or Chrome support on secondary displays.
