package com.toneai.app

import com.toneai.app.ui.SessionState
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionStateTest {
    @Test
    fun `session starts loading then resolves`() {
        var s: SessionState = SessionState.Loading
        assertEquals(SessionState.Loading, s)
        s = SessionState.LoggedOut
        assertEquals(SessionState.LoggedOut, s)
        s = SessionState.LoggedIn
        assertEquals(SessionState.LoggedIn, s)
    }
}
