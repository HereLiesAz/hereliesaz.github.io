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
import kotlinx.coroutines.launch

enum class AdminTab { Art, Add, Site, Settings }

class AdminViewModel(application: Application) : AndroidViewModel(application) {
    private val tokenStore = TokenStore(application)
    private val api = GitHubApi(tokenStore)
    private val repo = AdminRepository(api)
    private val updater = GitHubUpdater(application)
    private val draftStore = DraftStore(application)

    var authenticated by mutableStateOf(tokenStore.hasToken()); private set
    var tokenInput by mutableStateOf(tokenStore.load())
    var authMessage by mutableStateOf<String?>(null); private set
    var busy by mutableStateOf(false); private set
    var tab by mutableStateOf(AdminTab.Art)

    var draft by mutableStateOf(draftStore.load()); private set
    val pendingCount: Int get() = draft.changeCount
    var submitBusy by mutableStateOf(false); private set
    var submitMessage by mutableStateOf<String?>(null); private set

    var paintings by mutableStateOf<List<ArtworkItem>?>(null); private set
    var meta by mutableStateOf<Map<String, PaintingMeta>>(emptyMap()); private set
    var filter by mutableStateOf("")
    var artMessage by mutableStateOf<String?>(null); private set
    var selectedArtwork by mutableStateOf<ArtworkItem?>(null); private set
    var paintingForm by mutableStateOf(PaintingForm())
    var editorMessage by mutableStateOf<String?>(null); private set
    var removalStaged by mutableStateOf(false); private set

    var chosenUris by mutableStateOf<List<Uri>>(emptyList()); private set
    var addMessage by mutableStateOf<String?>(null); private set

    var siteContent by mutableStateOf<SiteContent?>(null); private set
    var siteMessage by mutableStateOf<String?>(null); private set

    var bandPreviews by mutableStateOf<List<BandPreview>>(emptyList()); private set
    var bandHidden by mutableStateOf<Set<Int>>(emptySet()); private set
    var bandMessage by mutableStateOf<String?>(null); private set
    var bandLoading by mutableStateOf(false); private set
    var theaterMeta by mutableStateOf<TheaterMeta?>(null); private set

    var availableUpdate by mutableStateOf<UpdateInfo?>(null); private set
    var updateBusy by mutableStateOf(false); private set
    var updateMessage by mutableStateOf<String?>(null); private set
    private var downloadedUpdateFile: java.io.File? = null

    init {
        checkForUpdates(silent = true)
        if (authenticated) refreshPaintings()
    }

    fun checkForUpdates(silent: Boolean = false) {
        if (updateBusy) return
        updateBusy = true
        if (!silent) updateMessage = "Checking GitHub Releases…"
        viewModelScope.launch {
            try {
                val update = updater.checkForUpdate()
                availableUpdate = update
                updateMessage = when {
                    update != null -> "Update " + update.version + " is available."
                    silent -> null
                    else -> "You already have the latest release."
                }
            } catch (e: Exception) {
                if (!silent) updateMessage = e.message ?: "Update check failed."
            } finally {
                updateBusy = false
            }
        }
    }

    fun downloadAndInstallUpdate() {
        val update = availableUpdate ?: return
        if (updateBusy) return
        updateBusy = true
        updateMessage = "Downloading " + update.assetName + "…"
        viewModelScope.launch {
            try {
                val file = downloadedUpdateFile?.takeIf { it.exists() }
                    ?: updater.downloadAndValidate(update).also { downloadedUpdateFile = it }
                val installerLaunched = updater.launchInstaller(file)
                updateMessage = if (installerLaunched) {
                    "Android installer opened. Confirm the update to finish."
                } else {
                    "Allow installs from this app, then tap Install update again."
                }
            } catch (e: Exception) {
                updateMessage = e.message ?: "Update failed."
            } finally {
                updateBusy = false
            }
        }
    }

    fun dismissUpdate() {
        availableUpdate = null
        updateMessage = null
    }

    fun verifyAndSaveToken() {
        if (tokenInput.trim().isBlank()) {
            authMessage = "Enter a GitHub token."
            return
        }
        tokenStore.save(tokenInput.trim())
        busy = true
        authMessage = "Checking…"
        viewModelScope.launch {
            try {
                val x = api.verifyToken()
                when {
                    !x.canWrite ->
                        authMessage =
                            "Token works but has no write access to the repository (logged in as " +
                                x.login + ")."

                    !x.actionsOk ->
                        authMessage =
                            "Token can write Contents but cannot access Actions. Grant Actions: Read and write."

                    else -> {
                        authenticated = true
                        authMessage = "Verified — write access confirmed."
                        refreshPaintings()
                    }
                }
            } catch (e: Exception) {
                authenticated = false
                authMessage = e.message
            } finally {
                busy = false
            }
        }
    }

    fun clearToken() {
        tokenStore.clear()
        tokenInput = ""
        authenticated = false
        authMessage = null
        paintings = null
        artMessage = null
        selectedArtwork = null
    }

