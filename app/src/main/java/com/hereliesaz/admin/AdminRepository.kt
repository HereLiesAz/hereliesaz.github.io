package com.hereliesaz.admin

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import kotlin.math.max

class AdminRepository(private val api: GitHubApi) {
    suspend fun listBakedPaintings(): List<String> {
        val file = api.getFile("theater/_manifest.json", ART_DATA_BRANCH)
            ?: error("art-data/theater/_manifest.json is missing")
        val arr = JSONArray(file.content)
        return List(arr.length()) { arr.getString(it) }
    }

    suspend fun listSourcePaintings(): List<ArtworkItem> {
        api.ensureBranch(ADMIN_BRANCH)
        val prefix = "public/assets/"
        return api.listRepoTree(ADMIN_BRANCH)
            .asSequence()
            .filter { it.type == "blob" && it.path.startsWith(prefix) }
            .mapNotNull { entry ->
                val relative = entry.path.removePrefix(prefix)
                if ('/' in relative || !isImageFilename(relative)) return@mapNotNull null
                val dot = relative.lastIndexOf('.')
                val id = if (dot > 0) relative.substring(0, dot) else relative
                ArtworkItem(
                    id = id,
                    sourceFilename = relative,
                    sourceIsSymlink = entry.mode == "120000",
                )
            }
            .sortedBy { it.id.lowercase() }
            .toList()
    }

    suspend fun loadMeta(): Map<String, PaintingMeta> {
        api.ensureBranch(ADMIN_BRANCH)
        val file = api.getFile(META_PATH, ADMIN_BRANCH) ?: return emptyMap()
        return parseMeta(file.content)
    }

    suspend fun loadBandOverrides(): Map<String, Set<Int>> {
        api.ensureBranch(ADMIN_BRANCH)
        val file = api.getFile(BAND_OVERRIDES_PATH, ADMIN_BRANCH) ?: return emptyMap()
        val root = parseObject(file.content)
        return root.keys().asSequence().associateWith { id ->
            val hidden = root.optJSONObject(id)?.optJSONArray("hidden") ?: JSONArray()
            buildSet {
                for (i in 0 until hidden.length()) add(hidden.getInt(i))
            }
        }
    }

    suspend fun loadSiteContent(): SiteContent {
        api.ensureBranch(ADMIN_BRANCH)
        val file = api.getFile(SITE_PATH, ADMIN_BRANCH) ?: return SiteContent()
        return runCatching {
            val root = JSONObject(file.content)
            val a = root.optJSONArray("menuLinks") ?: JSONArray()
            val links = buildList {
                for (i in 0 until a.length()) {
                    val x = a.getJSONObject(i)
                    add(MenuLink(x.optString("label"), x.optString("href"), x.optBoolean("external", true)))
                }
            }
            SiteContent(
                root.optString("about", SiteContent.DEFAULT_ABOUT),
                if (links.isEmpty()) SiteContent.DEFAULT_LINKS else links,
            )
        }.getOrDefault(SiteContent())
    }

    suspend fun fetchTheaterMeta(id: String): TheaterMeta? {
        val file = runCatching {
            api.getFile("theater/$id.theater.json", ART_DATA_BRANCH)
        }.getOrNull() ?: return null
        val root = JSONObject(file.content)
        val depth = root.optJSONObject("depth") ?: return null
        val bands = depth.optJSONObject("bands") ?: return null
        val edges = bands.optJSONArray("edges") ?: return null
        val centers = bands.optJSONArray("centers") ?: return null
        return TheaterMeta(
            root.optJSONObject("src")?.optString("image")?.takeIf { it.isNotBlank() },
            depth.optString("file", "$id.depth.png"),
            List(edges.length()) { edges.getDouble(it) },
            List(centers.length()) { centers.getDouble(it) },
        )
    }

    fun paintingUrl(id: String): String =
        "$RAW_ART_DATA_BASE/theater/" + GitHubApi.encodeSegment(id) + ".painting.webp"

    fun artworkUrl(item: ArtworkItem): String {
        if (item.baked) return paintingUrl(item.id)
        val filename = item.sourceFilename ?: return paintingUrl(item.id)
        val relative =
            if (item.sourceIsSymlink) "public/assets/raw/$filename" else "public/assets/$filename"
        return "$RAW_ADMIN_BASE/" +
            relative.split('/').joinToString("/") { GitHubApi.encodeSegment(it) }
    }

