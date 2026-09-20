package com.hereliesaz.admin

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

class DraftStore(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val uploadDir = File(appContext.filesDir, "admin-draft-uploads").apply { mkdirs() }

    fun load(): AdminDraft {
        val raw = prefs.getString(KEY_DRAFT, null) ?: return AdminDraft()
        return runCatching { decode(JSONObject(raw)) }.getOrElse { AdminDraft() }
    }

    fun save(draft: AdminDraft) {
        prefs.edit().putString(KEY_DRAFT, encode(draft).toString()).apply()
    }

    fun stageUploads(current: AdminDraft, files: List<PickedFile>): AdminDraft {
        if (files.isEmpty()) return current

        val byId = current.uploads.associateBy { it.id }.toMutableMap()
        val removals = current.removals.toMutableMap()

        files.forEach { picked ->
            val safe = sanitizeIdAndFilename(picked.displayName)
            byId.remove(safe.id)?.let { old ->
                runCatching { File(old.localPath).delete() }
            }

            val local = File(uploadDir, UUID.randomUUID().toString() + ".bin")
            local.writeBytes(picked.bytes)
            byId[safe.id] = StagedUpload(
                id = safe.id,
                filename = safe.filename,
                localPath = local.absolutePath,
            )
            removals.remove(safe.id)
        }

        return current.copy(
            uploads = byId.values.sortedBy { it.id.lowercase() },
            removals = removals,
        )
    }

    fun readUpload(upload: StagedUpload): PickedFile {
        val file = File(upload.localPath)
        require(file.isFile) { "Staged upload ${upload.filename} is missing from local storage." }
        return PickedFile(upload.filename, file.readBytes())
    }

    fun clear(draft: AdminDraft) {
        draft.uploads.forEach { runCatching { File(it.localPath).delete() } }
        prefs.edit().remove(KEY_DRAFT).apply()
    }

    private fun encode(draft: AdminDraft): JSONObject {
        val root = JSONObject()

        val meta = JSONObject()
        draft.metaUpdates.forEach { (id, value) -> meta.put(id, encodeMeta(value)) }
        root.put("metaUpdates", meta)

        val bands = JSONObject()
        draft.bandUpdates.forEach { (id, hidden) ->
            bands.put(id, JSONArray(hidden.sorted()))
        }
        root.put("bandUpdates", bands)

        draft.siteContent?.let { root.put("siteContent", encodeSite(it)) }

        val uploads = JSONArray()
        draft.uploads.forEach { upload ->
            uploads.put(
                JSONObject()
                    .put("id", upload.id)
                    .put("filename", upload.filename)
                    .put("localPath", upload.localPath),
            )
        }
        root.put("uploads", uploads)

        val removals = JSONObject()
        draft.removals.forEach { (id, removal) ->
            removals.put(
                id,
                JSONObject()
                    .put("id", removal.id)
                    .put("sourceFilename", removal.sourceFilename ?: JSONObject.NULL)
                    .put("sourceIsSymlink", removal.sourceIsSymlink),
            )
        }
        root.put("removals", removals)

        return root
    }

    private fun decode(root: JSONObject): AdminDraft {
        val meta = mutableMapOf<String, PaintingMeta>()
        root.optJSONObject("metaUpdates")?.let { obj ->
            obj.keys().forEach { id ->
                obj.optJSONObject(id)?.let { value -> meta[id] = decodeMeta(value) }
            }
        }

        val bands = mutableMapOf<String, Set<Int>>()
        root.optJSONObject("bandUpdates")?.let { obj ->
            obj.keys().forEach { id ->
                val arr = obj.optJSONArray(id) ?: JSONArray()
                bands[id] = buildSet {
                    for (i in 0 until arr.length()) add(arr.getInt(i))
                }
            }
        }

        val uploads = buildList {
            val arr = root.optJSONArray("uploads") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val path = item.optString("localPath")
                if (path.isBlank()) continue
                add(
                    StagedUpload(
                        id = item.optString("id"),
                        filename = item.optString("filename"),
                        localPath = path,
                    ),
                )
            }
        }

        val removals = mutableMapOf<String, StagedRemoval>()
        root.optJSONObject("removals")?.let { obj ->
            obj.keys().forEach { id ->
                val item = obj.optJSONObject(id) ?: return@forEach
                removals[id] = StagedRemoval(
                    id = item.optString("id", id),
                    sourceFilename = item.optString("sourceFilename")
                        .takeIf { it.isNotBlank() && it != "null" },
                    sourceIsSymlink = item.optBoolean("sourceIsSymlink", false),
                )
            }
        }

        return AdminDraft(
            metaUpdates = meta,
            bandUpdates = bands,
            siteContent = root.optJSONObject("siteContent")?.let(::decodeSite),
            uploads = uploads,
            removals = removals,
        )
    }

    private fun encodeMeta(meta: PaintingMeta): JSONObject =
        JSONObject()
            .put("title", meta.title)
            .put("description", meta.description)
            .put("tags", JSONArray(meta.tags))
            .put("forSale", meta.forSale)
            .apply {
                if (meta.forSale && meta.price != null) {
                    put("price", meta.price)
                    put("currency", meta.currency)
                }
            }

    private fun decodeMeta(root: JSONObject): PaintingMeta {
        val tags = root.optJSONArray("tags") ?: JSONArray()
        return PaintingMeta(
            title = root.optString("title"),
            description = root.optString("description"),
            tags = List(tags.length()) { tags.optString(it) },
            forSale = root.optBoolean("forSale", false),
            price = if (root.has("price")) root.optDouble("price") else null,
            currency = root.optString("currency", "USD"),
        )
    }

    private fun encodeSite(site: SiteContent): JSONObject {
        val links = JSONArray()
        site.menuLinks.forEach { link ->
            links.put(
                JSONObject()
                    .put("label", link.label)
                    .put("href", link.href)
                    .put("external", link.external),
            )
        }
        return JSONObject()
            .put("about", site.about)
            .put("menuLinks", links)
    }

    private fun decodeSite(root: JSONObject): SiteContent {
        val links = buildList {
            val arr = root.optJSONArray("menuLinks") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                add(
                    MenuLink(
                        label = item.optString("label"),
                        href = item.optString("href"),
                        external = item.optBoolean("external", true),
                    ),
                )
            }
        }
        return SiteContent(
            about = root.optString("about", SiteContent.DEFAULT_ABOUT),
            menuLinks = links,
        )
    }

    companion object {
        private const val PREFS_NAME = "admin-draft"
        private const val KEY_DRAFT = "draft"
    }
}
