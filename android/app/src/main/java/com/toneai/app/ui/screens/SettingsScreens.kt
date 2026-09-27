package com.toneai.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.toneai.app.data.remote.DiagnosticsDto
import com.toneai.app.data.remote.SettingsDto
import com.toneai.app.data.remote.TurboSettingsDto
import com.toneai.app.data.remote.UsageSummary
import com.toneai.app.data.remote.throwableMessage
import com.toneai.app.data.repo.ToneRepository
import com.toneai.app.ui.toneVmFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * One ViewModel backing the settings hub and its sub-panels (notifications,
 * usage, privacy, security, diagnostics) to keep the screen count manageable
 * without losing the required functionality.
 */
class SettingsViewModel(private val repo: ToneRepository) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val settings: SettingsDto? = null,
        val usage: UsageSummary? = null,
        val diagnostics: DiagnosticsDto? = null,
        val turbo: TurboSettingsDto? = null,
        val error: String? = null,
        val message: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching {
                val settings = repo.apiService.settings().settings
                val usage = runCatching { repo.apiService.usage().usage }.getOrNull()
                val turbo = runCatching { repo.apiService.turbo().turbo }.getOrNull()
                SettingsViewModelData(settings, usage, turbo)
            }
                .onSuccess {
                    _state.value = UiState(loading = false, settings = it.settings, usage = it.usage, turbo = it.turbo)
                }
                .onFailure { _state.value = UiState(loading = false, error = throwableMessage(it)) }
        }
    }

    fun setNotificationMode(mode: String) {
        viewModelScope.launch {
            runCatching { repo.apiService.updateSettings(com.toneai.app.data.remote.SettingsPatch(notificationMode = mode)) }
                .onSuccess { refresh() }
                .onFailure { _state.value = _state.value.copy(error = throwableMessage(it)) }
        }
    }

    fun setNewDmEnabled(enabled: Boolean) {
        viewModelScope.launch {
            runCatching { repo.apiService.updateSettings(com.toneai.app.data.remote.SettingsPatch(newDmEnabled = enabled)) }
                .onSuccess { refresh() }
        }
    }

    fun privacy(action: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(message = null, error = null)
            val result = runCatching {
                when (action) {
                    "conversations" -> repo.apiService.privacyDeleteConversations()
                    "style_examples" -> repo.apiService.privacyDeleteStyleExamples()
                    "memories" -> repo.apiService.privacyDeleteMemories()
                    "reset_tone" -> repo.apiService.privacyResetToneProfile()
                    "disable_learning" -> repo.apiService.privacyDisableLearning()
                    "disable_memory" -> repo.apiService.privacyDisableMemory()
                    else -> throw IllegalArgumentException("unknown action")
                }
            }
            result
                .onSuccess { _state.value = _state.value.copy(message = "Done ✓") }
                .onFailure { _state.value = _state.value.copy(error = throwableMessage(it)) }
        }
    }

    fun loadDiagnostics() {
        viewModelScope.launch {
            runCatching { repo.apiService.diagnostics() }
                .onSuccess { _state.value = _state.value.copy(diagnostics = it.diagnostics, error = null) }
                .onFailure { _state.value = _state.value.copy(error = throwableMessage(it)) }
        }
    }

    /** Turbo on requires the exact server-side acknowledgement string. */
    fun setTurbo(enabled: Boolean) {
        viewModelScope.launch {
            _state.value = _state.value.copy(error = null, message = null)
            runCatching {
                repo.apiService.setTurbo(
                    com.toneai.app.data.remote.TurboUpdateRequest(
                        enabled = enabled,
                        acknowledgement = if (enabled) "I_UNDERSTAND" else null,
                    ),
                )
            }
                .onSuccess {
                    _state.value = _state.value.copy(
                        turbo = it.turbo,
                        message = if (enabled) "Turbo mode ON — AI replies send without asking" else "Turbo mode off",
                    )
                }
                .onFailure { _state.value = _state.value.copy(error = throwableMessage(it)) }
        }
    }
}

private data class SettingsViewModelData(
    val settings: SettingsDto,
    val usage: UsageSummary?,
    val turbo: TurboSettingsDto?,
)

