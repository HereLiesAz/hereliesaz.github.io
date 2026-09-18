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


## GitHub Release publishing

APK publishing is manual-only through `.github/workflows/android-release-apk.yml`.

The workflow deliberately does **not** publish with `github.token` or `GITHUB_TOKEN`. It requires a persistent repository Actions secret named `GH_TOKEN`. If that secret is absent, the workflow fails before checkout/build/publish. The release job also uses `persist-credentials: false` on checkout and supplies `GH_TOKEN` only to the explicit GitHub CLI verification/publish steps.

To configure it, save a fine-grained GitHub token as the repository secret `GH_TOKEN`, scoped to this repository with permission to create releases / write repository contents. Then manually run **Publish Android APK Release** and supply a version.

The Android app itself stores its user-entered credential under the setting name `gh_token`, encrypted with Android Keystore. Existing installations migrate the previous encrypted `github_pat` value to `gh_token` on first load.
