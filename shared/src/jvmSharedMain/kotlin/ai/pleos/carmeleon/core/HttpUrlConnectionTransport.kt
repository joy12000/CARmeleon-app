package ai.pleos.carmeleon.core

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Java networking shared by Android and desktop; no browser origin/proxy dependency. */
class HttpUrlConnectionTransport(private val connectTimeoutMillis: Int = 6_000, private val readTimeoutMillis: Int = 10_000) : BackendTransport {
    override suspend fun send(method: String, url: String, body: String?): HttpReply = withContext(Dispatchers.IO) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = connectTimeoutMillis
            readTimeout = readTimeoutMillis
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            HttpReply(status, response)
        } finally { connection.disconnect() }
    }
}