@Composable
fun SettingsScreen(onLogout: () -> Unit) {
    val vm: SettingsViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = toneVmFactory(LocalContext.current))
    val state by vm.state.collectAsState()
    var showTurboDialog by remember { mutableStateOf(false) }

    if (showTurboDialog) {
        TurboConfirmDialog(
            onConfirm = {
                vm.setTurbo(true)
                showTurboDialog = false
            },
            onDismiss = { showTurboDialog = false },
        )
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.titleLarge)
        state.message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(12.dp))

        // ---- Turbo mode ----
        Section("Turbo mode") {
            val turbo = state.turbo
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("Send AI replies without asking")
                    Text(
                        if (turbo?.turboMode == true)
                            "ON — replies on 'automatic' conversations are sent instantly. Sensitive drafts are still held."
                        else
                            "OFF — every AI reply waits for your approval (default).",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Switch(
                    checked = turbo?.turboMode == true,
                    onCheckedChange = { wantOn ->
                        if (wantOn) showTurboDialog = true else vm.setTurbo(false)
                    },
                )
            }
        }

        // ---- Notifications ----
        Section("Notifications") {
            state.settings?.let { s ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text("Notify on new DMs", Modifier.weight(1f))
                    Switch(checked = s.newDmEnabled, onCheckedChange = { vm.setNewDmEnabled(it) })
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text("Mode: ${s.notificationMode}", Modifier.weight(1f))
                    OutlinedButton(onClick = { vm.setNotificationMode("ai_drafts_only") }) { Text("AI drafts only") }
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text("FCM token registered", Modifier.weight(1f))
                    Text(if (s.hasFcmToken) "yes" else "no")
                }
            }
        }

        // ---- Usage ----
        Section("Usage") {
            state.usage?.let { u ->
                Text("Today: ${u.today.generations} generations, ${u.today.promptTokens + u.today.completionTokens} tokens")
                Text("Limits: ${u.today.generationLimit} generations/day, ${u.today.tokenLimit} tokens/day")
                Text("This month: ${u.month.totalGenerations} generations, ${u.month.totalTokens} tokens")
            } ?: Text("Usage unavailable offline")
        }

        // ---- Privacy ----
        Section("Privacy — delete my data") {
            Row {
                OutlinedButton(onClick = { vm.privacy("conversations") }) { Text("Delete conversations") }
                OutlinedButton(onClick = { vm.privacy("memories") }, modifier = Modifier.padding(start = 8.dp)) { Text("Delete memories") }
            }
            Row(modifier = Modifier.padding(top = 8.dp)) {
                OutlinedButton(onClick = { vm.privacy("style_examples") }) { Text("Delete style examples") }
                OutlinedButton(onClick = { vm.privacy("reset_tone") }, modifier = Modifier.padding(start = 8.dp)) { Text("Reset tone profile") }
            }
            Row(modifier = Modifier.padding(top = 8.dp)) {
                OutlinedButton(onClick = { vm.privacy("disable_learning") }) { Text("Disable learning") }
                OutlinedButton(onClick = { vm.privacy("disable_memory") }, modifier = Modifier.padding(start = 8.dp)) { Text("Disable memory") }
            }
        }

        // ---- Security ----
        Section("Security") {
            Text("• AI drafts always require approval before sending")
            Text("• Sensitive drafts (money, health, legal, threats) are never auto-sent")
            Text("• Instagram is connected via official OAuth — your password is never stored")
            Text("• Logout revokes this session's tokens")
        }

        // ---- Developer diagnostics ----
        Section("Developer diagnostics") {
            OutlinedButton(onClick = { vm.loadDiagnostics() }) { Text("Run diagnostics") }
            state.diagnostics?.let { d ->
                Text("AI provider: ${d.aiProvider} (configured: ${d.aiConfigured})")
                Text("DB: ${d.dbConnected} (${d.dbLatencyMs} ms)")
                Text("Instagram OAuth configured: ${d.instagramOAuthConfigured}")
                Text("Sessions: ${d.activeSessions}, notifications: ${d.notificationProvider}")
            }
        }

        Spacer(Modifier.height(16.dp))
        Button(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text("Log out") }
        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun Section(title: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun TurboConfirmDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Enable Turbo mode?") },
        text = {
            Text(
                "AI replies will be SENT AUTOMATICALLY without your approval on conversations " +
                    "set to 'automatic'.\n\nStill protected: sensitive content (money, health, legal, " +
                    "threats), unknown senders, and questions needing facts you never shared are " +
                    "always held as drafts.\n\nYou can turn this off anytime.",
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("I understand, enable") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
