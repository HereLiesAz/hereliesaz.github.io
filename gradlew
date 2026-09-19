#!/usr/bin/env sh
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
