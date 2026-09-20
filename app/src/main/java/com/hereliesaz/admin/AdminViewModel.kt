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
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

enum class AdminTab { Art, Dedup, Add, Site, Settings }

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
    var selectedArtworkIds by mutableStateOf<Set<String>>(emptySet()); private set
    val multiSelectionActive: Boolean get() = selectedArtworkIds.isNotEmpty()
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

    var dedupReport by mutableStateOf<DedupReport?>(null); private set
    var dedupBusy by mutableStateOf(false); private set
    var dedupMessage by mutableStateOf<String?>(null); private set
    private var dedupDisplayedRunId: Long? = null
    private var dedupExpectedRequestId: String? = null
    private var dedupPollingJob: Job? = null

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
        selectedArtworkIds = emptySet()
        artMessage = null
        selectedArtwork = null
        stopDedupPolling()
        dedupReport = null
        dedupDisplayedRunId = null
        dedupExpectedRequestId = null
        dedupMessage = null
    }

    fun refreshPaintings() {
        if (!authenticated) return
        paintings = null
        selectedArtworkIds = emptySet()
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

    fun toggleArtworkSelection(item: ArtworkItem) {
        selectedArtworkIds = selectedArtworkIds.toMutableSet().apply {
            if (!add(item.id)) remove(item.id)
        }
    }

    fun clearArtworkSelection() {
        selectedArtworkIds = emptySet()
    }

    fun stageSelectedForRemoval() {
        if (selectedArtworkIds.isEmpty()) return

        val byId = paintings.orEmpty().associateBy { it.id }
        val targets = selectedArtworkIds.mapNotNull(byId::get)
        if (targets.isEmpty()) {
            selectedArtworkIds = emptySet()
            return
        }

        val ids = targets.mapTo(linkedSetOf()) { it.id }
        val removals = draft.removals.toMutableMap()
        targets.forEach { item ->
            removals[item.id] = StagedRemoval(
                id = item.id,
                sourceFilename = item.sourceFilename,
                sourceIsSymlink = item.sourceIsSymlink,
            )
        }

        persistDraft(
            draft.copy(
                metaUpdates = draft.metaUpdates.filterKeys { it !in ids },
                bandUpdates = draft.bandUpdates.filterKeys { it !in ids },
                removals = removals,
            ),
        )

        meta = meta.filterKeys { it !in ids }
        paintings = paintings?.filterNot { it.id in ids }
        selectedArtworkIds = emptySet()
        artMessage =
            "Staged " + targets.size + " photo" +
                (if (targets.size == 1) "" else "s") +
                " for deletion. Nothing will be deleted until Submit All."
    }

    fun startDedupPolling() {
        if (dedupPollingJob?.isActive == true) return
        dedupPollingJob = viewModelScope.launch {
            while (true) {
                runCatching { pollDedupStatus() }
                    .onFailure { error ->
                        dedupMessage =
                            "Could not refresh dedup status: " +
                                (error.message ?: "unknown error")
                    }
                delay(DEDUP_SCREEN_POLL_MS)
            }
        }
    }

    fun stopDedupPolling() {
        dedupPollingJob?.cancel()
        dedupPollingJob = null
    }

    fun scanForDuplicates() {
        if (dedupBusy) return

        val requestId = UUID.randomUUID().toString()
        dedupExpectedRequestId = requestId
        dedupBusy = true
        dedupMessage =
            if (dedupReport == null) {
                "Queueing dedup scan…"
            } else {
                "Queueing a newer dedup scan. Showing the latest completed report meanwhile."
            }

        viewModelScope.launch {
            try {
                repo.dispatchDedupScan(requestId)
                startDedupPolling()
            } catch (e: Exception) {
                dedupExpectedRequestId = null
                dedupBusy = false
                dedupMessage = e.message ?: "Could not queue dedup scan."
            }
        }
    }

    private suspend fun pollDedupStatus() {
        val runs = repo.listDedupRuns()
        if (runs.isEmpty()) {
            dedupBusy = dedupExpectedRequestId != null
            if (dedupReport == null) {
                dedupMessage =
                    if (dedupBusy) {
                        "Waiting for the queued dedup scan to appear…"
                    } else {
                        "No dedup scans have run yet."
                    }
            }
            return
        }

        val newestSuccessfulRun = runs.firstOrNull {
            it.status == "completed" && it.conclusion == "success"
        }
        if (
            newestSuccessfulRun != null &&
            newestSuccessfulRun.id != dedupDisplayedRunId
        ) {
            repo.latestAvailableDedupReport(runs)?.let { snapshot ->
                if (snapshot.runId != dedupDisplayedRunId) {
                    showDedupSnapshot(snapshot)
                }
            }
        }

        dedupExpectedRequestId?.let { expected ->
            val requested = runs.firstOrNull { it.displayTitle.contains(expected) }
            if (requested == null) {
                dedupBusy = true
                dedupMessage =
                    if (dedupReport == null) {
                        "Waiting for the queued dedup scan to appear…"
                    } else {
                        "A newer scan is queued. Showing the latest completed report until it is ready."
                    }
                return
            }
            dedupExpectedRequestId = null
        }

        val latest = runs.first()
        if (latest.status != "completed") {
            dedupBusy = true
            dedupMessage =
                when (latest.status) {
                    "queued" ->
                        "Newest dedup scan is queued."
                    "in_progress" ->
                        "Newest dedup scan is running."
                    else ->
                        "Newest dedup scan is " + latest.status + "."
                } +
                    if (dedupReport != null) {
                        " Showing the latest completed report until it is ready."
                    } else {
                        ""
                    }
            return
        }

        if (latest.conclusion == "success") {
            if (dedupDisplayedRunId != latest.id) {
                val report = repo.loadDedupReport(latest.id)
                if (report == null) {
                    dedupBusy = true
                    dedupMessage =
                        if (dedupReport == null) {
                            "Newest scan finished. Waiting for its report…"
                        } else {
                            "Newest scan finished. Showing the previous report until the new report is ready."
                        }
                    return
                }
                showDedupSnapshot(DedupReportSnapshot(latest.id, report))
            }
            dedupBusy = false
            dedupMessage = dedupSummary(dedupReport)
            return
        }

        dedupBusy = false
        val fallback = repo.latestAvailableDedupReport(runs.drop(1))
        if (dedupReport == null && fallback != null) {
            showDedupSnapshot(fallback)
        }
        dedupMessage =
            "Newest dedup scan ended with " +
                (latest.conclusion ?: "an unknown result") +
                if (dedupReport != null) {
                    ". Showing the most recent successful report."
                } else {
                    ". No successful report is available yet."
                }
    }

    private fun showDedupSnapshot(snapshot: DedupReportSnapshot) {
        dedupDisplayedRunId = snapshot.runId
        dedupReport = snapshot.report
    }

    private fun dedupSummary(report: DedupReport?): String {
        report ?: return "No dedup report is available yet."
        return "Latest completed scan: " +
            report.exactCount + " exact, " +
            report.compressedCount + " compressed-copy, and " +
            report.similarCount + " similar-image pair" +
            (if (report.similarCount == 1) "" else "s") + "."
    }

    fun stageDedupRemoval(image: DedupImage) {
        val alreadyStaged = image.id in draft.removals
        val removal = StagedRemoval(
            id = image.id,
            sourceFilename = image.filename,
            sourceIsSymlink = image.sourceIsSymlink,
        )
        persistDraft(
            draft.copy(
                removals = draft.removals + (image.id to removal),
            ),
        )
        meta = meta - image.id
        paintings = paintings?.filterNot { it.id == image.id }
        dedupMessage =
            if (alreadyStaged) {
                image.id + " is already queued for deletion."
            } else {
                "Staged " + image.id + " for deletion. Nothing is deleted until Submit All."
            }
    }

    fun undoDedupRemoval(image: DedupImage) {
        if (image.id !in draft.removals) {
            dedupMessage = image.id + " is not queued for deletion."
            return
        }

        persistDraft(
            draft.copy(
                removals = draft.removals - image.id,
            ),
        )
        dedupMessage =
            "Unstaged " + image.id + ". It will not be deleted when Submit All is pressed."
        refreshPaintings()
    }

    fun stageAllSuggestedDuplicates() {
        val report = dedupReport ?: return
        val imagesById = buildMap {
            report.pairs.forEach { pair ->
                put(pair.left.id, pair.left)
                put(pair.right.id, pair.right)
            }
        }
        val ids = report.pairs
            .asSequence()
            .filter { it.kind == DedupKind.Exact || it.kind == DedupKind.Compressed }
            .mapNotNull { it.suggestedRemoveId }
            .distinct()
            .filter { it !in draft.removals }
            .toList()

        if (ids.isEmpty()) {
            dedupMessage = "No new duplicate-removal suggestions to stage."
            return
        }

        var next = draft
        ids.forEach { id ->
            val image = imagesById[id] ?: return@forEach
            next = next.copy(
                removals = next.removals + (
                    id to StagedRemoval(
                        id = id,
                        sourceFilename = image.filename,
                        sourceIsSymlink = image.sourceIsSymlink,
                    )
                ),
            )
        }
        persistDraft(next)
        val idSet = ids.toSet()
        meta = meta.filterKeys { it !in idSet }
        paintings = paintings?.filterNot { it.id in idSet }
        dedupMessage =
            "Staged " + ids.size + " suggested duplicate" +
                (if (ids.size == 1) "" else "s") +
                " for deletion. Review the draft, then Submit All."
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
        persistDraft(
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
        persistDraft(
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
                persistDraft(next)
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
        persistDraft(draft.copy(siteContent = x))
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
        persistDraft(
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
                selectedArtworkIds = emptySet()
                removalStaged = false
                dedupReport = null
                dedupDisplayedRunId = null

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
        selectedArtworkIds = emptySet()
        submitMessage = "Discarded local staged changes."
        siteContent = null
        closePainting()
        if (authenticated) refreshPaintings()
        if (tab == AdminTab.Site) loadSite()
    }

    suspend fun bitmap(url: String, maxDimension: Int = 1024): Bitmap? =
        repo.loadBitmap(url, maxDimension)

    fun artworkUrl(item: ArtworkItem): String = repo.artworkUrl(item)
    fun dedupImageUrl(image: DedupImage): String = repo.dedupImageUrl(image)
    fun paintingUrl(id: String): String = repo.paintingUrl(id)
    fun depthUrl(): String? = theaterMeta?.let { repo.depthUrl(it.depthFile) }

    companion object {
        private const val DEDUP_SCREEN_POLL_MS = 4_000L
    }

    private fun persistDraft(next: AdminDraft) {
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
