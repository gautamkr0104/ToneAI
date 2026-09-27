package com.toneai.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-Kotlin tests of the approval + sensitivity guardrail logic that the
 * conversation screen applies before any send. Mirrors backend guardrails:
 * drafts always require approval; sensitive drafts must be edited first.
 */
class DraftLogicTest {

    // Mirrors ConversationScreen's `edited` computation.
    private fun isEdited(original: String?, current: String): Boolean = original != current

    // Mirrors the backend + UI rule: sensitive drafts require review/edit.
    private fun canSend(draftReply: String?, currentText: String, sensitive: Boolean, explicitlyApproved: Boolean): Boolean {
        if (!explicitlyApproved) return false // never auto-send
        if (draftReply == null) return currentText.isNotBlank()
        if (sensitive && !isEdited(draftReply, currentText)) return false
        return currentText.isNotBlank()
    }

    @Test
    fun `edited detection works`() {
        assertTrue(isEdited("hey", "hey there"))
        assertFalse(isEdited("hey", "hey"))
    }

    @Test
    fun `never sends without explicit approval`() {
        assertFalse(canSend("hey", "hey", sensitive = false, explicitlyApproved = false))
    }

    @Test
    fun `normal draft sends after approval`() {
        assertTrue(canSend("lol true", "lol true", sensitive = false, explicitlyApproved = true))
    }

    @Test
    fun `sensitive unedited draft is blocked`() {
        assertFalse(canSend("bank details", "bank details", sensitive = true, explicitlyApproved = true))
    }

    @Test
    fun `sensitive draft allowed after user edit`() {
        assertTrue(canSend("bank details", "here are my bank details", sensitive = true, explicitlyApproved = true))
    }

    @Test
    fun `blank text never sends`() {
        assertFalse(canSend(null, "", sensitive = false, explicitlyApproved = true))
    }
}
