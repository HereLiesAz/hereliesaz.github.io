package com.hereliesaz.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BakeSelectionTest {
    private val unbaked = ArtworkItem("raw", sourceFilename = "raw.jpg")
    private val baked = ArtworkItem("ready", sourceFilename = "ready.jpg", baked = true)
    private val orphanBake = ArtworkItem("orphan", baked = true)

    @Test fun filtersByLiveBakedStatus() {
        assertTrue(unbaked.matchesBakeStatus(BakeStatusFilter.All))
        assertTrue(baked.matchesBakeStatus(BakeStatusFilter.All))
        assertTrue(orphanBake.matchesBakeStatus(BakeStatusFilter.Baked))
        assertTrue(baked.matchesBakeStatus(BakeStatusFilter.Baked))
        assertFalse(unbaked.matchesBakeStatus(BakeStatusFilter.Baked))
        assertTrue(unbaked.matchesBakeStatus(BakeStatusFilter.NotBaked))
        assertFalse(baked.matchesBakeStatus(BakeStatusFilter.NotBaked))
        assertFalse(orphanBake.matchesBakeStatus(BakeStatusFilter.NotBaked))
    }

    @Test fun selectsOnlyUnbakedExistingSourcesForBatch() {
        val items = listOf(
            baked,
            ArtworkItem("z", sourceFilename = "z.png"),
            unbaked,
            orphanBake,
            ArtworkItem("missing"),
            ArtworkItem("raw", sourceFilename = "raw.webp"),
        )
        assertEquals(
            listOf("raw", "z"),
            eligibleBakeIds(items, setOf("raw", "z", "ready", "orphan", "missing", "stale")),
        )
        assertEquals(emptyList<String>(), eligibleBakeIds(items, setOf("ready", "missing")))
    }
}
