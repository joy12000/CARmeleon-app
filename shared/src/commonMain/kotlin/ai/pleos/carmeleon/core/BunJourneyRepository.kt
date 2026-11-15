package ai.pleos.carmeleon.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

class BackendException(message: String) : Exception(message)

/** Existing backend content is explicitly labelled as sample, regardless of its SUCCESS wrapper. */
class BunJourneyRepository(private val transport: BackendTransport, baseUrl: String) : JourneyRepository {
    override val baseUrl: String = baseUrl.trim().trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    init {
        require(this.baseUrl.startsWith("http://") || this.baseUrl.startsWith("https://")) { "서버 주소는 http:// 또는 https://로 시작해야 합니다." }
        val authority = this.baseUrl.substringAfter("://").substringBefore('/')
        require(authority.isNotBlank() && '@' !in authority && this.baseUrl.none { it.isWhitespace() } && '?' !in this.baseUrl && '#' !in this.baseUrl) { "서버 주소 형식이 올바르지 않습니다." }
    }

    override suspend fun activeRoute(): JourneyRoute? {
        val response = request("GET", "/api/v1/vehicles/me/active-route")
        val route = response["activeRoute"] as? JsonObject ?: response["route"] as? JsonObject ?: return null
        return decodeRoute(route)
    }

    override suspend fun saveRoute(route: JourneyRoute): JourneyRoute {
        if (!route.isNavigable) throw BackendException("유효한 좌표가 없는 일정은 저장할 수 없습니다.")
        val body = buildJsonObject {
            put("routeId", route.id); put("title", route.title)
            put("stops", buildJsonArray { route.stops.forEach { stop -> add(buildJsonObject {
                put("id", stop.id); put("name", stop.name); put("address", stop.address)
                put("latitude", stop.coordinate!!.latitude); put("longitude", stop.coordinate.longitude)
                put("poiId", stop.poiId); put("memo", stop.memo)
                put("type", "travel")
            }) } })
        }
        val response = request("POST", "/api/v1/routes", body)
        return (response["route"] as? JsonObject)?.let(::decodeRoute) ?: throw BackendException("서버 응답에 저장된 일정이 없습니다.")
    }

    override suspend fun briefings(routeId: String): List<Briefing> {
        val response = request("GET", "/api/v1/routes/${encodePath(routeId)}/briefings")
        val entries = response["briefings"] as? JsonArray ?: throw BackendException("서버 응답에 일정 안내 목록이 없습니다.")
        return entries.mapNotNull { value -> (value as? JsonObject)?.let { obj ->
            Briefing(obj.text("stopId"), obj.text("stopName"), obj.stringList("briefingPoints"), obj.text("speechText"))
        } }
    }

    override suspend fun guide(location: Coordinate?, step: Int): GuideContent {
        val body = buildJsonObject {
            if (location?.isValid == true) { put("latitude", location.latitude); put("longitude", location.longitude) }
            put("step", step.coerceAtLeast(0))
        }
        val response = request("POST", "/api/v1/guide/autonomous", body)
        val spot = response["spot"] as? JsonObject
        val speech = response.text("speechText").ifBlank { spot?.text("speechText").orEmpty() }
        if (speech.isBlank()) throw BackendException("서버 응답에 안내 내용이 없습니다.")
        return GuideContent(spot?.text("title").orEmpty().ifBlank { "서버 예시 동행 이야기" }, speech)
    }

    override suspend fun nearby(kind: PoiKind, location: Coordinate?): List<PoiCandidate> {
        if (kind == PoiKind.MEAL) throw BackendException("기존 서버에는 식사 장소 검색 API가 없어 예시 식당으로 보여드립니다.")
        val body = buildJsonObject {
            put("type", if (kind == PoiKind.CHARGER) "ev_charger" else "restroom")
            if (location?.isValid == true) { put("latitude", location.latitude); put("longitude", location.longitude) }
        }
        val response = request("POST", "/api/v1/poi/nearby", body)
        val entries = response["items"] as? JsonArray ?: throw BackendException("서버 응답에 장소 목록이 없습니다.")
        return entries.mapNotNull { element ->
            val item = element as? JsonObject ?: return@mapNotNull null
            val stop = decodeStop(item, kind)
            if (stop.coordinate?.isValid != true || stop.name.isBlank()) return@mapNotNull null
            PoiCandidate(stop.copy(dwellMinutes = if (kind == PoiKind.CHARGER) 25 else 10), item.number("durationMin")?.toInt(), item.number("distanceKm"), item.text("detail"))
        }
    }

    private suspend fun request(method: String, path: String, body: JsonObject? = null): JsonObject {
        val reply = transport.send(method, baseUrl + path, body?.toString())
        if (reply.status !in 200..299) throw BackendException("서버 요청 실패 (${reply.status}). 서버 주소와 실행 상태를 확인해 주세요.")
        val response = try { json.parseToJsonElement(reply.body) as? JsonObject } catch (_: Exception) { null }
            ?: throw BackendException("서버에서 올바른 JSON 응답을 받지 못했습니다.")
        val status = response.text("status")
        if (status.isNotBlank() && status != "SUCCESS") throw BackendException(response.text("message").ifBlank { "서버가 요청을 완료하지 못했습니다: $status" })
        return response
    }

    private fun decodeRoute(obj: JsonObject): JourneyRoute {
        val id = obj.text("routeId").ifBlank { obj.text("id") }
        if (id.isBlank()) throw BackendException("서버 일정 ID가 없습니다.")
        val stops = (obj["stops"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let { stop -> decodeStop(stop) } }
        if (stops.isEmpty()) throw BackendException("서버 일정에 목적지가 없습니다.")
        return JourneyRoute(id, obj.text("title").ifBlank { "서버 일정" }, stops,
            durationMinutes = obj.number("totalDurationMin")?.toInt()?.coerceAtLeast(0) ?: 38,
            distanceKm = obj.number("totalDistanceKm")?.coerceAtLeast(0.0) ?: 24.0, origin = DataOrigin.BACKEND_SAMPLE)
    }

    private fun decodeStop(obj: JsonObject, kind: PoiKind? = null): RouteStop {
        val latitude = obj.number("latitude") ?: obj.number("lat")
        val longitude = obj.number("longitude") ?: obj.number("lng")
        val coordinate = if (latitude != null && longitude != null) Coordinate(latitude, longitude).takeIf { it.isValid } else null
        val name = obj.text("name")
        return RouteStop(obj.text("id").ifBlank { obj.text("poiId").ifBlank { "stop-$name" } }, name, coordinate,
            obj.text("address"), obj.text("poiId").ifBlank { "0" }, kind, obj.number("dwellMinutes")?.toInt()?.coerceAtLeast(0) ?: 0, obj.text("memo"))
    }
}

private fun JsonObject.text(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
private fun JsonObject.number(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }
private fun JsonObject.stringList(key: String): List<String> = (this[key] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
private fun encodePath(value: String): String = buildString {
    value.encodeToByteArray().forEach { byte ->
        val ch = byte.toInt() and 255
        if (ch in 65..90 || ch in 97..122 || ch in 48..57 || ch in listOf(45, 46, 95, 126)) append(ch.toChar())
        else { append('%'); append("0123456789ABCDEF"[ch shr 4]); append("0123456789ABCDEF"[ch and 15]) }
    }
}