    fun depthUrl(depthFile: String): String =
        "$RAW_ART_DATA_BASE/theater/" + GitHubApi.encodeSegment(depthFile)

    fun dedupImageUrl(image: DedupImage): String {
        val relative =
            if (image.sourceIsSymlink) {
                "public/assets/raw/" + image.filename
            } else {
                "public/assets/" + image.filename
            }
        return "$RAW_ADMIN_BASE/" +
            relative.split('/').joinToString("/") { GitHubApi.encodeSegment(it) }
    }

    suspend fun dispatchDedupScan(requestId: String) {
        api.ensureBranch(ADMIN_BRANCH)
        api.dispatchWorkflow(
            "dedup_scan.yml",
            mapOf("request_id" to requestId),
            ref = ADMIN_BRANCH,
        )
    }

    suspend fun listDedupRuns(): List<WorkflowRun> =
        api.listWorkflowRuns(
            workflowFile = "dedup_scan.yml",
            perPage = 30,
            event = "workflow_dispatch",
        )

    suspend fun loadDedupReport(runId: Long): DedupReport? {
        val artifact = api.listRunArtifacts(runId)
            .firstOrNull { it.name.startsWith("dedup-report-") && !it.expired }
            ?: return null
        val zip = api.downloadArtifactZip(artifact.id)
        val json = extractJsonFromZip(zip) ?: return null
        return parseDedupReport(json)
    }

    suspend fun latestAvailableDedupReport(
        runs: List<WorkflowRun>,
    ): DedupReportSnapshot? {
        for (run in runs) {
            if (run.status != "completed" || run.conclusion != "success") continue
            val report = runCatching { loadDedupReport(run.id) }.getOrNull() ?: continue
            return DedupReportSnapshot(run.id, report)
        }
        return null
    }

