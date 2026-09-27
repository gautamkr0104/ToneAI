package com.toneai.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.toneai.app.data.remote.ApiException
import com.toneai.app.data.remote.IgAccountDto
import com.toneai.app.data.remote.throwableMessage
import com.toneai.app.data.repo.ToneRepository
import com.toneai.app.ui.common.ErrorView
import com.toneai.app.ui.common.LoadingView
import com.toneai.app.ui.common.OfflineBanner
import com.toneai.app.ui.toneVmFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

// ---------------- Home (Instagram accounts) ----------------

class HomeViewModel(private val repo: ToneRepository) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val accounts: List<IgAccountDto> = emptyList(),
        val oauthConfigured: Boolean = false,
        val offline: Boolean = false,
        val error: String? = null,
        val connecting: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = _state.value.accounts.isEmpty(), error = null)
            runCatching { repo.accounts() }
                .onSuccess { res ->
                    _state.value = UiState(loading = false, accounts = res.accounts, oauthConfigured = res.oauthConfigured)
                }
                .onFailure { t ->
                    _state.value = _state.value.copy(
                        loading = false,
                        offline = t is java.io.IOException,
                        error = throwableMessage(t),
                    )
                }
        }
    }

    fun connectMock(username: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(connecting = true, error = null)
            runCatching { repo.connectMock(username) }
                .onSuccess { refresh() }
                .onFailure { _state.value = _state.value.copy(connecting = false, error = throwableMessage(it)) }
        }
    }

    fun disconnect(accountId: String) {
        viewModelScope.launch {
            runCatching { repo.disconnect(accountId) }.onSuccess { refresh() }
        }
    }
}

@Composable
fun HomeScreen(
    onOpenAccount: (IgAccountDto) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val vm: HomeViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = toneVmFactory(LocalContext.current))
    val state by vm.state.collectAsState()
    var newUsername by rememberSaveable { mutableStateOf("") }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Your Instagram accounts", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            OutlinedButton(onClick = onOpenSettings) { Text("Settings") }
        }
        OfflineBanner(visible = state.offline)
        when {
            state.loading -> LoadingView()
            state.error != null && state.accounts.isEmpty() -> ErrorView(state.error!!, onRetry = { vm.refresh() })
            else -> {
                LazyColumn(modifier = Modifier.weight(1f)) {
                    items(state.accounts, key = { it.id }) { account ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp)
                                .clickable { onOpenAccount(account) },
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        "@${account.username}",
                                        modifier = Modifier.weight(1f),
                                        style = MaterialTheme.typography.titleMedium,
                                    )
                                    if (account.provider == "mock") {
                                        Badge { Text("MOCK") }
                                    }
                                }
                                Text(
                                    "Status: ${account.status}" + (account.lastSyncAt?.let { " • synced $it" } ?: ""),
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Row(Modifier.padding(top = 8.dp)) {
                                    OutlinedButton(onClick = { vm.disconnect(account.id) }) { Text("Disconnect") }
                                }
                            }
                        }
                    }
                }
                Column(Modifier.padding(top = 8.dp)) {
                    OutlinedTextField(
                        value = newUsername,
                        onValueChange = { newUsername = it },
                        label = { Text("Instagram username for demo account") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { vm.connectMock(newUsername.ifBlank { "demo_user" }) },
                            enabled = !state.connecting,
                        ) { Text("Connect demo account") }
                        OutlinedButton(onClick = { vm.refresh() }) { Text("Refresh") }
                    }
                    Text(
                        "Real connections use official Meta OAuth only. Mock accounts are labeled MOCK.",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

// ---------------- Inbox ----------------

class InboxViewModel(private val repo: ToneRepository) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val offline: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    /** Cached conversations observed by the screen (offline-first). */
    val conversations = kotlinx.coroutines.flow.emptyFlow<List<com.toneai.app.data.local.ConversationEntity>>()

    fun observe(accountId: String): kotlinx.coroutines.flow.Flow<List<com.toneai.app.data.local.ConversationEntity>> =
        repo.observeConversations(accountId)

    fun refresh(accountId: String) {
        viewModelScope.launch {
            _state.value = UiState(loading = _state.value.loading, offline = false)
            runCatching { repo.refreshConversations(accountId) }
                .onSuccess { _state.value = UiState(loading = false) }
                .onFailure { t ->
                    _state.value = UiState(
                        loading = false,
                        offline = t is java.io.IOException,
                        error = throwableMessage(t),
                    )
                }
        }
    }

    fun sync(accountId: String, onDone: () -> Unit) {
        viewModelScope.launch {
            runCatching { repo.sync(accountId) }
                .onSuccess {
                    runCatching { repo.refreshConversations(accountId) }
                    onDone()
                }
        }
    }
}

@Composable
fun InboxScreen(
    account: IgAccountDto,
    onOpenConversation: (String, String) -> Unit,
) {
    val vm: InboxViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = toneVmFactory(LocalContext.current))
    val state by vm.state.collectAsState()
    val conversations by vm.observe(account.id).collectAsState(initial = emptyList())

    androidx.compose.runtime.LaunchedEffect(account.id) {
        vm.sync(account.id) {}
        vm.refresh(account.id)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("DMs — @${account.username}", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            OutlinedButton(onClick = { vm.sync(account.id) {} }) { Text("Sync") }
        }
        OfflineBanner(visible = state.offline)
        when {
            state.loading && conversations.isEmpty() -> LoadingView()
            conversations.isEmpty() -> ErrorView("No conversations yet. Tap Sync to load DMs.")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(conversations, key = { it.id }) { conv ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                            .clickable { onOpenConversation(conv.id, conv.participantName) },
                    ) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(conv.participantName, style = MaterialTheme.typography.titleMedium)
                                    Spacer(Modifier.width(8.dp))
                                    if (conv.hasAiDraft) {
                                        Badge { Text("AI draft") }
                                    }
                                }
                                Text(
                                    conv.lastMessagePreview ?: "",
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            if (conv.unreadCount > 0) {
                                Badge { Text(conv.unreadCount.toString()) }
                            }
                        }
                    }
                }
            }
        }
    }
}
