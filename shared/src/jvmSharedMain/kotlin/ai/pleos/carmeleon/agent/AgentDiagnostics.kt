package ai.pleos.carmeleon.agent

import kotlinx.serialization.json.*
import java.time.Instant

/** Deliberately excludes transcripts, file contents, coordinates and credentials. */
class AgentDiagnostics(private val capacity: Int = 400) {
    private val events = ArrayDeque<JsonObject>()
    @Synchronized fun record(name: String, id: String? = null, status: String? = null) {
        events.addLast(buildJsonObject { put("event", name); put("at", Instant.now().toString()); if (id != null) put("id", id); if (status != null) put("status", status) })
        while (events.size > capacity) events.removeFirst()
    }
    @Synchronized fun export(environment: String) = buildJsonObject {
        put("schema", 1); put("environment", environment); put("exportedAt", Instant.now().toString())
        put("sdkRuntimeVerified", false); putJsonArray("events") { events.forEach { add(it) } }
    }.toString()
}
