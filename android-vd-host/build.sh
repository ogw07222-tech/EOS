#!/data/data/com.termux/files/usr/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
JDK=${VD_JAVA_HOME:-/data/data/com.termux/files/usr/lib/jvm/java-17-openjdk}
SDK=${ANDROID_HOME:-$HOME/android-sdk}
PREFIX=${PREFIX:-/data/data/com.termux/files/usr}
JAR="$SDK/platforms/android-36/android.jar"
mkdir -p "$ROOT/build/classes" "$ROOT/build/dex" "$ROOT/private"
"$JDK/bin/javac" -source 8 -target 8 -bootclasspath "$JAR:$SDK/build-tools/35.0.0/core-lambda-stubs.jar" -d "$ROOT/build/classes" "$ROOT"/src/dev/terra/vdtest/*.java
"$JDK/bin/jar" cf "$ROOT/build/classes.jar" -C "$ROOT/build/classes" .
"$JDK/bin/java" -cp "$PREFIX/share/java/d8.jar" com.android.tools.r8.D8 --lib "$JAR" --min-api 29 --output "$ROOT/build/dex" "$ROOT/build/classes.jar"
"$PREFIX/bin/aapt2" link -I "$JAR" --manifest "$ROOT/AndroidManifest.xml" -o "$ROOT/build/unsigned.apk"
python3 - "$ROOT" <<'PY'
import sys,zipfile
from pathlib import Path
r=Path(sys.argv[1])
with zipfile.ZipFile(r/'build/unsigned.apk','a') as z: z.write(r/'build/dex/classes.dex','classes.dex')
PY
if [ ! -f "$ROOT/private/terra-vdtest.p12" ]; then
 "$JDK/bin/keytool" -genkeypair -keystore "$ROOT/private/terra-vdtest.p12" -storepass android -keypass android -alias terra-vdtest -dname 'CN=TERRA VirtualDisplay QA' -keyalg RSA -validity 3650
fi
"$JDK/bin/java" -jar "$PREFIX/share/java/apksigner.jar" sign --ks "$ROOT/private/terra-vdtest.p12" --ks-pass pass:android --out "$ROOT/build/terra-vdtest.apk" "$ROOT/build/unsigned.apk"
"$JDK/bin/java" -jar "$PREFIX/share/java/apksigner.jar" verify --verbose "$ROOT/build/terra-vdtest.apk"
sha256sum "$ROOT/build/terra-vdtest.apk"
