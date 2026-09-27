package com.toneai.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.toneai.app.ToneAIApp
import com.toneai.app.data.repo.ToneRepository

/**
 * Simple factory that hands ViewModels the app repository. Used from
 * composables via `viewModel(factory = toneVmFactory())`.
 */
class ToneVmFactory(private val repo: ToneRepository) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when (modelClass) {
        com.toneai.app.ui.screens.AuthViewModel::class.java -> com.toneai.app.ui.screens.AuthViewModel(repo) as T
        com.toneai.app.ui.screens.HomeViewModel::class.java -> com.toneai.app.ui.screens.HomeViewModel(repo) as T
        com.toneai.app.ui.screens.InboxViewModel::class.java -> com.toneai.app.ui.screens.InboxViewModel(repo) as T
        com.toneai.app.ui.screens.ConversationViewModel::class.java -> com.toneai.app.ui.screens.ConversationViewModel(repo) as T
        com.toneai.app.ui.screens.ToneProfileViewModel::class.java -> com.toneai.app.ui.screens.ToneProfileViewModel(repo) as T
        com.toneai.app.ui.screens.SettingsViewModel::class.java -> com.toneai.app.ui.screens.SettingsViewModel(repo) as T
        else -> throw IllegalArgumentException("Unknown ViewModel ${modelClass.name}")
    }
}

@Suppress("FunctionName")
fun toneVmFactory(app: android.content.Context): ToneVmFactory {
    val application = app.applicationContext as ToneAIApp
    return ToneVmFactory(application.repository)
}
