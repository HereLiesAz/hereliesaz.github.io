package com.hereliesaz.admin

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class GitHubApi(private val tokenStore: TokenStore) {
    suspend fun verifyToken(): TokenVerification {
        val repo = request("/repos/$OWNER/$REPO") ?: error("Empty GitHub response")
        val canWrite = repo.optJSONObject("permissions")?.optBoolean("push", false) == true
        val actionsOk = try {
            request("/repos/$OWNER/$REPO/actions/workflows"); true
        } catch (e: GitHubApiException) {
            if (e.status == 403 || e.status == 404) false else throw e
        }
        return TokenVerification(repo.optJSONObject("owner")?.optString("login").orEmpty(), canWrite, actionsOk)
    }

    suspend fun listRepoTree(ref: String = BRANCH): List<RepoTreeEntry> {
        val json = request("/repos/$OWNER/$REPO/git/trees/" + encodeSegment(ref) + "?recursive=1")
            ?: error("Empty repository tree response")
        if (json.optBoolean("truncated", false)) {
            error("GitHub returned a truncated repository tree; refusing to hide part of the photo library.")
        }
        val tree = json.optJSONArray("tree") ?: JSONArray()
        return buildList {
            for (i in 0 until tree.length()) {
                val entry = tree.getJSONObject(i)
                add(
                    RepoTreeEntry(
                        path = entry.optString("path"),
                        mode = entry.optString("mode"),
                        type = entry.optString("type"),
                        sha = entry.optString("sha"),
                        size = if (entry.has("size")) entry.optLong("size") else null,
                    ),
                )
            }
        }
    }

    suspend fun getBranchHeadSha(ref: String = BRANCH): String {
        val json = request("/repos/$OWNER/$REPO/git/ref/heads/" + encodeSegment(ref))
            ?: error("Empty Git reference response")
        return json.getJSONObject("object").getString("sha")
    }

    suspend fun commitBatch(
        mutations: List<RepoMutation>,
        message: String,
        parentSha: String,
    ): String {
        if (mutations.isEmpty()) return parentSha

        val parent = request("/repos/$OWNER/$REPO/git/commits/" + encodeSegment(parentSha))
            ?: error("Could not read parent commit")
        val baseTreeSha = parent.getJSONObject("tree").getString("sha")

        val uniqueMutations = linkedMapOf<String, RepoMutation>()
        mutations.forEach { uniqueMutations[it.path] = it }

        val entries = JSONArray()
        uniqueMutations.values.forEach { mutation ->
            val entry = JSONObject()
                .put("path", mutation.path)
                .put("mode", "100644")
                .put("type", "blob")

            if (mutation.content == null) {
                entry.put("sha", JSONObject.NULL)
            } else {
                val blob = request(
                    "/repos/$OWNER/$REPO/git/blobs",
                    "POST",
                    JSONObject()
                        .put("content", Base64.encodeToString(mutation.content, Base64.NO_WRAP))
                        .put("encoding", "base64"),
                ) ?: error("Could not create blob for " + mutation.path)
                entry.put("sha", blob.getString("sha"))
            }
            entries.put(entry)
        }

        val tree = request(
            "/repos/$OWNER/$REPO/git/trees",
            "POST",
            JSONObject()
                .put("base_tree", baseTreeSha)
                .put("tree", entries),
        ) ?: error("Could not create Git tree")

        val commit = request(
            "/repos/$OWNER/$REPO/git/commits",
            "POST",
            JSONObject()
                .put("message", message)
                .put("tree", tree.getString("sha"))
                .put("parents", JSONArray().put(parentSha)),
        ) ?: error("Could not create Git commit")

        val commitSha = commit.getString("sha")
        request(
            "/repos/$OWNER/$REPO/git/refs/heads/" + encodeSegment(BRANCH),
            "PATCH",
            JSONObject()
                .put("sha", commitSha)
                .put("force", false),
        )
        return commitSha
    }

    suspend fun getFile(path: String, ref: String = BRANCH): RepoFile? {
        return try {
            val json = request(
                "/repos/$OWNER/$REPO/contents/" + encodePath(path) + "?ref=" + encodeSegment(ref),
            ) ?: return null
            val encoded = json.getString("content").replace(Regex("\\s"), "")
            RepoFile(String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8), json.getString("sha"))
        } catch (e: GitHubApiException) {
            if (e.status == 404) null else throw e
        }
    }

    suspend fun putFile(path: String, bytes: ByteArray, message: String, sha: String? = null) {
        val body = JSONObject().put("message", message).put("content", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("branch", BRANCH)
        if (sha != null) body.put("sha", sha)
        request("/repos/$OWNER/$REPO/contents/" + encodePath(path), "PUT", body)
    }

    suspend fun deleteFile(path: String, message: String, sha: String) {
        request(
            "/repos/$OWNER/$REPO/contents/" + encodePath(path),
            "DELETE",
            JSONObject().put("message", message).put("sha", sha).put("branch", BRANCH),
        )
    }

    suspend fun dispatchWorkflow(workflowFile: String, inputs: Map<String, String> = emptyMap()) {
        val inputJson = JSONObject()
        inputs.forEach { (k, v) -> inputJson.put(k, v) }
        request(
            "/repos/$OWNER/$REPO/actions/workflows/" + encodeSegment(workflowFile) + "/dispatches",
            "POST",
            JSONObject().put("ref", BRANCH).put("inputs", inputJson),
        )
    }

    suspend fun listWorkflowRuns(workflowFile: String, perPage: Int = 5): List<WorkflowRun> {
        val json = request("/repos/$OWNER/$REPO/actions/workflows/" + encodeSegment(workflowFile) + "/runs?per_page=$perPage") ?: return emptyList()
        val runs = json.optJSONArray("workflow_runs") ?: JSONArray()
        return buildList {
            for (i in 0 until runs.length()) {
                val run = runs.getJSONObject(i)
                add(
                    WorkflowRun(
                        status = run.optString("status"),
                        id = run.optLong("id"),
                        conclusion = run.optString("conclusion").takeIf { it.isNotBlank() && it != "null" },
                        displayTitle = run.optString("display_title"),
                    ),
                )
            }
        }
    }

    suspend fun listRunArtifacts(runId: Long): List<WorkflowArtifact> {
        val json = request("/repos/$OWNER/$REPO/actions/runs/$runId/artifacts?per_page=100") ?: return emptyList()
        val artifacts = json.optJSONArray("artifacts") ?: JSONArray()
        return buildList {
            for (i in 0 until artifacts.length()) {
                val artifact = artifacts.getJSONObject(i)
                add(
                    WorkflowArtifact(
                        id = artifact.optLong("id"),
                        name = artifact.optString("name"),
                        expired = artifact.optBoolean("expired", false),
                    ),
                )
            }
        }
    }

    suspend fun downloadArtifactZip(artifactId: Long): ByteArray = withContext(Dispatchers.IO) {
        val token = tokenStore.load()
        if (token.isBlank()) throw GitHubApiException("No gh_token saved in the app.", 401)
        val conn = (URL("https://api.github.com/repos/$OWNER/$REPO/actions/artifacts/$artifactId/zip").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        }
        try {
            val code = conn.responseCode
            val location = conn.getHeaderField("Location")
            if (code !in 300..399 || location.isNullOrBlank()) {
                val detail = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                throw GitHubApiException("Artifact download failed: $code $detail", code)
            }
            publicBytes(location)
        } finally {
            conn.disconnect()
        }
    }

    suspend fun publicBytes(url: String): ByteArray = withContext(Dispatchers.IO) {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            requestMethod = "GET"
            setRequestProperty("Accept", "*/*")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw GitHubApiException("HTTP GET $url failed: $code", code)
            conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                input.copyTo(out)
                out.toByteArray()
            }
        } finally {
            conn.disconnect()
        }
    }

    suspend fun publicText(url: String): String = String(publicBytes(url), Charsets.UTF_8)

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject? =
        withContext(Dispatchers.IO) {
            val token = tokenStore.load()
            if (token.isBlank()) throw GitHubApiException("No GitHub token set — open Settings first.", 401)
            val conn = (URL("https://api.github.com$path").openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            try {
                if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                if (code !in 200..299) {
                    val detail = runCatching { JSONObject(text).optString("message") }.getOrDefault("")
                    throw GitHubApiException("GitHub API $method $path failed: $code" + if (detail.isNotBlank()) " — $detail" else "", code)
                }
                if (code == 204 || text.isBlank()) null else JSONObject(text)
            } catch (e: GitHubApiException) {
                throw e
            } catch (e: Exception) {
                throw GitHubApiException("Could not reach GitHub — check your connection and try again. " + e.message.orEmpty(), 0)
            } finally {
                conn.disconnect()
            }
        }

    private fun encodePath(path: String): String = path.split('/').joinToString("/") { encodeSegment(it) }

    companion object {
        const val OWNER = "HereLiesAz"
        const val REPO = "hereliesaz.github.io"
        const val BRANCH = "main"

        fun encodeSegment(value: String): String =
            URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    }
}
