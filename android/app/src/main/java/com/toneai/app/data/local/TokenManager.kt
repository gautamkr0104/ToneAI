package com.toneai.app.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "toneai_auth")

/**
 * Stores the access/refresh tokens and the logged-in user id.
 * Access tokens live in DataStore (private app storage). No Instagram
 * passwords are ever stored — Instagram auth is OAuth-only on the backend.
 */
class TokenManager(private val context: Context) {

    private val accessKey = stringPreferencesKey("access_token")
    private val refreshKey = stringPreferencesKey("refresh_token")
    private val userIdKey = stringPreferencesKey("user_id")

    val accessToken: Flow<String?> = context.dataStore.data.map { it[accessKey] }
    val refreshToken: Flow<String?> = context.dataStore.data.map { it[refreshKey] }
    val userId: Flow<String?> = context.dataStore.data.map { it[userIdKey] }

    suspend fun tokens(): Pair<String?, String?> {
        val prefs = context.dataStore.data.first()
        return prefs[accessKey] to prefs[refreshKey]
    }

    suspend fun save(access: String, refresh: String, userId: String? = null) {
        context.dataStore.edit { p ->
            p[accessKey] = access
            p[refreshKey] = refresh
            if (userId != null) p[userIdKey] = userId
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