    fun refreshPaintings() {
        if (!authenticated) return
        paintings = null
        artMessage = "Loading complete photo inventory…"
        viewModelScope.launch {
            try {
                val source = repo.listSourcePaintings()
                val bakedResult = runCatching { repo.listBakedPaintings() }
                val bakedIds = bakedResult.getOrDefault(emptyList()).toSet()

                val merged = linkedMapOf<String, ArtworkItem>()
                source.forEach { item ->
                    if (item.id !in draft.removals) {
                        merged[item.id] = item.copy(baked = item.id in bakedIds)
                    }
                }
                bakedIds.forEach { id ->
                    if (id !in merged && id !in draft.removals) {
                        merged[id] = ArtworkItem(id = id, baked = true)
                    }
                }
                paintings = merged.values.sortedBy { it.id.lowercase() }

                val metaResult = runCatching { repo.loadMeta() }
                val combinedMeta = metaResult.getOrDefault(emptyMap()).toMutableMap()
                combinedMeta.putAll(draft.metaUpdates)
                draft.removals.keys.forEach(combinedMeta::remove)
                meta = combinedMeta

                val warnings = buildList {
                    bakedResult.exceptionOrNull()?.let {
                        add("Could not read the live theater manifest: " + (it.message ?: "unknown error"))
                    }
                    metaResult.exceptionOrNull()?.let {
                        add("Could not read painting metadata: " + (it.message ?: "unknown error"))
                    }
                }
                artMessage = if (warnings.isEmpty()) {
                    "Loaded " + source.size + " source photos; " + bakedIds.size + " are currently live/baked."
                } else {
                    "Loaded " + source.size + " source photos. " + warnings.joinToString(" ")
                }
            } catch (e: Exception) {
                paintings = emptyList()
                artMessage = e.message ?: "Could not load the photo inventory."
            }
        }
    }

