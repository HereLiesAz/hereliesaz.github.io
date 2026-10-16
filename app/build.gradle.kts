import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val canonicalVersionProperties = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}
fun canonicalVersionPart(name: String, range: IntRange): Int {
    val value = canonicalVersionProperties.getProperty(name)?.toIntOrNull()
        ?: error("version.properties is missing a valid $name")
    require(value in range) { "$name=$value is outside Android versionCode bounds $range" }
    return value
}

val canonicalMajor = canonicalVersionPart("versionMajor", 0..20)
val canonicalMinor = canonicalVersionPart("versionMinor", 0..99)
val canonicalPatch = canonicalVersionPart("versionPatch", 0..99)
val canonicalBuild = canonicalVersionPart("versionBuild", 0..9999)
val canonicalVersionName = "$canonicalMajor.$canonicalMinor.$canonicalPatch.$canonicalBuild"
val canonicalVersionCodeLong =
    canonicalMajor * 100_000_000L +
        canonicalMinor * 1_000_000L +
        canonicalPatch * 10_000L +
        canonicalBuild
require(canonicalVersionCodeLong <= 2_100_000_000L) {
    "Canonical version $canonicalVersionName exceeds Android's versionCode limit"
}
val canonicalVersionCode = canonicalVersionCodeLong.toInt()

val signingStoreFile = System.getenv("ANDROID_KEYSTORE_FILE")
val signingStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val signingKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
val signingKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")
val releaseSigningAvailable = listOf(
    signingStoreFile, signingStorePassword, signingKeyAlias, signingKeyPassword,
).none { it.isNullOrBlank() }

android {
    namespace = "com.hereliesaz.admin"
    // compileSdk tracks the newest SDK so the latest AndroidX/Compose
    // artifacts (which require it) can be used; targetSdk deliberately stays
    // one level behind until this app's runtime behaviour has been checked
    // against the newer platform's behaviour changes. Bump targetSdk only
    // after testing on that API level.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.hereliesaz.admin"
        minSdk = 28
        targetSdk = 36
        versionCode = canonicalVersionCode
        versionName = canonicalVersionName
    }

    val releaseSigning = if (
        !signingStoreFile.isNullOrBlank() &&
        !signingStorePassword.isNullOrBlank() &&
        !signingKeyAlias.isNullOrBlank() &&
        !signingKeyPassword.isNullOrBlank()
    ) {
        signingConfigs.create("release") {
            storeFile = file(signingStoreFile)
            storePassword = signingStorePassword
            keyAlias = signingKeyAlias
            keyPassword = signingKeyPassword
        }
    } else {
        null
    }

    buildTypes {
        getByName("release") {
            // R8 minification is intentionally OFF: the app is small, uses no
            // reflection-heavy libraries, and shrinking adds a class of
            // release-only bugs for little gain. (There is therefore no
            // proguard-rules.pro.) Revisit only with a tested keep-rule set.
            isMinifyEnabled = false
            releaseSigning?.let { signingConfig = it }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

// A release build without signing material would produce an unsigned (or
// debug-signed) APK that can never self-update over an existing install
// (see docs/ANDROID_ADMIN.md "Stable signing requirement"). Fail any
// release-variant build up front instead of at install time. Debug builds
// are unaffected.
val missingReleaseSigning = !releaseSigningAvailable
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        if (missingReleaseSigning) {
            throw GradleException(
                "Release signing is not configured: set ANDROID_KEYSTORE_FILE, " +
                    "ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD.",
            )
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
