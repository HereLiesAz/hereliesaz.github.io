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
    suspend fun getFile(path: String): RepoFile? {
        return try {
            val json = request("/repos/$OWNER/$REPO/contents/" + encodePath(path) + "?ref=$BRANCH") ?: return null
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
        return buildList { for (i in 0 until runs.length()) add(WorkflowRun(runs.getJSONObject(i).optString("status"))) }
    }
    suspend fun publicBytes(url: String): ByteArray = withContext(Dispatchers.IO) {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000; readTimeout = 30_000; requestMethod = "GET"; setRequestProperty("Accept", "*/*")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw GitHubApiException("HTTP GET $url failed: $code", code)
            conn.inputStream.use { input ->
                val out = ByteArrayOutputStream(); input.copyTo(out); out.toByteArray()
            }
        } finally { conn.disconnect() }
    }
    suspend fun publicText(url: String): String = String(publicBytes(url), Charsets.UTF_8)

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject? =
        withContext(Dispatchers.IO) {
            val token = tokenStore.load()
            if (token.isBlank()) throw@withContext GitHubApiException("No GitHub token set — open Settings first.", 401)
            val conn = (URL("https://api.github.com$path").openConnection() as HttpURLConnection).apply {
                requestMethod = method; connectTimeout = 15_000; readTimeout = 30_000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
                if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json") }
            }
            try {
                if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                if (code !in 200..299) {
                    val detail = runCatching { JSONObject(text).optString("message") }.getOrDefault("")
                    throw@withContext GitHubApiException("GitHub API $method $path failed: $code" + if (detail.isNotBlank()) " — $detail" else "", code)
                }
                if (code == 204 || text.isBlank()) null else JSONObject(text)
            } catch (e: GitHubApiException) {
                throw@withContext e
            } catch (e: Exception) {
                throw@withContext GitHubApiException("Could not reach GitHub — check your connection and try again. " + e.message.orEmpty(), 0)
            } finally { conn.disconnect() }
        }

    private fun encodePath(path: String): String = path.split('/').joinToString("/") { encodeSegment(it) }
    companion object {
        const val OWNER = "HereLiesAz"
        const val REPO = "hereliesaz.github.io"
        const val BRANCH = "main"
        fun encodeSegment(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    }
}
