package com.toneai.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.toneai.app.data.remote.ImportChatsResponse
import com.toneai.app.data.remote.ImportStatusResponse
import com.toneai.app.data.remote.StyleExampleDto
import com.toneai.app.data.remote.ToneProfileDto
import com.toneai.app.data.remote.throwableMessage
import com.toneai.app.data.repo.ToneRepository
import com.toneai.app.ui.common.ErrorView
import com.toneai.app.ui.common.LoadingView
import com.toneai.app.ui.toneVmFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

// ---------------- Tone profile ----------------

class ToneProfileViewModel(private val repo: ToneRepository) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val profile: ToneProfileDto? = null,
        val saving: Boolean = false,
        val error: String? = null,
        val saved: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            runCatching { repo.apiService.toneProfile() }
                .onSuccess { _state.value = UiState(loading = false, profile = it.toneProfile) }
                .onFailure { _state.value = UiState(loading = false, error = throwableMessage(it)) }
        }
    }

    fun save(profile: ToneProfileDto) {
        viewModelScope.launch {
            _state.value = _state.value.copy(saving = true, saved = false)
            runCatching { repo.apiService.updateToneProfile(profile) }
                .onSuccess { _state.value = _state.value.copy(saving = false, saved = true, profile = it.toneProfile) }
                .onFailure { _state.value = _state.value.copy(saving = false, error = throwableMessage(it)) }
        }
    }
}

