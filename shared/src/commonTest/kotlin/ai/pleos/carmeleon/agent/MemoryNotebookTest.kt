package ai.pleos.carmeleon.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class MemoryNotebookTest {
    private fun note(id: String = "n", account: String = "alice") = MemoryNote(id, account,
        "주차는 지하 2층", updatedAt = 1_000)

    @Test fun accountAndStopScopesExcludeUnrelatedContexts() {
        val notebook = MemoryNotebook("alice")
        assertIs<MemoryResult.Refused>(notebook.create(note(account = "bob")))
        notebook.create(note())
        notebook.create(note("business").copy(scope = MemoryScope.STOP, pathId = "path", stopId = "office"))
        assertEquals(1, notebook.search(pathId = "other", stopId = "office").size)
        assertEquals(2, notebook.search(pathId = "path", stopId = "office").size)
    }

    @Test fun deletionImmediatelyLeavesSearchAndCanRestoreHistoricalVersion() {
        val notebook = MemoryNotebook("alice")
        notebook.create(note())
        assertIs<MemoryResult.Saved>(notebook.delete("n", 1, 2_000))
        assertTrue(notebook.search("주차").isEmpty())
        val restored = assertIs<MemoryResult.Saved>(notebook.restoreVersion("n", 2, 1, 3_000)).note
        assertEquals(3L, restored.revision)
        assertEquals(1, notebook.search("지하").size)
        assertEquals(2, restored.history.size)
    }

    @Test fun editingConflictCannotOverwriteNewerFactOrPromoteInference() {
        val notebook = MemoryNotebook("alice")
        notebook.create(note().copy(certainty = MemoryCertainty.INFERRED))
        notebook.edit("n", 1, "주차는 지하 3층", 2_000)
        assertIs<MemoryResult.Conflict>(notebook.edit("n", 1, "오래된 내용", 3_000))
        assertEquals(MemoryCertainty.INFERRED, notebook.search().single().certainty)
        assertEquals("주차는 지하 3층", notebook.search().single().text)
    }

    private fun material(version: Long = 1, account: String = "alice", status: ExtractionStatus = ExtractionStatus.READABLE,
        text: String = "회의는 납기를 중심으로 이야기합니다.") = MaterialDocument("file", account,
        "contract.pdf", "application/pdf", version, "hash-$version", "path", status = status,
        excerpts = if (status == ExtractionStatus.READABLE) listOf(MaterialExcerpt("page-1", "file", version, text, 1)) else emptyList(),
        updatedAt = version * 1_000)

    @Test fun unreadableLatestVersionDoesNotLeakOldReadableExcerpts() {
        val context = selectMaterialContext(listOf(material(), material(2, status = ExtractionStatus.FAILED)),
            "alice", "path", null, "납기")
        assertTrue(context.isEmpty())
    }

    @Test fun contextLimitsCharactersAndIncludesExactVersionPage() {
        val context = selectMaterialContext(listOf(material(text = "내용".repeat(100)), material(account = "bob")),
            "alice", "path", null, "내용", maxCharacters = 25)
        assertEquals(25, context.sumOf { it.text.length })
        assertEquals(1, context.single().source.page)
        assertEquals(1L, context.single().source.version)
        assertEquals("file", context.single().source.materialId)
    }

    @Test fun deletedLatestOriginalDoesNotReturnItsOlderContent() {
        assertTrue(selectMaterialContext(listOf(material(), material(2).copy(deleted = true)),
            "alice", "path", null, "납기").isEmpty())
    }
}
