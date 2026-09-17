# HereLiesAz Admin — Android

This is the native Kotlin/Jetpack Compose rewrite of the web `/admin` surface.

Package: `com.hereliesaz.admin`

Feature parity includes GitHub token verification; live painting listing; metadata and for-sale editing; depth-layer previews and visibility overrides; multi-image source upload plus targeted Theater Bake dispatch; serialized painting removal; and site About/menu editing.

The GitHub PAT is encrypted at rest with Android Keystore (AES/GCM). The app talks directly to GitHub's REST API and live theater data. It is not a WebView wrapper.

The web admin remains available as a fallback until explicitly retired.

## Build

```sh
chmod +x gradlew
./gradlew assembleDebug
```

The bootstrap script pins Gradle 9.6.0. Android CI runs only when native project files change.
