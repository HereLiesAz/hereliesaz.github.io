package com.hereliesaz.admin

import android.app.Application
import android.content.ContentResolver
import android.graphics.Bitmap
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.zip.ZipInputStream

enum class AdminTab { Paintings, Add, Site, Release, Settings }

class AdminViewModel(application: Application) : AndroidViewModel(application) {
    private val tokenStore = TokenStore(application)
    private val api = GitHubApi(tokenStore)
    private val repo = AdminRepository(api)

    var authenticated by mutableStateOf(tokenStore.hasToken()); private set
    var tokenInput by mutableStateOf(tokenStore.load())
    var authMessage by mutableStateOf<String?>(null); private set
    var busy by mutableStateOf(false); private set
    var tab by mutableStateOf(AdminTab.Paintings)
    var paintings by mutableStateOf<List<String>?>(null); private set
    var meta by mutableStateOf<Map<String, PaintingMeta>>(emptyMap()); private set
    var filter by mutableStateOf("")
    var selectedId by mutableStateOf<String?>(null); private set
    var paintingForm by mutableStateOf(PaintingForm())
    var editorMessage by mutableStateOf<String?>(null); private set
    var removalDispatched by mutableStateOf(false); private set
    var chosenUris by mutableStateOf<List<Uri>>(emptyList()); private set
    var addMessage by mutableStateOf<String?>(null); private set
    var siteContent by mutableStateOf<SiteContent?>(null); private set
    var siteMessage by mutableStateOf<String?>(null); private set
    var bandPreviews by mutableStateOf<List<BandPreview>>(emptyList()); private set
    var bandHidden by mutableStateOf<Set<Int>>(emptySet()); private set
    var bandMessage by mutableStateOf<String?>(null); private set
    var bandLoading by mutableStateOf(false); private set
    var theaterMeta by mutableStateOf<TheaterMeta?>(null); private set

    var releaseVersion by mutableStateOf("")
    var releaseNotes by mutableStateOf("")
    var releasePrerelease by mutableStateOf(false)
    var releaseBusy by mutableStateOf(false); private set
    var releaseMessage by mutableStateOf<String?>(null); private set
    var releaseUrl by mutableStateOf<String?>(null); private set

    init { if (authenticated) refreshPaintings() }

