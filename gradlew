#!/usr/bin/env sh
# NOT the standard Gradle wrapper — a deliberately tiny bootstrapper for the
# app/ Android admin client. It downloads the pinned Gradle distribution
# (same version/checksum as gradle/wrapper/gradle-wrapper.properties, which
# exists so GitHub's dependency-submission job can detect the version) into
# ~/.gradle/hereliesaz-admin/, verifies its SHA-256, and execs it. There is
# no gradle-wrapper.jar. Keep GRADLE_VERSION and the checksum in sync with
# gradle-wrapper.properties when upgrading. Needs curl, unzip and sha256sum.
# gradlew.bat is the Windows counterpart. See docs/ANDROID_ADMIN.md.
set -eu
GRADLE_VERSION="9.7.1"
ROOT="$HOME/.gradle/hereliesaz-admin/gradle-$GRADLE_VERSION"
BIN="$ROOT/gradle-$GRADLE_VERSION/bin/gradle"
ZIP="$ROOT/gradle-$GRADLE_VERSION-bin.zip"
if [ ! -x "$BIN" ]; then
  mkdir -p "$ROOT"
  if [ ! -f "$ZIP" ]; then
    curl -fL "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip" -o "$ZIP"
  fi
  echo "acd53f1edaf02f1a8ff99879f8a34b302661a057d9b063ae9e35b552f804d20a  $ZIP" | sha256sum -c -
  unzip -q -o "$ZIP" -d "$ROOT"
fi
exec "$BIN" "$@"
