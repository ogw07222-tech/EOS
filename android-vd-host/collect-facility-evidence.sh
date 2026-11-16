#!/bin/sh
# Safe raw-evidence collector for TERRA on the ECLIPSE-owned virtual display.
# It never starts an Activity or sends input. DISPLAY_ID and evidence directory are mandatory.
set -eu

usage() {
  echo "Usage: TERRA_QA_COOKIE_FILE=/path/to/cookie TERRA_BASE_URL=http://127.0.0.1:38173 $0 DISPLAY_ID EMPTY_EVIDENCE_DIR" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
display_id=$1
evidence_dir=$2
case "$display_id" in ''|*[!0-9]*|0) echo "Refusing display ID '$display_id'; only a verified nonzero display is allowed." >&2; exit 2;; esac
[ -n "${TERRA_QA_COOKIE_FILE:-}" ] || { echo 'TERRA_QA_COOKIE_FILE is required; cookie contents are never copied to evidence.' >&2; exit 2; }
[ -r "$TERRA_QA_COOKIE_FILE" ] || { echo 'QA cookie file is not readable.' >&2; exit 2; }
base_url=${TERRA_BASE_URL:-http://127.0.0.1:38173}
adb_bin=${ADB_BIN:-adb}
command -v "$adb_bin" >/dev/null 2>&1 || { echo 'adb was not found.' >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo 'curl was not found.' >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo 'python3 was not found.' >&2; exit 2; }

if [ -n "${ANDROID_SERIAL:-}" ]; then
  serial=$ANDROID_SERIAL
  state=$("$adb_bin" -s "$serial" get-state 2>/dev/null || true)
  [ "$state" = device ] || { echo "ADB_SERIAL '$serial' is not an online device." >&2; exit 3; }
else
  online=$("$adb_bin" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  count=$(printf '%s\n' "$online" | awk 'NF { n++ } END { print n+0 }')
  [ "$count" -eq 1 ] || { echo "Expected exactly one online ADB device or an explicit ANDROID_SERIAL; found $count." >&2; exit 3; }
  serial=$online
fi
adb() { "$adb_bin" -s "$serial" "$@"; }

# Do not overwrite existing user or prior evidence directories.
if [ -e "$evidence_dir" ] && [ -n "$(find "$evidence_dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  echo "Evidence directory is not empty; refusing to overwrite: $evidence_dir" >&2
  exit 2
fi
mkdir -p "$evidence_dir"

model=$(adb shell getprop ro.product.model | tr -d '\r')
release=$(adb shell getprop ro.build.version.release | tr -d '\r')
displays=$(adb shell cmd display get-displays)
display_line=$(printf '%s\n' "$displays" | grep -F "Display id $display_id:" || true)
[ -n "$display_line" ] || { echo "Display $display_id is absent from the live display list." >&2; exit 4; }
printf '%s' "$display_line" | grep -F 'type VIRTUAL' >/dev/null || { echo "Display $display_id is not virtual." >&2; exit 4; }
printf '%s' "$display_line" | grep -F 'owner dev.eclipse.vdisplay' >/dev/null || { echo "Display $display_id is not owned by dev.eclipse.vdisplay." >&2; exit 4; }
printf '%s' "$display_line" | grep -F '1280 x 720' >/dev/null || { echo "Display $display_id is not 1280x720." >&2; exit 4; }
printf '%s' "$display_line" | grep -F 'removeMode 1' >/dev/null || { echo "Display $display_id does not report removeMode 1." >&2; exit 4; }

display_dump=$(adb shell dumpsys display)
window_dump=$(adb shell dumpsys window displays)
unique_id=$(printf '%s\n' "$display_line" | sed -n 's/.*uniqueId "\([^"]*\)".*/\1/p')
case "$unique_id" in virtual:dev.eclipse.vdisplay,*) :;; *) echo "Display $display_id has no ECLIPSE virtual unique ID." >&2; exit 4;; esac
printf '%s\n' "$display_dump" | grep -F "mUniqueId=$unique_id" >/dev/null || { echo 'DisplayManager does not associate the target ID with its ECLIPSE unique ID.' >&2; exit 4; }
printf '%s\n' "$window_dump" | grep -F "$unique_id" >/dev/null || { echo 'WindowManager has no target ECLIPSE display identity.' >&2; exit 4; }
printf '%s\n' "$window_dump" | grep -F 'mWindowManagerMirroring=false' >/dev/null || { echo 'WindowManager mirroring is enabled or cannot be verified.' >&2; exit 4; }
printf '%s\n' "$display_dump" | grep -F 'FLAG_OWN_CONTENT_ONLY' >/dev/null || { echo 'DisplayManager does not report FLAG_OWN_CONTENT_ONLY.' >&2; exit 4; }

activity_dump=$(adb shell dumpsys activity activities)
printf '%s\n' "$activity_dump" | awk -v target="$display_id" '
  /Display #[0-9]+ \(activities from top to bottom\):/ {
    id=$2; sub("#", "", id); active=(id==target); onzero=(id==0); next
  }
  active && /dev\.terra\.vdtest\/.BrowserActivity/ { found=1 }
  onzero && /dev\.terra\.vdtest\/.BrowserActivity/ { bad=1 }
  END { if (found && !bad) exit 0; exit 1 }
