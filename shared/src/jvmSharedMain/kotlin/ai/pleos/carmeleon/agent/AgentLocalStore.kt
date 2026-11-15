package ai.pleos.carmeleon.agent

import kotlinx.serialization.json.*
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

interface AgentLocalStore {
    fun read(key: String): JsonObject?
    fun write(key: String, value: JsonObject?)
}
class MemoryAgentLocalStore : AgentLocalStore {
    private val entries = mutableMapOf<String, JsonObject>()
    override fun read(key: String) = entries[key]
    override fun write(key: String, value: JsonObject?) { if (value == null) entries.remove(key) else entries[key] = value }
}
/** App-private cache only. Contains no credentials/originals. Never replays vehicle writes. */
class FileAgentLocalStore(private val directory: File) : AgentLocalStore {
    init { directory.mkdirs() }
    private fun file(key: String): File {
        require(key.matches(Regex("[A-Za-z0-9_-]{1,160}")))
        return File(directory, "$key.json")
    }
    @Synchronized override fun read(key: String): JsonObject? = runCatching {
        val source = file(key); if (!source.exists()) return null
        Json.parseToJsonElement(source.readText(Charsets.UTF_8)).jsonObject
    }.getOrNull()
    @Synchronized override fun write(key: String, value: JsonObject?) {
        val target = file(key)
        if (value == null) { target.delete(); return }
        val staging = File(directory, "$key.pending")
        staging.writeText(value.toString(), Charsets.UTF_8)
        runCatching { Files.move(staging.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE) }
            .getOrElse { Files.move(staging.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING) }
    }
}
