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

android {
    namespace = "com.hereliesaz.admin"
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
