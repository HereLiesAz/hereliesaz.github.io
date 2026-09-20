package com.hereliesaz.admin

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max

class AdminRepository(private val api: GitHubApi) {
    private val removalMutex = Mutex()

    suspend fun listBakedPaintings(): List<String> {
        val file = api.getFile("theater/_manifest.json", ART_DATA_BRANCH)
            ?: error("art-data/theater/_manifest.json is missing")
        val arr = JSONArray(file.content)
        return List(arr.length()) { arr.getString(it) }
    }

    suspend fun listSourcePaintings(): List<ArtworkItem> {
        val prefix = "public/assets/"
        return api.listRepoTree()
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
        val file = api.getFile(META_PATH) ?: return emptyMap()
        return parseMeta(file.content)
    }

    suspend fun saveMetaEntry(id: String, entry: PaintingMeta?) {
        val file = api.getFile(META_PATH)
        val root = parseObject(file?.content)
        if (entry == null) {
            root.remove(id)
        } else {
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
        api.putFile(
            META_PATH,
            (root.toString(2) + "\n").toByteArray(),
            "admin android: update metadata for $id",
            file?.sha,
        )
    }

    suspend fun loadBandOverrides(): Map<String, Set<Int>> {
        val file = api.getFile(BAND_OVERRIDES_PATH) ?: return emptyMap()
        val root = parseObject(file.content)
        return root.keys().asSequence().associateWith { id ->
            val hidden = root.optJSONObject(id)?.optJSONArray("hidden") ?: JSONArray()
            buildSet {
                for (i in 0 until hidden.length()) add(hidden.getInt(i))
            }
        }
    }

    suspend fun saveBandOverrideEntry(id: String, hidden: Set<Int>?) {
        val file = api.getFile(BAND_OVERRIDES_PATH)
        val root = parseObject(file?.content)
        if (hidden.isNullOrEmpty()) {
            root.remove(id)
        } else {
            root.put(id, JSONObject().put("hidden", JSONArray(hidden.sorted())))
        }
        api.putFile(
            BAND_OVERRIDES_PATH,
            (root.toString(2) + "\n").toByteArray(),
            "admin android: update band overrides for $id",
            file?.sha,
        )
    }

    suspend fun loadSiteContent(): SiteContent {
        val file = api.getFile(SITE_PATH) ?: return SiteContent()
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

    suspend fun saveSiteContent(content: SiteContent) {
        val file = api.getFile(SITE_PATH)
        val links = JSONArray()
        content.menuLinks.forEach {
            links.put(JSONObject().put("label", it.label).put("href", it.href).put("external", it.external))
        }
        val root = JSONObject().put("about", content.about).put("menuLinks", links)
        api.putFile(
            SITE_PATH,
            (root.toString(2) + "\n").toByteArray(),
            "admin android: update site content",
            file?.sha,
        )
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
        return "$RAW_MAIN_BASE/" +
            relative.split('/').joinToString("/") { GitHubApi.encodeSegment(it) }
    }

    fun depthUrl(depthFile: String): String =
        "$RAW_ART_DATA_BASE/theater/" + GitHubApi.encodeSegment(depthFile)

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

    suspend fun uploadPainting(item: PickedFile): String {
        val safe = sanitizeIdAndFilename(item.displayName)
        api.putFile(
            "public/assets/" + safe.filename,
            item.bytes,
            "admin android: add painting " + safe.id,
        )
        return safe.id
    }

    suspend fun dispatchBake(ids: List<String>) {
        if (ids.isNotEmpty()) {
            api.dispatchWorkflow("theater_bake.yml", mapOf("ids" to ids.joinToString(",")))
        }
    }

    suspend fun removePainting(item: ArtworkItem) {
        val id = item.id
        val errors = mutableListOf<String>()
        var dispatched = false

        try {
            val sourceFilename = item.sourceFilename ?: fetchTheaterMeta(id)?.sourceImage
            if (!sourceFilename.isNullOrBlank()) {
                val tree = api.listRepoTree()
                val publicPath = "public/assets/$sourceFilename"
                val publicEntry = tree.firstOrNull { it.path == publicPath && it.type == "blob" }
                if (publicEntry != null) {
                    api.deleteFile(
                        publicPath,
                        "admin android: remove source photo for $id [skip-grind]",
                        publicEntry.sha,
                    )
                    if (publicEntry.mode == "120000") {
                        val rawPath = "public/assets/raw/$sourceFilename"
                        val rawEntry = tree.firstOrNull { it.path == rawPath && it.type == "blob" }
                        if (rawEntry != null) {
                            api.deleteFile(
                                rawPath,
                                "admin android: remove raw source photo for $id [skip-grind]",
                                rawEntry.sha,
                            )
                        }
                    }
                }
            }
        } catch (e: Exception) {
            errors += "source photo: " + e.message
        }

        try {
            saveMetaEntry(id, null)
        } catch (e: Exception) {
            errors += "metadata: " + e.message
        }
        try {
            saveBandOverrideEntry(id, null)
        } catch (e: Exception) {
            errors += "band overrides: " + e.message
        }

        try {
            removalMutex.withLock {
                waitForNoActiveRemovalRun()
                api.dispatchWorkflow("remove_painting.yml", mapOf("ids" to id))
                delay(REMOVAL_POLL_MS)
                waitForNoActiveRemovalRun()
            }
            dispatched = true
        } catch (e: Exception) {
            errors += "removal workflow dispatch: " + e.message
        }

        if (errors.isNotEmpty()) {
            val prefix =
                if (dispatched) {
                    "Removal dispatched, but cleanup had errors: "
                } else {
                    "Cleanup ran, but the removal workflow never dispatched: "
                }
            throw RemovalException(prefix + errors.joinToString("; "), dispatched)
        }
    }

    private suspend fun waitForNoActiveRemovalRun() {
        val deadline = System.currentTimeMillis() + REMOVAL_POLL_MAX_MS
        while (true) {
            if (api.listWorkflowRuns("remove_painting.yml", 5).none { it.status != "completed" }) return
            if (System.currentTimeMillis() > deadline) {
                error("A previous removal run has been active for over 20 minutes. Check GitHub Actions.")
            }
            delay(REMOVAL_POLL_MS)
        }
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
        const val RAW_MAIN_BASE =
            "https://raw.githubusercontent.com/HereLiesAz/hereliesaz.github.io/main"
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