@Composable
fun ToneProfileScreen() {
    val vm: ToneProfileViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = toneVmFactory(LocalContext.current))
    val state by vm.state.collectAsState()
    val profile = state.profile ?: return LoadingView()

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Tone profile", style = MaterialTheme.typography.titleLarge)
        Text(
            "ToneAI learns from these signals — they shape every generated draft.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(12.dp))
        ImportChatsCard()
        LazyColumn(Modifier.weight(1f)) {
            item {
                Card {
                    Column(Modifier.padding(12.dp)) {
                        Text("Formality: ${profile.formality}/100")
                        Slider(
                            value = profile.formality.toFloat(),
                            onValueChange = { vm.save(profile.copy(formality = it.toInt())) },
                            valueRange = 0f..100f,
                        )
                        Text("Emoji frequency: ${"%.2f".format(profile.emojiFrequency)}")
                        Slider(
                            value = profile.emojiFrequency,
                            onValueChange = { vm.save(profile.copy(emojiFrequency = it)) },
                            valueRange = 0f..1f,
                        )
                        Text("Humor: ${profile.humorLevel}/100")
                        Slider(
                            value = profile.humorLevel.toFloat(),
                            onValueChange = { vm.save(profile.copy(humorLevel = it.toInt())) },
                            valueRange = 0f..100f,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Learning enabled", Modifier.weight(1f))
                            Switch(
                                checked = profile.learningEnabled,
                                onCheckedChange = { vm.save(profile.copy(learningEnabled = it)) },
                            )
                        }
                        state.saved.let {
                            if (it) Text("Saved ✓", color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick = { vm.load() }) { Text("Reload") }
            }
        }
    }
}

// ---------------- Instagram chat import ----------------

/**
 * Lets the user drop their Instagram "Download your information" JSON export
 * into ToneAI. The file is read on IO, parsed, and uploaded to the user's OWN
 * backend, which learns their tone (no third parties involved).
 */
class ImportChatsViewModel(private val repo: ToneRepository) : ViewModel() {
    data class UiState(
        val importing: Boolean = false,
        val result: ImportChatsResponse? = null,
        val error: String? = null,
        val status: ImportStatusResponse? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        loadStatus()
    }

    fun loadStatus() {
        viewModelScope.launch {
            runCatching { repo.importStatus() }
                .onSuccess { _state.value = _state.value.copy(status = it) }
        }
    }

    fun importFromUri(uri: android.net.Uri, context: android.content.Context, accountHint: String?) {
        viewModelScope.launch {
            _state.value = _state.value.copy(importing = true, error = null, result = null)
            try {
                // 1. Read + parse the export file off the main thread.
                val element: JsonElement = withContext(Dispatchers.IO) {
                    val text = context.contentResolver.openInputStream(uri)
                        ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                        ?: throw IllegalStateException("Could not read the selected file")
                    // IG exports may be a JSON array (several message_N.json files
                    // concatenated by the user) or a single object.
                    @Suppress("OPT_IN_USAGE")
                    Json.parseToJsonElement(text)
                }
                // 2. Send to our backend for learning.
                val res = repo.importChats(element, accountHint?.ifBlank { null })
                _state.value = UiState(importing = false, result = res)
                loadStatus()
            } catch (t: Throwable) {
                _state.value = _state.value.copy(importing = false, error = throwableMessage(t))
            }
        }
    }
}

@Composable
fun ImportChatsCard(modifier: Modifier = Modifier) {
    val vm: ImportChatsViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = toneVmFactory(LocalContext.current))
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    var accountHint by rememberSaveable { mutableStateOf("") }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) vm.importFromUri(uri, context, accountHint)
    }

    Card(modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text("Learn from your Instagram chats", style = MaterialTheme.typography.titleMedium)
            Text(
                "1. Instagram app → Settings → Your activity → Download your information → request JSON.\n" +
                    "2. Come back here and pick the message .json file (or a merged .json of several).\n" +
                    "ToneAI reads your own messages and learns your tone. Nothing is sent anywhere else.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = accountHint,
                onValueChange = { accountHint = it },
                label = { Text("Your Instagram username (optional, improves detection)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { filePicker.launch(arrayOf("application/json", "text/plain", "*/*")) },
                    enabled = !state.importing,
                ) {
                    Text("Pick Instagram export file")
                }
                if (state.importing) {
                    CircularProgressIndicator(Modifier.padding(start = 12.dp).height(18.dp))
                }
            }
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            state.result?.let { r ->
                Spacer(Modifier.height(8.dp))
                Text(
                    "Learned from ${r.myMessages} of your messages across ${r.conversations} chats ✓",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium,
                )
                r.learned?.let { s ->
                    Text(
                        "avg ${s.avgMessageLength} chars • emojis ${"%.0f%%".format(s.emojiFrequency * 100)} • " +
                            "${s.capitalization} • languages ${s.languages.joinToString("/")}" +
                            (if (s.commonSlang.isNotEmpty()) " • slang: ${s.commonSlang.take(5).joinToString(", ")}" else ""),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        "${r.styleExamplesCreated} style examples saved — every future AI reply now sounds more like you.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            state.status?.let { st ->
                if (st.importedExamples > 0) {
                    Text(
                        "Total imported examples so far: ${st.importedExamples}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

// ---------------- Style examples ----------------

class StyleExamplesViewModel(private val repo: ToneRepository) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val examples: List<StyleExampleDto> = emptyList(),
        val error: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            runCatching { repo.apiService.styleExamples() }
                .onSuccess { _state.value = UiState(loading = false, examples = it.examples) }
                .onFailure { _state.value = UiState(loading = false, error = throwableMessage(it)) }
        }
    }

    fun add(text: String) {
        viewModelScope.launch {
            runCatching { repo.apiService.addStyleExample(com.toneai.app.data.remote.StyleExampleCreate(text)) }
                .onSuccess { load() }
                .onFailure { _state.value = _state.value.copy(error = throwableMessage(it)) }
        }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            runCatching { repo.apiService.deleteStyleExample(id) }.onSuccess { load() }
        }
    }
}

@Composable
fun StyleExamplesScreen() {
    val vm: StyleExamplesViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = toneVmFactory(LocalContext.current))
    val state by vm.state.collectAsState()
    var newText by rememberSaveable { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Style examples", style = MaterialTheme.typography.titleLarge)
        Text("Paste messages you would actually send. They teach ToneAI your voice.", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(12.dp))
        Row {
            OutlinedTextField(
                value = newText,
                onValueChange = { newText = it },
                modifier = Modifier.weight(1f),
                label = { Text("e.g. yeah bro idk 😭") },
                singleLine = true,
            )
            Button(
                onClick = { vm.add(newText); newText = "" },
                enabled = newText.isNotBlank(),
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("Add") }
        }
        Spacer(Modifier.height(12.dp))
        when {
            state.loading -> LoadingView()
            state.examples.isEmpty() -> ErrorView("No examples yet. Add a few to teach the model your tone.")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(state.examples, key = { it.id }) { ex ->
                    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(ex.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            OutlinedButton(onClick = { vm.delete(ex.id) }) { Text("Delete") }
                        }
                    }
                }
            }
        }
    }
}
