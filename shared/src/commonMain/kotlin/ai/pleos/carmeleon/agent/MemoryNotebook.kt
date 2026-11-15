package ai.pleos.carmeleon.agent

/** Source references identify the exact original version and readable range. */
data class SourceReference(
    val materialId: String? = null,
    val version: Long? = null,
    val page: Int? = null,
    val section: String? = null,
    val url: String? = null,
    val excerptId: String? = null,
    val accessedAt: Long? = null,
    val text: String? = null,
) {
    val isIdentifiable: Boolean get() =
        (materialId?.isNotBlank() == true && version != null && version > 0 &&
            ((page != null && page > 0) || !section.isNullOrBlank() || !excerptId.isNullOrBlank())) ||
            url?.startsWith("https://") == true
}

enum class MemoryScope { ACCOUNT, PATH, STOP }
enum class MemoryCertainty { USER_STATED, SOURCE_SUPPORTED, INFERRED }
data class MemoryVersion(val revision: Long, val text: String, val sources: List<SourceReference>,
    val certainty: MemoryCertainty, val updatedAt: Long, val deleted: Boolean)

data class MemoryNote(
    val id: String,
    val accountId: String,
    val text: String,
    val scope: MemoryScope = MemoryScope.ACCOUNT,
    val pathId: String? = null,
    val stopId: String? = null,
    val revision: Long = 1,
    val certainty: MemoryCertainty = MemoryCertainty.USER_STATED,
    val sources: List<SourceReference> = emptyList(),
    val updatedAt: Long,
    val deleted: Boolean = false,
    val history: List<MemoryVersion> = emptyList(),
) {
    init {
        require(accountId.isNotBlank() && id.isNotBlank() && text.isNotBlank())
        require(scope == MemoryScope.ACCOUNT || !pathId.isNullOrBlank())
        require(scope != MemoryScope.STOP || !stopId.isNullOrBlank())
        require(revision > 0)
    }
    internal fun historical() = MemoryVersion(revision, text, sources, certainty, updatedAt, deleted)
}

sealed interface MemoryResult {
    data class Saved(val note: MemoryNote) : MemoryResult
    data class Conflict(val current: MemoryNote) : MemoryResult
    data class Refused(val reason: String) : MemoryResult
}

/** Domain-only notebook; [snapshot] is persisted by the account repository, never a shared global cache. */
class MemoryNotebook(val accountId: String, restored: List<MemoryNote> = emptyList()) {
    init { require(accountId.isNotBlank()); require(restored.all { it.accountId == accountId }) }
    private val notes = restored.associateBy { it.id }.toMutableMap()
    val snapshot: List<MemoryNote> get() = notes.values.toList()

    fun create(note: MemoryNote): MemoryResult {
        if (note.accountId != accountId) return MemoryResult.Refused("다른 계정의 메모입니다.")
        notes[note.id]?.let { return MemoryResult.Conflict(it) }
        if (note.revision != 1L || note.deleted || note.history.isNotEmpty())
            return MemoryResult.Refused("새 메모의 버전을 확인해 주세요.")
        notes[note.id] = note
        return MemoryResult.Saved(note)
    }

    fun edit(id: String, expectedRevision: Long, text: String, now: Long,
        certainty: MemoryCertainty? = null, sources: List<SourceReference>? = null): MemoryResult {
        val current = notes[id] ?: return MemoryResult.Refused("메모를 찾을 수 없습니다.")
        if (current.revision != expectedRevision) return MemoryResult.Conflict(current)
        if (current.deleted) return MemoryResult.Refused("삭제한 메모는 먼저 복원해 주세요.")
        if (text.isBlank()) return MemoryResult.Refused("메모 내용을 입력해 주세요.")
        return save(current, current.copy(text = text, certainty = certainty ?: current.certainty,
            sources = sources ?: current.sources, updatedAt = now))
    }

    fun delete(id: String, expectedRevision: Long, now: Long): MemoryResult {
        val current = notes[id] ?: return MemoryResult.Refused("메모를 찾을 수 없습니다.")
        if (current.revision != expectedRevision) return MemoryResult.Conflict(current)
        if (current.deleted) return MemoryResult.Saved(current)
        return save(current, current.copy(deleted = true, updatedAt = now))
    }

