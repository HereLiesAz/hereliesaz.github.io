# HereLiesAz Admin — Android

This is the native Kotlin/Jetpack Compose rewrite of the web `/admin` surface.

Package: `com.hereliesaz.admin`

Feature parity includes GitHub token verification; live painting listing; metadata and for-sale editing; depth-layer previews and visibility overrides; multi-image source upload and batch Theater Bake selection; serialized painting removal; and site About/menu editing.

The GitHub PAT is encrypted at rest with Android Keystore (AES/GCM). The app talks directly to GitHub's REST API and live theater data. It is not a WebView wrapper.

The web admin remains available as a fallback until explicitly retired.

Tabs: **paintings**, **dedup**, **add**, **site**, **settings** (the web admin's tabs are paintings, add, site, settings).

## Where the work runs

The app only stages files, edits metadata and dispatches workflows. Bakes, removals, publishing and duplicate scans run in [`HereLiesAz/workflows`](https://github.com/HereLiesAz/workflows); the workflow files in this repository (`theater_bake.yml`, `publish_admin_staging.yml`, `remove_painting.yml`, `dedup_scan.yml`) are hand-off trackers. See `WORKFLOW.md`, "Where things run".

Two consequences:

- The app's message after **Bake N** means *queued*. The bake itself runs centrally, at about ten minutes per 20 photos, and the run shown in this repository's Actions tab is only the hand-off. Watch [HereLiesAz/workflows Actions](https://github.com/HereLiesAz/workflows/actions), then **Refresh** the paintings tab.
- Baked paintings are published to the `art-data` branch, which does not start a site deploy. They appear on the live site at the next `deploy.yml` run (on a three-hour schedule, or dispatch it from the web admin's "deploy now").

If dispatches do nothing, check that the repository's webhook is reaching the controller (**Settings → Webhooks → Recent deliveries**): central runs start from that webhook. The app reports dispatch failures in words (token rejected, token lacks Actions permission, workflow not found on `main`) rather than as an API path.

While `scripts/hinge_graph.skip` exists, bakes do not update the hinge graph; see `HINGE_GRAPH.md`.

## Artwork batches and baked-status filtering

In the **paintings** tab, the **all**, **baked**, and **not baked** filters use the live `art-data/theater/_manifest.json`. The text filter still works alongside them. An artwork with a source photo but no manifest entry is **not baked**; a manifest entry without a source photo is still **baked**. If the manifest cannot be read, the app reports that baked status is unavailable and prevents bulk baking rather than treating every photo as unbaked.

Long-press a photo to start selection, then tap additional photos. **Bake N unbaked** queues exactly the selected source-backed, not-yet-baked IDs in a single `theater_bake.yml` dispatch against `admin-staging`, after confirmation. Selected baked-only entries are excluded. A failed dispatch leaves the selection intact. This queues processing; it does not claim the bake has finished.

**add** can pick multiple images, which are copied into the persistent local draft. **Submit All** commits that batch to `admin-staging`; **Publish Site** is the separate flow for staged changes: it dispatches `publish_admin_staging.yml`, which bakes the staged additions, processes the removals, merges `admin-staging` into `main` and resets staging. Locally staged files cannot be selected for a direct bake until they have been submitted to the repository.

The **dedup** tab dispatches `dedup_scan.yml` (read-only, runs `scripts/dedup_scan.py`) and shows its report. The scan itself changes nothing; removals you pick from the report are staged like any other change.

## Build

~~~sh
chmod +x gradlew
./gradlew assembleDebug
~~~

The wrapper pins Gradle 9.7.1 (`gradle/wrapper/gradle-wrapper.properties`). No workflow builds the app: the Android CI and release workflows that once did are retired, so build and test locally.

## Releases and self-updates

The in-app Release tab and the APK build workflow no longer exist, so the app does not publish releases itself. Publish an APK as a GitHub Release named `admin-vX.Y.Z` by hand for the updater to find.

The Android app checks the repository's latest GitHub Release automatically at startup and also exposes a manual **check for updates** action in Settings.

When a newer `admin-vX.Y.Z` release contains an APK asset, the app can download it, verify GitHub's SHA-256 asset digest (an asset without one is refused, never installed unverified), confirm the APK package name, confirm its Android signing certificate matches the installed app, confirm its version code is newer, and then hand it to Android's package installer.

Android does not allow a normal third-party app to silently replace itself. On first use, Android may require enabling **Install unknown apps** for HereLiesAz Admin; after that, the system installer still presents the update confirmation.

### Stable signing requirement

Self-updates require all release APKs to use the same signing key. The Gradle build enforces this: any release-variant build (`assembleRelease`, `bundleRelease`, …) fails at `preReleaseBuild` unless `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set. Debug builds need none of them. R8 minification is intentionally off for release builds (see the comment in `app/build.gradle.kts`).

These are Android signing material only, not GitHub credentials.

## Look and feel

The app mirrors the web admin: black field, bone ink, monospace, square corners, no hues. Success and failure are marked with a check or cross, a disabled button has a dashed outline and a destructive one a double rule. The two colours are copied from `src/tokens.css` into `AdminUi.kt` and `themes.xml`, and `scripts/verify-tokens.mjs` (part of `npm run verify`) fails if they drift. See `AESTHETIC.md`, section 9.

## Gradle dependency submission compatibility

GitHub's repository-level **Automatic Dependency Submission (Gradle)** job expects standard Gradle wrapper metadata. This repository keeps its lightweight `gradlew` bootstrapper but also checks in `gradle/wrapper/gradle-wrapper.properties` (Gradle 9.7.1), so GitHub can detect the Gradle version instead of failing with “Cannot locate Gradle wrapper properties file”.