    fun selectPainting(item: ArtworkItem) {
        selectedArtwork = item
        editorMessage = null
        removalStaged = item.id in draft.removals
        bandPreviews.forEach { runCatching { it.bitmap.recycle() } }
        bandPreviews = emptyList()
        bandHidden = emptySet()
        theaterMeta = null

        val x = draft.metaUpdates[item.id] ?: meta[item.id] ?: PaintingMeta()
        paintingForm = PaintingForm(
            title = x.title,
            description = x.description,
            tags = x.tags.joinToString(", "),
            forSale = x.forSale,
            price = x.price
                ?.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }
                .orEmpty(),
            currency = x.currency,
        )
    }

    fun closePainting() {
        selectedArtwork = null
        editorMessage = null
        removalStaged = false
        bandPreviews.forEach { runCatching { it.bitmap.recycle() } }
        bandPreviews = emptyList()
        theaterMeta = null
    }

    fun savePainting() {
        val item = selectedArtwork ?: return
        val id = item.id
        if (paintingForm.forSale && paintingForm.price.isBlank()) {
            editorMessage = "Marked “for sale” needs a price."
            return
        }
        val price = paintingForm.price.toDoubleOrNull()
        if (paintingForm.forSale && (price == null || price < 0)) {
            editorMessage = "Price must be a non-negative number."
            return
        }

        val entry = PaintingMeta(
            title = paintingForm.title.trim(),
            description = paintingForm.description.trim(),
            tags = paintingForm.tags.split(',').map { it.trim() }.filter { it.isNotBlank() },
            forSale = paintingForm.forSale,
            price = if (paintingForm.forSale) price else null,
            currency = paintingForm.currency.trim().uppercase().ifBlank { "USD" },
        )
        setDraft(
            draft.copy(
                metaUpdates = draft.metaUpdates + (id to entry),
                removals = draft.removals - id,
            ),
        )
        meta = meta + (id to entry)
        removalStaged = false
        editorMessage = "Staged. Nothing has been sent to GitHub yet."
    }

    fun removePainting() {
        val item = selectedArtwork ?: return
        val removal = StagedRemoval(
            id = item.id,
            sourceFilename = item.sourceFilename,
            sourceIsSymlink = item.sourceIsSymlink,
        )
        setDraft(
            draft.copy(
                metaUpdates = draft.metaUpdates - item.id,
                bandUpdates = draft.bandUpdates - item.id,
                removals = draft.removals + (item.id to removal),
            ),
        )
        meta = meta - item.id
        paintings = paintings?.filterNot { it.id == item.id }
        removalStaged = true
        editorMessage = "Removal staged. Nothing will be deleted until Submit Changes."
    }

    fun chooseUris(uris: List<Uri>) {
        chosenUris = uris
        addMessage = null
    }

    fun uploadChosen(resolver: ContentResolver) {
        if (chosenUris.isEmpty()) return

        busy = true
        addMessage = "Copying photos into the local draft…"
        viewModelScope.launch {
            try {
                val files = chosenUris.map { uri ->
                    val name = displayName(resolver, uri) ?: "photo"
                    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: error("Could not read $name")
                    PickedFile(name, bytes)
                }
                val next = draftStore.stageUploads(draft, files)
                setDraft(next)
                chosenUris = emptyList()
                addMessage =
                    "Staged " + files.size + " photo" +
                        (if (files.size == 1) "" else "s") +
                        ". Nothing has been uploaded yet."
            } catch (e: Exception) {
                addMessage = e.message ?: "Could not stage the selected photos."
            } finally {
                busy = false
            }
        }
    }

    fun loadSite() {
        if (siteContent != null) return
        draft.siteContent?.let {
            siteContent = it
            return
        }
        viewModelScope.launch {
            siteContent = runCatching { repo.loadSiteContent() }.getOrDefault(SiteContent())
        }
    }

    fun setSite(x: SiteContent) {
        siteContent = x
        if (siteMessage?.startsWith("Staged") == true) siteMessage = null
    }

    fun saveSite() {
        val x = siteContent ?: return
        setDraft(draft.copy(siteContent = x))
        siteMessage = "Staged. Nothing has been sent to GitHub yet."
    }

    fun loadBands() {
        val item = selectedArtwork ?: return
        if (!item.baked) {
            bandMessage = "This source photo has not been baked into the live theater yet."
            return
        }
        if (bandLoading || bandPreviews.isNotEmpty()) return

        bandLoading = true
        bandMessage = "Loading layers…"
        viewModelScope.launch {
            try {
                val t = repo.fetchTheaterMeta(item.id)
                    ?: error("This painting has no theater metadata.")
                val remoteHidden = repo.loadBandOverrides()[item.id].orEmpty()
                val hidden = draft.bandUpdates[item.id] ?: remoteHidden
                theaterMeta = t
                bandHidden = hidden
                bandPreviews = repo.buildBandPreviews(item.id, t, hidden)
                bandMessage = if (item.id in draft.bandUpdates) {
                    "These layer changes are staged locally."
                } else {
                    null
                }
            } catch (e: Exception) {
                bandMessage = e.message
            } finally {
                bandLoading = false
            }
        }
    }

    fun toggleBand(index: Int) {
        bandHidden = bandHidden.toMutableSet().apply {
            if (!add(index)) remove(index)
        }
        bandPreviews = bandPreviews.map { it.copy(hidden = it.index in bandHidden) }
        if (bandMessage?.startsWith("Staged") == true) bandMessage = null
    }

    fun saveBands() {
        val id = selectedArtwork?.id ?: return
        if (bandPreviews.isNotEmpty() && bandHidden.size >= bandPreviews.size) {
            bandMessage = "At least one layer must stay visible."
            return
        }
        setDraft(
            draft.copy(
                bandUpdates = draft.bandUpdates + (id to bandHidden),
                removals = draft.removals - id,
            ),
        )
        removalStaged = false
        bandMessage = "Staged. Nothing has been sent to GitHub yet."
    }

    fun submitChanges() {
        val toSubmit = draft
        if (toSubmit.isEmpty || submitBusy) return

        submitBusy = true
        submitMessage =
            "Submitting " + toSubmit.changeCount + " staged change" +
                (if (toSubmit.changeCount == 1) "" else "s") +
                " as one Git commit…"

        viewModelScope.launch {
            try {
                val uploads = toSubmit.uploads.associate { staged ->
                    staged.id to draftStore.readUpload(staged)
                }
                val result = repo.submitDraft(toSubmit, uploads)

                draftStore.clear(toSubmit)
                draft = AdminDraft()
                removalStaged = false

                submitMessage = if (result.dispatchWarnings.isEmpty()) {
                    "Submitted " + toSubmit.changeCount + " changes in one commit."
                } else {
                    "Submitted in one commit. " + result.dispatchWarnings.joinToString(" ")
                }

                siteContent = null
                closePainting()
                refreshPaintings()
                if (tab == AdminTab.Site) loadSite()
            } catch (e: Exception) {
                submitMessage =
                    (e.message ?: "Submit failed.") +
                        " Your staged changes are still saved on this device."
            } finally {
                submitBusy = false
            }
        }
    }

    fun discardDraft() {
        val old = draft
        if (old.isEmpty || submitBusy) return
        draftStore.clear(old)
        draft = AdminDraft()
        submitMessage = "Discarded local staged changes."
        siteContent = null
        closePainting()
        if (authenticated) refreshPaintings()
        if (tab == AdminTab.Site) loadSite()
    }

    suspend fun bitmap(url: String, maxDimension: Int = 1024): Bitmap? =
        repo.loadBitmap(url, maxDimension)

    fun artworkUrl(item: ArtworkItem): String = repo.artworkUrl(item)
    fun paintingUrl(id: String): String = repo.paintingUrl(id)
    fun depthUrl(): String? = theaterMeta?.let { repo.depthUrl(it.depthFile) }

    private fun setDraft(next: AdminDraft) {
        draft = next
        draftStore.save(next)
        submitMessage = null
    }

    private fun displayName(resolver: ContentResolver, uri: Uri): String? {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            val column = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && c.moveToFirst()) return c.getString(column)
        }
        return uri.lastPathSegment
    }
}