    fun restoreVersion(id: String, expectedRevision: Long, historicalRevision: Long, now: Long): MemoryResult {
        val current = notes[id] ?: return MemoryResult.Refused("메모를 찾을 수 없습니다.")
        if (current.revision != expectedRevision) return MemoryResult.Conflict(current)
        val version = current.history.firstOrNull { it.revision == historicalRevision }
            ?: return MemoryResult.Refused("이전 버전을 찾을 수 없습니다.")
        return save(current, current.copy(text = version.text, sources = version.sources,
            certainty = version.certainty, deleted = version.deleted, updatedAt = now))
    }

    fun search(query: String = "", pathId: String? = null, stopId: String? = null,
        limit: Int = 12): List<MemoryNote> {
        val terms = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
        return notes.values.asSequence().filter { !it.deleted }
            .filter { it.scope == MemoryScope.ACCOUNT || it.pathId == pathId }
            .filter { it.scope != MemoryScope.STOP || it.stopId == stopId }
            .filter { note -> terms.all { it in note.text.lowercase() } }
            .sortedByDescending { it.updatedAt }.take(limit.coerceIn(0, 50)).toList()
    }

    private fun save(current: MemoryNote, changed: MemoryNote): MemoryResult {
        val next = changed.copy(revision = current.revision + 1,
            history = current.history + current.historical())
        notes[current.id] = next
        return MemoryResult.Saved(next)
    }
}

enum class ExtractionStatus { PENDING, EXTRACTING, READABLE, PARTIAL, FAILED, UNSUPPORTED }
data class MaterialExcerpt(
    val id: String,
    val materialId: String,
    val version: Long,
    val text: String,
    val page: Int? = null,
    val section: String? = null,
    val stopId: String? = null,
) {
    fun reference() = SourceReference(materialId, version, page, section, excerptId = id)
}

data class MaterialDocument(
    val id: String,
    val accountId: String,
    val filename: String,
    val mediaType: String,
    val version: Long,
    val sha256: String,
    val pathId: String,
    val stopId: String? = null,
    val status: ExtractionStatus = ExtractionStatus.PENDING,
    val excerpts: List<MaterialExcerpt> = emptyList(),
    val failure: String? = null,
    val updatedAt: Long,
    val deleted: Boolean = false,
) {
    init {
        require(id.isNotBlank() && accountId.isNotBlank() && pathId.isNotBlank())
        require(version > 0)
        require(excerpts.all { it.materialId == id && it.version == version })
    }
}

data class GroundedExcerpt(val filename: String, val text: String, val source: SourceReference)

/** Select only readable, latest, account/path-scoped text. Filenames are never content evidence. */
fun selectMaterialContext(materials: List<MaterialDocument>, accountId: String, pathId: String,
    stopId: String?, query: String, maxCharacters: Int = 6_000): List<GroundedExcerpt> {
    val terms = query.lowercase().split(Regex("\\s+")).filter { it.length > 1 }
    val eligible = materials.filter { it.accountId == accountId && it.pathId == pathId }
        .groupBy { it.id }.values.mapNotNull { versions -> versions.maxByOrNull { it.version } }
        .filter { !it.deleted && (it.stopId == null || it.stopId == stopId) &&
            (it.status == ExtractionStatus.READABLE || it.status == ExtractionStatus.PARTIAL) }
    val ranked = eligible.flatMap { material -> material.excerpts.filter {
        it.text.isNotBlank() && (it.stopId == null || it.stopId == stopId) &&
            (terms.isEmpty() || terms.any { term -> term in it.text.lowercase() })
    }.map { material to it } }.sortedWith(compareByDescending<Pair<MaterialDocument, MaterialExcerpt>> {
        val text = it.second.text.lowercase()
        terms.count { term -> term in text }
    }.thenBy { it.second.page ?: Int.MAX_VALUE }.thenBy { it.second.id })
    var remaining = maxCharacters.coerceIn(0, 50_000)
    return ranked.mapNotNull { (material, excerpt) ->
        if (remaining <= 0) null else {
            val text = excerpt.text.take(remaining)
            remaining -= text.length
            GroundedExcerpt(material.filename, text, excerpt.reference())
        }
    }
}
