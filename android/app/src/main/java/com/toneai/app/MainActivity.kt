package com.toneai.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.toneai.app.data.remote.IgAccountDto
import com.toneai.app.ui.AppViewModel
import com.toneai.app.ui.SessionState
import com.toneai.app.ui.common.ErrorView
import com.toneai.app.ui.common.LoadingView
import com.toneai.app.ui.screens.ConversationScreen
import com.toneai.app.ui.screens.HomeScreen
import com.toneai.app.ui.screens.InboxScreen
import com.toneai.app.ui.screens.LoginScreen
import com.toneai.app.ui.screens.RegisterScreen
import com.toneai.app.ui.screens.SettingsScreen
import com.toneai.app.ui.screens.StyleExamplesScreen
import com.toneai.app.ui.screens.ToneProfileScreen
import com.toneai.app.ui.theme.ToneTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Single-activity Compose app. Navigation:
 * session splash → auth flow → home → inbox → conversation,
 * plus tone/style/settings panels.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ToneTheme {
                ToneApp()
            }
        }
    }
}

@Composable
fun ToneApp() {
    val app = LocalContext.current.applicationContext as ToneAIApp
    val appVm = remember { AppViewModel(app.repository) }
    val session by appVm.state.collectAsState()

    when (session) {
        SessionState.Loading -> LoadingView()
        SessionState.LoggedOut -> AuthFlow(appVm)
        SessionState.LoggedIn -> MainFlow(onLogout = { scope.launch { app.repository.logout(); appVm.onLogout() } })
    }
}

private val scope = CoroutineScope(Dispatchers.Main)

@Composable
private fun AuthFlow(appVm: AppViewModel) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = "login") {
        composable("login") {
            LoginScreen(
                onLoginSuccess = { appVm.onLoginSuccess() },
                onGoToRegister = { nav.navigate("register") },
            )
        }
        composable("register") {
            RegisterScreen(
                onRegisterSuccess = { appVm.onLoginSuccess() },
                onBackToLogin = { nav.popBackStack() },
            )
        }
    }
}

@Composable
private fun MainFlow(onLogout: () -> Unit) {
    val nav = rememberNavController()
    var selectedAccount by remember { mutableStateOf<IgAccountDto?>(null) }
    var selectedConversationId by remember { mutableStateOf("") }
    var selectedParticipant by remember { mutableStateOf("") }

    NavHost(nav, startDestination = "home") {
        composable("home") {
            HomeScreen(
                onOpenAccount = { account ->
                    selectedAccount = account
                    nav.navigate("inbox")
                },
                onOpenSettings = { nav.navigate("settings") },
            )
        }
        composable("inbox") {
            val account = selectedAccount
            if (account == null) {
                ErrorView("No account selected", retryLabel = "Back", onRetry = { nav.popBackStack() })
            } else {
                InboxScreen(
                    account = account,
                    onOpenConversation = { id, name ->
                        selectedConversationId = id
                        selectedParticipant = name
                        nav.navigate("conversation")
                    },
                )
            }
        }
        composable("conversation") {
            ConversationScreen(
                conversationId = selectedConversationId,
                participantName = selectedParticipant,
            )
        }
        composable("settings") {
            SettingsScreen(onLogout = onLogout)
        }
        composable("tone") { ToneProfileScreen() }
        composable("style") { StyleExamplesScreen() }
    }
}
