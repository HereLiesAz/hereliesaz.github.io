package com.hereliesaz.admin

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class GitHubUpdater(private val context: Context) {
    suspend fun checkForUpdate(): UpdateInfo? = withContext(Dispatchers.IO) {
        val conn = (URL(LATEST_RELEASE_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        }
        try {
            val code = conn.responseCode
            if (code == 404) return@withContext null
            if (code !in 200..299) error("GitHub update check failed: HTTP $code")
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val tag = json.optString("tag_name")
            val version = tag.removePrefix("admin-v").removePrefix("v")
            if (version.isBlank() || compareVersions(version, BuildConfig.VERSION_NAME) <= 0) {
                return@withContext null
            }

            val assets = json.optJSONArray("assets") ?: return@withContext null
            var asset: JSONObject? = null
            for (i in 0 until assets.length()) {
                val candidate = assets.getJSONObject(i)
                if (candidate.optString("name").endsWith(".apk", ignoreCase = true)) {
                    asset = candidate
                    break
                }
            }
            val apk = asset ?: return@withContext null
            UpdateInfo(
                version = version,
                tag = tag,
                name = json.optString("name", tag),
                notes = json.optString("body"),
                downloadUrl = apk.getString("browser_download_url"),
                assetName = apk.getString("name"),
                assetDigest = apk.optString("digest").takeIf { it.startsWith("sha256:") },
            )
        } finally {
            conn.disconnect()
        }
    }

    suspend fun downloadAndValidate(update: UpdateInfo): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val file = File(dir, update.assetName)
        val conn = (URL(update.downloadUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) error("APK download failed: HTTP $code")
            conn.inputStream.use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
        } finally {
            conn.disconnect()
        }

        update.assetDigest?.let { expected ->
            val actual = "sha256:" + sha256(file)
            if (!actual.equals(expected, ignoreCase = true)) {
                file.delete()
                error("Downloaded APK digest does not match GitHub's release digest.")
            }
        }

        validatePackageAndSignature(file)
        file
    }

    fun launchInstaller(file: File): Boolean {
        val pm = context.packageManager
        if (!pm.canRequestPackageInstalls()) {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.packageName),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return false
        }

        val uri = FileProvider.getUriForFile(
            context,
            context.packageName + ".files",
            file,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
        return true
    }

    private fun validatePackageAndSignature(file: File) {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(
            file.absolutePath,
            PackageManager.GET_SIGNING_CERTIFICATES,
        ) ?: error("Downloaded file is not a valid Android package.")

        if (archive.packageName != context.packageName) {
            error("Downloaded APK package name does not match this app.")
        }

        val installed = pm.getPackageInfo(
            context.packageName,
            PackageManager.GET_SIGNING_CERTIFICATES,
        )
        val installedCerts = signingDigests(installed)
        val archiveCerts = signingDigests(archive)
        if (installedCerts.isEmpty() || archiveCerts.isEmpty() || installedCerts.intersect(archiveCerts).isEmpty()) {
            error(
                "Downloaded APK is signed with a different certificate. " +
                    "Self-update was blocked to protect the installed app.",
            )
        }

        if (archive.longVersionCode <= installed.longVersionCode) {
            error(
                "Downloaded APK is not newer than the installed app " +
                    "(downloaded versionCode " + archive.longVersionCode +
                    ", installed versionCode " + installed.longVersionCode + ").",
            )
        }
    }

    private fun signingDigests(info: PackageInfo): Set<String> {
        val signing = info.signingInfo ?: return emptySet()
        val signatures = if (signing.hasMultipleSigners()) {
            signing.apkContentsSigners
        } else {
            signing.signingCertificateHistory
        }
        return signatures.map { signature ->
            MessageDigest.getInstance("SHA-256")
                .digest(signature.toByteArray())
                .joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val LATEST_RELEASE_URL =
            "https://api.github.com/repos/HereLiesAz/hereliesaz.github.io/releases/latest"

        private fun compareVersions(a: String, b: String): Int {
            fun parts(value: String) = value
                .substringBefore('-')
                .split('.')
                .map { it.toIntOrNull() ?: 0 }

            val left = parts(a)
            val right = parts(b)
            val count = maxOf(left.size, right.size)
            for (i in 0 until count) {
                val x = left.getOrElse(i) { 0 }
                val y = right.getOrElse(i) { 0 }
                if (x != y) return x.compareTo(y)
            }
            return 0
        }
    }
}
