package ai.pleos.carmeleon.agent

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.*
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID

/** Per-account credentials are provided by a platform vault, never compiled into an APK. */
interface AgentTokenVault {
    fun read(): String?
    fun write(token: String?)
}
class SessionTokenVault : AgentTokenVault {
    private var token: String? = null
    override fun read() = token
    override fun write(token: String?) { this.token = token }
}

data class AgentServerEvent(val name: String, val data: JsonObject)
class AgentHttpException(val status: Int, val code: String, message: String) : Exception(message)

class AgentHttpClient(baseUrl: String, private val vault: AgentTokenVault) {
    val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }
    init {
        val uri = URI(this.baseUrl)
        require(uri.scheme == "https" || uri.scheme == "http" && uri.host in setOf("localhost", "127.0.0.1", "10.0.2.2")) {
            "원격 계정 연결에는 HTTPS 주소가 필요합니다."
        }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null)
    }
    private fun connection(path: String, method: String): HttpURLConnection {
        require(path.startsWith("/") && !path.contains(".."))
        return (URI("$baseUrl/api/v1$path").toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 12_000; readTimeout = 45_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            vault.read()?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
    }
    private fun parse(text: String): JsonObject {
        if (text.isBlank()) return buildJsonObject {}
        val element = json.parseToJsonElement(text)
        return if (element is JsonNull) buildJsonObject {} else element.jsonObject
    }
    private fun checkResponse(connection: HttpURLConnection, body: String) {
        if (connection.responseCode in 200..299) return
        val error = runCatching { parse(body)["error"]?.jsonObject }.getOrNull()
        throw AgentHttpException(connection.responseCode, error?.get("code")?.jsonPrimitive?.content ?: "HTTP_ERROR",
            error?.get("message")?.jsonPrimitive?.content ?: "서버 요청 실패 (${connection.responseCode})")
    }
    suspend fun request(method: String, path: String, body: JsonObject? = null): JsonObject = withContext(Dispatchers.IO) {
        val connection = connection(path, method)
        try {
            if (body != null) {
                connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val response = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            checkResponse(connection, response)
            parse(response)
        } finally { connection.disconnect() }
    }
    suspend fun upload(name: String, bytes: ByteArray, mimeType: String, pathId: String, stopId: String? = null): JsonObject = withContext(Dispatchers.IO) {
        require(bytes.size <= 20 * 1024 * 1024) { "자료는 20MB까지 추가할 수 있습니다." }
        val boundary = "carmeleon-${UUID.randomUUID()}"
        val connection = connection("/materials", "POST")
        try {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            connection.outputStream.use { out ->
                fun text(value: String) { out.write(value.toByteArray(Charsets.UTF_8)) }
                text("--$boundary\r\nContent-Disposition: form-data; name=\"pathId\"\r\n\r\n$pathId\r\n")
                if (stopId != null) text("--$boundary\r\nContent-Disposition: form-data; name=\"stopId\"\r\n\r\n$stopId\r\n")
                val safeName = name.replace(Regex("[\\r\\n\"\\\\]"), "_")
                val safeMime = mimeType.takeIf { it.matches(Regex("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")) } ?: "application/octet-stream"
                text("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$safeName\"\r\nContent-Type: $safeMime\r\n\r\n")
                out.write(bytes); text("\r\n--$boundary--\r\n")
            }
            val response = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            checkResponse(connection, response); parse(response)
        } finally { connection.disconnect() }
    }
    /** Closing a collected stream immediately disconnects its socket. There is no automatic retry of a turn. */
    fun turn(body: JsonObject): Flow<AgentServerEvent> = callbackFlow {
        val connection = connection("/turns", "POST")
        val worker = launch(Dispatchers.IO) {
            try {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setRequestProperty("Accept", "text/event-stream")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                if (connection.responseCode !in 200..299) {
                    val error = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                    checkResponse(connection, error)
                }
                connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                    var event = "message"
                    val data = StringBuilder()
                    while (isActive) {
                        val line = reader.readLine() ?: break
                        when {
                            line.isEmpty() -> { if (data.isNotEmpty()) send(AgentServerEvent(event, parse(data.toString()))); data.clear(); event = "message" }
                            line.startsWith("event:") -> event = line.substringAfter(':').trim()
                            line.startsWith("data:") -> { if (data.isNotEmpty()) data.append('\n'); data.append(line.substringAfter(':').trimStart()); require(data.length <= 1_000_000) }
                        }
                    }
                }
                close()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { close(e) }
        }
        awaitClose { connection.disconnect(); worker.cancel() }
    }
    fun saveToken(token: String?) = vault.write(token)
    fun hasToken() = vault.read() != null
}

internal fun JsonObject.text(key: String): String? = get(key)?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
internal fun JsonObject.number(key: String): Long = get(key)?.jsonPrimitive?.longOrNull ?: 0
internal fun JsonObject.objects(key: String): List<JsonObject> = get(key)?.jsonArray?.map { it.jsonObject }.orEmpty()
internal fun operationId(): String = UUID.randomUUID().toString()
