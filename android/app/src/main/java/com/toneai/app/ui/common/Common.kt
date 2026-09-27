package com.toneai.app.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Full-screen centered loader. */
@Composable
fun LoadingView(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

/** Full-screen error/empty state with retry. */
@Composable
fun ErrorView(message: String, modifier: Modifier = Modifier, retryLabel: String? = "Retry", onRetry: (() -> Unit)? = null) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (onRetry != null && retryLabel != null) {
            androidx.compose.material3.Button(onClick = onRetry, modifier = Modifier.padding(top = 16.dp)) {
                Text(retryLabel)
            }
        }
    }
}

/** Persistent offline banner shown above content when the last refresh failed. */
@Composable
fun OfflineBanner(visible: Boolean, modifier: Modifier = Modifier) {
    if (!visible) return
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer,
    ) {
        Text(
            "Offline — showing cached data. Messages are not sent until the server confirms.",
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

/** Row of quick rewrite chips used in the AI draft editor. */
@Composable
fun QuickChipsRow(
    chips: List<Pair<String, () -> Unit>>,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        chips.forEach { (label, action) ->
            AssistChip(onClick = action, label = { Text(label) })
        }
    }
}