    suspend fun loadBitmap(url: String, maxDimension: Int = 1024): Bitmap? =
        withContext(Dispatchers.Default) {
            val bytes = api.publicBytes(url)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / sample > maxDimension * 2) sample *= 2
            val decoded = BitmapFactory.decodeByteArray(
                bytes,
                0,
                bytes.size,
                BitmapFactory.Options().apply {
                    inSampleSize = sample
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                },
            ) ?: return@withContext null
            val largest = max(decoded.width, decoded.height)
            if (largest <= maxDimension) {
                decoded
            } else {
                val scale = maxDimension.toFloat() / largest
                Bitmap.createScaledBitmap(
                    decoded,
                    max(1, (decoded.width * scale).toInt()),
                    max(1, (decoded.height * scale).toInt()),
                    true,
                ).also {
                    if (it !== decoded) decoded.recycle()
                }
            }
        }

    suspend fun buildBandPreviews(
        id: String,
        meta: TheaterMeta,
        hidden: Set<Int>,
    ): List<BandPreview> = withContext(Dispatchers.Default) {
        val painting = loadBitmap(paintingUrl(id), 384) ?: error("Could not decode painting preview")
        val rawDepth = loadBitmap(depthUrl(meta.depthFile), 384) ?: error("Could not decode depth preview")
        val depth =
            if (rawDepth.width == painting.width && rawDepth.height == painting.height) {
                rawDepth
            } else {
                Bitmap.createScaledBitmap(rawDepth, painting.width, painting.height, true)
                    .also {
                        if (it !== rawDepth) rawDepth.recycle()
                    }
            }
        val count = painting.width * painting.height
        val p = IntArray(count)
        val d = IntArray(count)
        painting.getPixels(p, 0, painting.width, 0, 0, painting.width, painting.height)
        depth.getPixels(d, 0, depth.width, 0, 0, depth.width, depth.height)
        val result = meta.bandCenters.indices.map { band ->
            val lo = meta.bandEdges[band]
            val hi = meta.bandEdges[band + 1]
            val out = p.copyOf()
            for (i in 0 until count) {
                val z = Color.red(d[i]) / 255.0
                if (z < lo || z >= hi) out[i] = out[i] and 0x00FFFFFF
            }
            BandPreview(
                band,
                lo,
                hi,
                Bitmap.createBitmap(out, painting.width, painting.height, Bitmap.Config.ARGB_8888),
                band in hidden,
            )
        }
        painting.recycle()
        depth.recycle()
        result
    }

    suspend fun submitDraft(
        draft: AdminDraft,
        uploadFiles: Map<String, PickedFile>,
    ): SubmitResult {
        require(!draft.isEmpty) { "There are no staged changes to submit." }

        val baseSha = api.ensureBranch(ADMIN_BRANCH)
        val tree = api.listRepoTree(baseSha)
        val mutations = mutableListOf<RepoMutation>()

        if (draft.metaUpdates.isNotEmpty() || draft.removals.isNotEmpty()) {
            val file = api.getFile(META_PATH, baseSha)
            val root = parseObject(file?.content)
            draft.metaUpdates.forEach { (id, entry) ->
                root.put(id, JSONObject().apply {
                    put("title", entry.title)
                    put("description", entry.description)
                    put("tags", JSONArray(entry.tags))
                    put("forSale", entry.forSale)
                    if (entry.forSale && entry.price != null) {
                        put("price", entry.price)
                        put("currency", entry.currency)
                    }
                })
            }
            draft.removals.keys.forEach(root::remove)
            mutations += RepoMutation(
                META_PATH,
                (root.toString(2) + "\n").toByteArray(Charsets.UTF_8),
            )
        }

        if (draft.bandUpdates.isNotEmpty() || draft.removals.isNotEmpty()) {
            val file = api.getFile(BAND_OVERRIDES_PATH, baseSha)
            val root = parseObject(file?.content)
            draft.bandUpdates.forEach { (id, hidden) ->
                if (hidden.isEmpty()) {
                    root.remove(id)
                } else {
                    root.put(id, JSONObject().put("hidden", JSONArray(hidden.sorted())))
                }
            }
            draft.removals.keys.forEach(root::remove)
            mutations += RepoMutation(
                BAND_OVERRIDES_PATH,
                (root.toString(2) + "\n").toByteArray(Charsets.UTF_8),
            )
        }

        draft.siteContent?.let { content ->
            val links = JSONArray()
            content.menuLinks.forEach { link ->
                links.put(
                    JSONObject()
                        .put("label", link.label)
                        .put("href", link.href)
                        .put("external", link.external),
                )
            }
            val root = JSONObject()
                .put("about", content.about)
                .put("menuLinks", links)
            mutations += RepoMutation(
                SITE_PATH,
                (root.toString(2) + "\n").toByteArray(Charsets.UTF_8),
            )
        }

        draft.uploads.forEach { staged ->
            val picked = uploadFiles[staged.id]
                ?: error("Staged upload " + staged.filename + " could not be read.")
            mutations += RepoMutation(
                "public/assets/" + staged.filename,
                picked.bytes,
            )
        }

        draft.removals.values.forEach { removal ->
            val sourceFilename = removal.sourceFilename
                ?: fetchTheaterMeta(removal.id)?.sourceImage
                ?: return@forEach
            val publicPath = "public/assets/$sourceFilename"
            val publicEntry = tree.firstOrNull { it.path == publicPath && it.type == "blob" }
            if (publicEntry != null) {
                mutations += RepoMutation(publicPath, null)
                if (publicEntry.mode == "120000" || removal.sourceIsSymlink) {
                    val rawPath = "public/assets/raw/$sourceFilename"
                    if (tree.any { it.path == rawPath && it.type == "blob" }) {
                        mutations += RepoMutation(rawPath, null)
                    }
                }
            }
        }

        val commitSha = api.commitBatch(
            mutations = mutations,
            message = "admin android: submit " + draft.changeCount + " staged changes",
            parentSha = baseSha,
            branch = ADMIN_BRANCH,
        )

        return SubmitResult(commitSha)
    }

    suspend fun publishSite(requestId: String) {
        api.ensureBranch(ADMIN_BRANCH)
        api.dispatchWorkflow(
            "publish_admin_staging.yml",
            mapOf("request_id" to requestId),
            ref = GitHubApi.BRANCH,
        )
    }

    suspend fun hasUnpublishedChanges(): Boolean {
        api.ensureBranch(ADMIN_BRANCH)
        val mainTree = api.listRepoTree(GitHubApi.BRANCH)
        val stagingTree = api.listRepoTree(ADMIN_BRANCH)
        fun managed(tree: List<RepoTreeEntry>): Map<String, String> =
            tree.asSequence()
                .filter { entry ->
                    entry.type == "blob" &&
                        (
                            entry.path.startsWith("public/assets/") ||
                                entry.path == META_PATH ||
                                entry.path == SITE_PATH ||
                                entry.path == BAND_OVERRIDES_PATH
                            )
                }
                .associate { it.path to it.sha }
        return managed(mainTree) != managed(stagingTree)
    }

    private fun extractJsonFromZip(bytes: ByteArray): String? {
        var result: String? = null
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory && entry.name.endsWith(".json", ignoreCase = true)) {
                    result = zip.bufferedReader(Charsets.UTF_8).readText()
                    break
                }
            }
        }
        return result
    }

    private fun parseDedupReport(text: String): DedupReport {
        val root = JSONObject(text)
        val pairsArray = root.optJSONArray("pairs") ?: JSONArray()

        fun parseImage(obj: JSONObject): DedupImage =
            DedupImage(
                id = obj.optString("id"),
                filename = obj.optString("filename"),
                sourceIsSymlink = obj.optBoolean("sourceIsSymlink", false),
                bytes = obj.optLong("bytes", 0L),
                width = if (obj.isNull("width")) null else obj.optInt("width"),
                height = if (obj.isNull("height")) null else obj.optInt("height"),
            )

        val pairs = buildList {
            for (i in 0 until pairsArray.length()) {
                val item = pairsArray.getJSONObject(i)
                val reasonsArray = item.optJSONArray("reasons") ?: JSONArray()
                val reasons = List(reasonsArray.length()) { index ->
                    reasonsArray.optString(index)
                }
                val kind = when (item.optString("kind")) {
                    "exact" -> DedupKind.Exact
                    "compressed" -> DedupKind.Compressed
                    else -> DedupKind.Similar
                }
                add(
                    DedupPair(
                        kind = kind,
                        certainty = item.optDouble("certainty", 0.0),
                        left = parseImage(item.getJSONObject("left")),
                        right = parseImage(item.getJSONObject("right")),
                        reasons = reasons,
                        suggestedKeepId = item.optString("suggestedKeepId")
                            .takeIf { it.isNotBlank() && it != "null" },
                        suggestedRemoveId = item.optString("suggestedRemoveId")
                            .takeIf { it.isNotBlank() && it != "null" },
                    ),
                )
            }
        }

        return DedupReport(
            imageCount = root.optInt("imageCount", 0),
            pairCount = root.optInt("pairCount", pairs.size),
            exactCount = root.optInt("exactCount", 0),
            compressedCount = root.optInt("compressedCount", 0),
            similarCount = root.optInt("similarCount", 0),
            pairs = pairs,
            scanErrorCount = root.optJSONArray("scanErrors")?.length() ?: 0,
        )
    }

    private fun isImageFilename(filename: String): Boolean {
        val dot = filename.lastIndexOf('.')
        if (dot < 0 || dot == filename.lastIndex) return false
        return filename.substring(dot + 1).lowercase() in IMAGE_EXTENSIONS
    }

    private fun parseMeta(text: String): Map<String, PaintingMeta> {
        val root = parseObject(text)
        return root.keys().asSequence().associateWith { id ->
            val x = root.optJSONObject(id) ?: JSONObject()
            val a = x.optJSONArray("tags") ?: JSONArray()
            PaintingMeta(
                x.optString("title"),
                x.optString("description"),
                List(a.length()) { a.optString(it) },
                x.optBoolean("forSale", false),
                if (x.has("price")) x.optDouble("price") else null,
                x.optString("currency", "USD"),
            )
        }
    }

    private fun parseObject(text: String?): JSONObject =
        if (text.isNullOrBlank()) JSONObject() else runCatching { JSONObject(text) }.getOrDefault(JSONObject())

    companion object {
        const val ART_DATA_BRANCH = "art-data"
        const val ADMIN_BRANCH = "admin-staging"
        const val RAW_ADMIN_BASE =
            "https://raw.githubusercontent.com/HereLiesAz/hereliesaz.github.io/admin-staging"
        const val RAW_ART_DATA_BASE =
            "https://raw.githubusercontent.com/HereLiesAz/hereliesaz.github.io/art-data"
        const val META_PATH = "public/meta.json"
        const val SITE_PATH = "public/site-content.json"
        const val BAND_OVERRIDES_PATH = "public/band-overrides.json"
        private val IMAGE_EXTENSIONS =
            setOf("jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif")
        private const val REMOVAL_POLL_MS = 5_000L
        private const val REMOVAL_POLL_MAX_MS = 20 * 60 * 1_000L
    }
}
