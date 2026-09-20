package com.hereliesaz.admin

import android.graphics.Bitmap

data class PaintingMeta(
    val title: String = "",
    val description: String = "",
    val tags: List<String> = emptyList(),
    val forSale: Boolean = false,
    val price: Double? = null,
    val currency: String = "USD",
)

data class ArtworkItem(
    val id: String,
    val sourceFilename: String? = null,
    val sourceIsSymlink: Boolean = false,
    val baked: Boolean = false,
)

data class RepoTreeEntry(
    val path: String,
    val mode: String,
    val type: String,
    val sha: String,
    val size: Long? = null,
)

data class MenuLink(
    val label: String = "",
    val href: String = "",
    val external: Boolean = true,
)

data class SiteContent(
    val about: String = DEFAULT_ABOUT,
    val menuLinks: List<MenuLink> = DEFAULT_LINKS,
) {
    companion object {
        const val DEFAULT_ABOUT =
            "The canvas is a closet. The paint is light. You navigate the dark by following what your eye almost-recognises."

        val DEFAULT_LINKS = listOf(
            MenuLink("github", "https://github.com/HereLiesAz", true),
            MenuLink("instagram", "https://instagram.com/hereliesaz", true),
            MenuLink("email", "mailto:hereliesaz@gmail.com", false),
            MenuLink("projects", "/projects", false),
        )
    }
}

data class RepoFile(
    val content: String,
    val sha: String,
)

data class TokenVerification(
    val login: String,
    val canWrite: Boolean,
    val actionsOk: Boolean,
)

data class WorkflowRun(
    val status: String,
    val id: Long = 0L,
    val conclusion: String? = null,
    val displayTitle: String = "",
)

data class WorkflowArtifact(
    val id: Long,
    val name: String,
    val expired: Boolean,
)

data class TheaterMeta(
    val sourceImage: String?,
    val depthFile: String,
    val bandEdges: List<Double>,
    val bandCenters: List<Double>,
)

data class BandPreview(
    val index: Int,
    val min: Double,
    val max: Double,
    val bitmap: Bitmap,
    val hidden: Boolean,
)

data class PickedFile(
    val displayName: String,
    val bytes: ByteArray,
)

data class PaintingForm(
    val title: String = "",
    val description: String = "",
    val tags: String = "",
    val forSale: Boolean = false,
    val price: String = "",
    val currency: String = "USD",
)

data class SanitizedFile(
    val id: String,
    val filename: String,
)

data class StagedUpload(
    val id: String,
    val filename: String,
    val localPath: String,
)

data class StagedRemoval(
    val id: String,
    val sourceFilename: String? = null,
    val sourceIsSymlink: Boolean = false,
)

data class AdminDraft(
    val metaUpdates: Map<String, PaintingMeta> = emptyMap(),
    val bandUpdates: Map<String, Set<Int>> = emptyMap(),
    val siteContent: SiteContent? = null,
    val uploads: List<StagedUpload> = emptyList(),
    val removals: Map<String, StagedRemoval> = emptyMap(),
) {
    val changeCount: Int
        get() =
            metaUpdates.size +
                bandUpdates.size +
                uploads.size +
                removals.size +
                if (siteContent != null) 1 else 0

    val isEmpty: Boolean
        get() = changeCount == 0
}

data class RepoMutation(
    val path: String,
    val content: ByteArray?,
)

data class SubmitResult(
    val commitSha: String,
    val dispatchWarnings: List<String> = emptyList(),
)

fun sanitizeIdAndFilename(name: String): SanitizedFile {
    val dot = name.lastIndexOf('.')
    val stem = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    val id = stem.replace(Regex("[^A-Za-z0-9._~()-]"), "_").ifBlank { "photo" }
    return SanitizedFile(id, "$id$ext")
}

class GitHubApiException(
    message: String,
    val status: Int,
) : Exception(message)

class RemovalException(
    message: String,
    val dispatched: Boolean,
) : Exception(message)

data class UpdateInfo(
    val version: String,
    val tag: String,
    val name: String,
    val notes: String,
    val downloadUrl: String,
    val assetName: String,
    val assetDigest: String?,
)
