package com.hereliesaz.admin

import org.junit.Assert.assertEquals
import org.junit.Test

class SanitizeTest {
    @Test fun sanitizesFilenameAndPreservesExtension() {
        assertEquals(SanitizedFile("my_bad_name", "my_bad_name.HEIC"), sanitizeIdAndFilename("my,bad name.HEIC"))
    }
    @Test fun sanitizesPunctuation() {
        assertEquals(SanitizedFile("___", "___.jpg"), sanitizeIdAndFilename("???.jpg"))
    }
}
