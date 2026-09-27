package com.toneai.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.toneai.app.data.repo.ToneRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Root session state: loading → loggedOut / loggedIn. */
sealed interface SessionState {
    data object Loading : SessionState
    data object LoggedOut : SessionState
    data object LoggedIn : SessionState
}

/**
 * AppViewModel owns the global session. Restores the session from stored
 * tokens on start (silent refresh handled by the OkHttp interceptor).
 */
class AppViewModel(private val repo: ToneRepository) : ViewModel() {

    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state

    init {
        viewModelScope.launch {
            _state.value = if (repo.isLoggedIn()) SessionState.LoggedIn else SessionState.LoggedOut
        }
    }

    fun onLoginSuccess() {
        _state.value = SessionState.LoggedIn
    }

    fun onLogout() {
        _state.value = SessionState.LoggedOut
    }
}
