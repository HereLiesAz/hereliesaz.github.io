#!/usr/bin/env sh
set -eu
GRADLE_VERSION="9.6.0"
ROOT="$HOME/.gradle/hereliesaz-admin/gradle-$GRADLE_VERSION"
BIN="$ROOT/gradle-$GRADLE_VERSION/bin/gradle"
ZIP="$ROOT/gradle-$GRADLE_VERSION-bin.zip"
if [ ! -x "$BIN" ]; then
  mkdir -p "$ROOT"
  if [ ! -f "$ZIP" ]; then
    curl -fL "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip" -o "$ZIP"
  fi
  unzip -q -o "$ZIP" -d "$ROOT"
fi
exec "$BIN" "$@"