    fun verifyAndSaveToken() {
        if (tokenInput.trim().isBlank()) { authMessage = "Enter a GitHub token."; return }
        tokenStore.save(tokenInput.trim()); busy = true; authMessage = "Checking…"
        viewModelScope.launch {
            try {
                val x = api.verifyToken()
                when {
                    !x.canWrite -> authMessage = "Token works but has no write access to the repository (logged in as " + x.login + ")."
                    !x.actionsOk -> authMessage = "Token can write Contents but cannot access Actions. Grant Actions: Read and write."
                    else -> { authenticated = true; authMessage = "Verified — write access confirmed."; refreshPaintings() }
                }
            } catch (e: Exception) { authenticated = false; authMessage = e.message }
            finally { busy = false }
        }
    }
    fun clearToken() {
        tokenStore.clear(); tokenInput = ""; authenticated = false; authMessage = null; paintings = null; selectedId = null
    }
    fun refreshPaintings() {
        if (!authenticated) return
        paintings = null
        viewModelScope.launch {
            try {
                paintings = repo.listBakedPaintings()
                meta = runCatching { repo.loadMeta() }.getOrDefault(emptyMap())
            } catch (e: Exception) { paintings = emptyList(); editorMessage = e.message }
        }
    }
    fun selectPainting(id: String) {
        selectedId = id; editorMessage = null; removalDispatched = false
        bandPreviews = emptyList(); bandHidden = emptySet(); theaterMeta = null
        val x = meta[id] ?: PaintingMeta()
        paintingForm = PaintingForm(
            x.title, x.description, x.tags.joinToString(", "), x.forSale,
            x.price?.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }.orEmpty(),
            x.currency,
        )
    }
    fun closePainting() {
        selectedId = null; editorMessage = null; removalDispatched = false
        bandPreviews.forEach { it.bitmap.recycle() }; bandPreviews = emptyList(); theaterMeta = null
    }
    fun savePainting() {
        val id = selectedId ?: return
        if (paintingForm.forSale && paintingForm.price.isBlank()) { editorMessage = "Marked “for sale” needs a price."; return }
        val price = paintingForm.price.toDoubleOrNull()
        if (paintingForm.forSale && (price == null || price < 0)) { editorMessage = "Price must be a non-negative number."; return }
        busy = true; editorMessage = "Saving…"
        viewModelScope.launch {
            try {
                val entry = PaintingMeta(
                    paintingForm.title.trim(), paintingForm.description.trim(),
                    paintingForm.tags.split(',').map { it.trim() }.filter { it.isNotBlank() },
                    paintingForm.forSale, if (paintingForm.forSale) price else null,
                    paintingForm.currency.trim().uppercase().ifBlank { "USD" },
                )
                repo.saveMetaEntry(id, entry); meta = meta + (id to entry); editorMessage = "Saved — live after the next deploy."
            } catch (e: Exception) { editorMessage = e.message }
            finally { busy = false }
        }
    }
    fun removePainting() {
        val id = selectedId ?: return
        busy = true; removalDispatched = false
        editorMessage = "Waiting for a safe removal slot. Existing removal runs are allowed to finish first."
        viewModelScope.launch {
            try { repo.removePainting(id); removalDispatched = true; editorMessage = "Removal completed and dispatched. Refresh the list after the site redeploys." }
            catch (e: RemovalException) { removalDispatched = e.dispatched; editorMessage = e.message }
            catch (e: Exception) { editorMessage = e.message }
            finally { busy = false }
        }
    }
    fun chooseUris(uris: List<Uri>) { chosenUris = uris; addMessage = null }
    fun uploadChosen(resolver: ContentResolver) {
        if (chosenUris.isEmpty()) return
        busy = true; addMessage = "Uploading…"
        viewModelScope.launch {
            val uploaded = mutableListOf<String>(); var failure: Exception? = null; var failedAt = -1
            for ((index, uri) in chosenUris.withIndex()) {
                try {
                    val name = displayName(resolver, uri) ?: "photo"
                    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Could not read $name")
                    uploaded += repo.uploadPainting(PickedFile(name, bytes))
                } catch (e: Exception) { failure = e; failedAt = index; break }
            }
            try {
                if (uploaded.isNotEmpty()) { addMessage = "Dispatching bake for " + uploaded.joinToString(", ") + "…"; repo.dispatchBake(uploaded) }
                if (failure != null) {
                    chosenUris = chosenUris.drop(failedAt)
                    addMessage = "Uploaded and dispatched " + uploaded.joinToString(", ") + "; stopped after: " + failure.message + ". " + chosenUris.size + " file(s) remain selected."
                } else { chosenUris = emptyList(); addMessage = "Uploaded and dispatched: " + uploaded.joinToString(", ") + "." }
            } catch (e: Exception) {
                chosenUris = chosenUris.drop(uploaded.size)
                addMessage = "Uploaded " + uploaded.joinToString(", ") + " but bake dispatch failed: " + e.message + ". The source files are already on main."
            } finally { busy = false }
        }
    }
    fun loadSite() {
        if (siteContent != null) return
        viewModelScope.launch { siteContent = runCatching { repo.loadSiteContent() }.getOrDefault(SiteContent()) }
    }
    fun setSite(x: SiteContent) { siteContent = x; if (siteMessage?.startsWith("Saved") == true) siteMessage = null }
    fun saveSite() {
        val x = siteContent ?: return
        busy = true; siteMessage = "Saving…"
        viewModelScope.launch {
            try { repo.saveSiteContent(x); siteMessage = "Saved — live after the next deploy." }
            catch (e: Exception) { siteMessage = e.message }
            finally { busy = false }
        }
    }
    fun loadBands() {
        val id = selectedId ?: return
        if (bandLoading || bandPreviews.isNotEmpty()) return
        bandLoading = true; bandMessage = "Loading layers…"
        viewModelScope.launch {
            try {
                val t = repo.fetchTheaterMeta(id) ?: error("This painting has no theater metadata.")
                val hidden = repo.loadBandOverrides()[id].orEmpty()
                theaterMeta = t; bandHidden = hidden; bandPreviews = repo.buildBandPreviews(id, t, hidden); bandMessage = null
            } catch (e: Exception) { bandMessage = e.message }
            finally { bandLoading = false }
        }
    }
    fun toggleBand(index: Int) {
        bandHidden = bandHidden.toMutableSet().apply { if (!add(index)) remove(index) }
        bandPreviews = bandPreviews.map { it.copy(hidden = it.index in bandHidden) }
        if (bandMessage?.startsWith("Saved") == true) bandMessage = null
    }
    fun saveBands() {
        val id = selectedId ?: return
        if (bandPreviews.isNotEmpty() && bandHidden.size >= bandPreviews.size) { bandMessage = "At least one layer must stay visible."; return }
        busy = true; bandMessage = "Saving layers…"
        viewModelScope.launch {
            try { repo.saveBandOverrideEntry(id, bandHidden); bandMessage = "Saved — live after the next deploy." }
            catch (e: Exception) { bandMessage = e.message }
            finally { busy = false }
        }
    }
    fun publishRelease() {
        val version = releaseVersion.trim()
        if (version.isBlank()) {
            releaseMessage = "Enter a release version."
            return
        }
        if (!tokenStore.hasToken()) {
            releaseMessage = "Save and verify gh_token in this app before publishing."
            return
        }

        releaseBusy = true
        releaseUrl = null
        releaseMessage = "Starting credential-free APK build…"

        viewModelScope.launch {
            val requestId = UUID.randomUUID().toString()
            try {
                api.dispatchWorkflow(
                    "android-release-apk.yml",
                    mapOf(
                        "version" to version,
                        "request_id" to requestId,
                    ),
                )

                releaseMessage = "Build requested. Waiting for GitHub Actions…"
                val run = waitForReleaseRun(requestId)
                if (run.conclusion != "success") {
                    error("APK build failed with conclusion: " + (run.conclusion ?: "unknown"))
                }

                releaseMessage = "Build finished. Downloading APK artifact…"
                val artifact = api.listRunArtifacts(run.id)
                    .firstOrNull { it.name == "admin-apk-$requestId" && !it.expired }
                    ?: error("Build succeeded but its APK artifact was not found.")

                val zipBytes = api.downloadArtifactZip(artifact.id)
                val apkBytes = extractApk(zipBytes)
                val safeVersion = version.replace(Regex("[^0-9A-Za-z._-]"), "-")
                val tag = "admin-v$safeVersion"
                val filename = "HereLiesAz-Admin-$safeVersion.apk"
                val notes = releaseNotes.trim().ifBlank {
                    "Native HereLiesAz Admin Android release $version."
                }

                releaseMessage = "Creating GitHub Release with the saved gh_token…"
                val (releaseId, url) = api.createRelease(
                    tag = tag,
                    name = "HereLiesAz Admin $version",
                    notes = notes,
                    prerelease = releasePrerelease,
                )
                api.uploadReleaseAsset(releaseId, filename, apkBytes)

                releaseUrl = url
                releaseMessage = "Published $tag with $filename."
            } catch (e: Exception) {
                releaseMessage = e.message ?: "Release publishing failed."
            } finally {
                releaseBusy = false
            }
        }
    }

    private suspend fun waitForReleaseRun(requestId: String): WorkflowRun {
        val deadline = System.currentTimeMillis() + 30 * 60 * 1_000L
        var matched: WorkflowRun? = null
        while (System.currentTimeMillis() < deadline) {
            val runs = api.listWorkflowRuns("android-release-apk.yml", 30)
            matched = runs.firstOrNull { it.displayTitle.contains(requestId) }
            if (matched != null && matched.status == "completed") return matched
            delay(5_000)
        }
        error(
            if (matched == null) "Timed out waiting for the APK build to appear."
            else "Timed out waiting for the APK build to finish."
        )
    }

    private fun extractApk(zipBytes: ByteArray): ByteArray {
        ZipInputStream(ByteArrayInputStream(zipBytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory && entry.name.endsWith(".apk", ignoreCase = true)) {
                    return zip.readBytes()
                }
            }
        }
        error("Downloaded artifact did not contain an APK.")
    }

    suspend fun bitmap(url: String, maxDimension: Int = 1024): Bitmap? = repo.loadBitmap(url, maxDimension)
    fun paintingUrl(id: String): String = repo.paintingUrl(id)
    fun depthUrl(): String? = theaterMeta?.let { repo.depthUrl(it.depthFile) }
    private fun displayName(resolver: ContentResolver, uri: Uri): String? {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            val column = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && c.moveToFirst()) return c.getString(column)
        }
        return uri.lastPathSegment
    }
}
