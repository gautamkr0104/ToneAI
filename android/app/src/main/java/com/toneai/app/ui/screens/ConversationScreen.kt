package com.toneai.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.toneai.app.data.remote.DraftDto
import com.toneai.app.data.remote.MessageDto
import com.toneai.app.data.remote.throwableMessage
import com.toneai.app.data.repo.ToneRepository
import com.toneai.app.ui.common.ErrorView
import com.toneai.app.ui.common.LoadingView
import com.toneai.app.ui.common.OfflineBanner
import com.toneai.app.ui.common.QuickChipsRow
import com.toneai.app.ui.toneVmFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Conversation screen ViewModel: loads messages, generates/rewrites AI drafts,
 * and sends ONLY on explicit user approval.
 */
class ConversationViewModel(private val repo: ToneRepository) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val sending: Boolean = false,
        val generating: Boolean = false,
        val offline: Boolean = false,
        val error: String? = null,
        val draft: DraftDto? = null,
        val lastActionError: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    fun observeMessages(conversationId: String) = repo.observeMessages(conversationId)

    fun refresh(conversationId: String) {
        viewModelScope.launch {
            runCatching { repo.refreshMessages(conversationId) }
                .onSuccess { _state.value = _state.value.copy(loading = false, offline = false) }
                .onFailure { t ->
                    _state.value = _state.value.copy(
                        loading = false,
                        offline = t is java.io.IOException,
                        error = throwableMessage(t),
                    )
                }
        }
    }

    fun generate(conversationId: String, replyMode: String = "normal", customInstruction: String? = null) {
        viewModelScope.launch {
            _state.value = _state.value.copy(generating = true, lastActionError = null)
            runCatching { repo.generate(conversationId, replyMode, customInstruction) }
                .onSuccess { _state.value = _state.value.copy(generating = false, draft = it) }
                .onFailure { t ->
                    _state.value = _state.value.copy(
                        generating = false,
                        lastActionError = throwableMessage(t),
                        offline = t is java.io.IOException,
                    )
                }
        }
    }

    fun regenerate(conversationId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(generating = true, lastActionError = null)
            runCatching { repo.regenerate(conversationId, "normal", null) }
                .onSuccess { _state.value = _state.value.copy(generating = false, draft = it) }
                .onFailure { t -> _state.value = _state.value.copy(generating = false, lastActionError = throwableMessage(t)) }
        }
    }

    fun rewrite(conversationId: String, action: String, customInstruction: String? = null) {
        val draft = _state.value.draft ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(generating = true, lastActionError = null)
            runCatching { repo.rewrite(conversationId, draft.generationId, action, customInstruction) }
                .onSuccess { _state.value = _state.value.copy(generating = false, draft = it) }
                .onFailure { t -> _state.value = _state.value.copy(generating = false, lastActionError = throwableMessage(t)) }
        }
    }

    /** Called ONLY from the Approve & Send button. */
    fun sendApproved(conversationId: String, text: String, edited: Boolean, onSent: () -> Unit) {
        val draft = _state.value.draft
        viewModelScope.launch {
            _state.value = _state.value.copy(sending = true, lastActionError = null)
            runCatching { repo.send(conversationId, text, draft?.generationId, edited) }
                .onSuccess { res ->
                    if (res.ok) {
                        _state.value = _state.value.copy(sending = false, draft = null)
                        onSent()
                    } else {
                        _state.value = _state.value.copy(sending = false, lastActionError = res.messageId ?: "Send failed")
                    }
                }
                .onFailure { t -> _state.value = _state.value.copy(sending = false, lastActionError = throwableMessage(t)) }
        }
    }
}

@Composable
fun ConversationScreen(
    conversationId: String,
    participantName: String,
) {
    val vm: ConversationViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = toneVmFactory(LocalContext.current))
    val state by vm.state.collectAsState()
    val messages by vm.observeMessages(conversationId).collectAsState(initial = emptyList<com.toneai.app.data.local.MessageEntity>())
    var draftText by rememberSaveable(state.draft?.generationId) { mutableStateOf(state.draft?.reply ?: "") }
    var customInstruction by rememberSaveable { mutableStateOf("") }

    androidx.compose.runtime.LaunchedEffect(conversationId) {
        vm.refresh(conversationId)
        vm.generate(conversationId)
    }
    // Keep editor text in sync when a new draft arrives (unless user edited it).
    androidx.compose.runtime.LaunchedEffect(state.draft?.generationId) {
        state.draft?.let { draftText = it.reply }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            participantName,
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(16.dp),
        )
        OfflineBanner(visible = state.offline)

        LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
            items(messages, key = { it.id }) { m ->
                val isMe = m.sender == "me"
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = if (isMe) Arrangement.End else Arrangement.Start,
                ) {
                    Surface(
                        color = if (isMe) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Text(
                            m.text,
                            modifier = Modifier.widthIn(max = 280.dp).padding(10.dp),
                            color = if (isMe) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }

        // ---- AI draft editor ----
        Card(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
            Column(Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("AI draft", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    if (state.draft?.autoSent == true) {
                        Text(
                            "TURBO — already sent",
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else if (state.draft?.sensitive == true) {
                        Text(
                            "SENSITIVE — review before sending",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
                Text(
                    "AI drafts require your approval. Nothing is sent automatically.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = draftText,
                    onValueChange = { draftText = it },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
                state.lastActionError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(8.dp))
                QuickChipsRow(
                    chips = listOf(
                        "SHORTER" to { vm.rewrite(conversationId, "shorter") },
                        "FUNNIER" to { vm.rewrite(conversationId, "funnier") },
                        "CASUAL" to { vm.rewrite(conversationId, "more_casual") },
                        "MATCH TONE" to { vm.rewrite(conversationId, "more_natural") },
                    ),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = customInstruction,
                    onValueChange = { customInstruction = it },
                    label = { Text("Custom instruction (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { vm.rewrite(conversationId, "", customInstruction.ifBlank { null }) },
                        enabled = !state.generating && draftText.isNotBlank(),
                    ) { Text("Apply") }
                    OutlinedButton(onClick = { vm.regenerate(conversationId) }, enabled = !state.generating) {
                        Text("Regenerate")
                    }
                    Button(
                        onClick = {
                            val edited = state.draft?.reply != draftText
                            vm.sendApproved(conversationId, draftText, edited) {}
                        },
                        enabled = !state.sending && draftText.isNotBlank(),
                    ) { Text("Approve & send") }
                }
            }
        }
    }
}
