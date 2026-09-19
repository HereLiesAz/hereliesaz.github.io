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

Publishing is controlled from inside the Android app.

1. Open **Release**.
2. Enter `gh_token`.
3. Tap **save & verify gh_token**. The token persists locally, encrypted with Android Keystore.
4. Enter the version and optional release notes.
5. Tap **build & publish GitHub Release**.

The app uses the saved `gh_token` to dispatch `.github/workflows/android-release-apk.yml`. That workflow has read-only repository permission, uses checkout with `persist-credentials: false`, builds/tests the APK, and uploads a short-lived Actions artifact. It does **not** receive a publish token and cannot create a GitHub Release.

The app then waits for the exact build request, downloads its APK artifact using the saved `gh_token`, creates the GitHub Release directly through the GitHub API, and uploads the APK asset.

There is no repository `GH_TOKEN` secret requirement and no fallback to `github.token` or `GITHUB_TOKEN` for publishing. Existing installations still migrate the prior encrypted `github_pat` value to the local `gh_token` field on first load.


## Self-updates from GitHub Releases

The Android app checks the repository's latest GitHub Release automatically at startup and also exposes a manual **check for updates** action in Settings.

When a newer `admin-vX.Y.Z` release contains an APK asset, the app can download it, verify GitHub's SHA-256 digest when supplied, confirm the APK package name, confirm its Android signing certificate matches the installed app, confirm its version code is newer, and then hand it to Android's package installer.

Android does not allow a normal third-party app to silently replace itself. On first use, Android may require enabling **Install unknown apps** for HereLiesAz Admin; after that, the system installer still presents the update confirmation.

### Stable signing requirement

Self-updates require all release APKs to use the same signing key. The GitHub release-build workflow therefore refuses to build a release APK unless these Actions secrets exist:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

These are Android signing material only. They are not GitHub publishing credentials. GitHub Release publishing remains controlled exclusively by the `gh_token` saved inside the Android app.

The workflow builds `assembleRelease`, assigns a monotonically increasing version code, and uploads that signed APK as the artifact the app later publishes to GitHub Releases.