' || { echo "TERRA BrowserActivity is not verified on Display $display_id or is also present on Display 0." >&2; exit 4; }

# Validate the browser server's world identity and ensure its served modules match this checkout.
qa_cookie=$(cat "$TERRA_QA_COOKIE_FILE")
[ -n "$qa_cookie" ] || { echo 'QA cookie file is empty.' >&2; exit 2; }
world_json=$(curl -fsS -H "Cookie: $qa_cookie" "$base_url/api/world")
unset qa_cookie
printf '%s' "$world_json" | python3 -c 'import json,sys; w=json.load(sys.stdin); g=w.get("worldGenVersion"); seed=w.get("worldSeed"); kind=w.get("worldKind"); print(f"worldGenVersion={g} worldSeed={seed} worldKind={kind}"); sys.exit(0 if g==2 and isinstance(seed,int) and kind=="personal" else 1)' > "$evidence_dir/world-identity.txt" || { echo 'The server response is not a current v2 personal world; refusing to record it as current-build QA.' >&2; exit 5; }
printf 'server=%s\n' "$base_url" > "$evidence_dir/server.txt"
for module in index.html src/game.js src/terrain-atlas.js src/greedy-chunk-mesh.js src/nature-visuals.js src/workstation-visuals.js src/industrial-visuals.js; do
  local_hash=$(sha256sum "$module" | awk '{print $1}')
  served_hash=$(curl -fsS "$base_url/$module" | sha256sum | awk '{print $1}')
  [ "$local_hash" = "$served_hash" ] || { echo "Served content differs from local $module." >&2; exit 5; }
  printf '%s %s\n' "$local_hash" "$module" >> "$evidence_dir/client-sha256.txt"
done

{
  printf 'adb_serial=%s\nmodel=%s\nandroid_release=%s\ndisplay_id=%s\n' "$serial" "$model" "$release" "$display_id"
  printf '%s\n' "$display_line"
} > "$evidence_dir/device-display.txt"
printf '%s\n' "$displays" > "$evidence_dir/displays.txt"
printf '%s\n' "$activity_dump" > "$evidence_dir/activities.txt"
printf '%s\n' "$display_dump" > "$evidence_dir/dumpsys-display.txt"
printf '%s\n' "$window_dump" > "$evidence_dir/dumpsys-window-displays.txt"
adb shell dumpsys thermalservice > "$evidence_dir/thermal-before.txt"
adb shell dumpsys meminfo dev.terra.vdtest > "$evidence_dir/meminfo-before.txt" 2>&1 || true
adb shell dumpsys gfxinfo dev.terra.vdtest framestats > "$evidence_dir/gfxinfo-framestats.txt" 2>&1 || true
adb logcat -d -v time -s TERRAVD:I AndroidRuntime:E chromium:E > "$evidence_dir/logcat-before.txt"

# Use only the ECLIPSE host app-owned Surface. Never use screencap.
adb shell am start-foreground-service --user 0 -n dev.eclipse.vdisplay/.HostService --es op snapshot --es request terra-facility-qa >/dev/null
sleep 1
adb exec-out run-as dev.eclipse.vdisplay cat files/latest.png > "$evidence_dir/frame.png"
python3 - "$evidence_dir/frame.png" <<'PY'
import struct,sys
p=sys.argv[1]
d=open(p,'rb').read()
if d[:8]!=b'\x89PNG\r\n\x1a\n' or len(d)<24:
    raise SystemExit('Owned-surface capture is not a valid PNG')
w,h=struct.unpack('>II',d[16:24])
if (w,h)!=(1280,720):
    raise SystemExit(f'Unexpected capture dimensions {w}x{h}')
print(f'owned_surface_png=1280x720 bytes={len(d)}')
PY
adb exec-out run-as dev.terra.vdtest cat files/webgl.csv > "$evidence_dir/webgl.csv"
adb exec-out run-as dev.terra.vdtest cat files/touches.csv > "$evidence_dir/touches.csv" 2>/dev/null || :
adb logcat -d -v time -s TERRAVD:I AndroidRuntime:E chromium:E > "$evidence_dir/logcat-after.txt"
adb shell dumpsys thermalservice > "$evidence_dir/thermal-after.txt"
adb shell dumpsys meminfo dev.terra.vdtest > "$evidence_dir/meminfo-after.txt" 2>&1 || true
adb shell dumpsys gfxinfo dev.terra.vdtest framestats > "$evidence_dir/gfxinfo-framestats-after.txt" 2>&1 || true

printf 'Collected raw evidence in %s\n' "$evidence_dir"
printf 'No app was launched and no input was sent. Inspect logs, webgl.csv, touches.csv, and the owned-surface frame before interpreting results.\n'
