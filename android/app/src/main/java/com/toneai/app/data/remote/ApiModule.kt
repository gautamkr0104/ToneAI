package com.toneai.app.data.remote

import com.toneai.app.data.local.TokenManager
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** Transport-level errors surfaced to the UI layer as friendly messages. */
class ApiException(val code: Int, message: String) : Exception(message) {
    val isAuthError = code == 401
    val isQuota = code == 429
}

/**
 * Builds the Retrofit + OkHttp stack. Attaches the Bearer token and refreshes
 * it once on 401 before giving up.
 */
class ApiModule(private val tokenManager: TokenManager, baseUrl: String, debugLogging: Boolean = false) {

    val api: ToneApi

    init {
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = false
            coerceInputValues = true
        }

        val logging = HttpLoggingInterceptor().apply {
            level = if (debugLogging) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        }

        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val access = runBlocking { tokenManager.tokens().first }
                val request = if (!access.isNullOrBlank()) {
                    chain.request().newBuilder().header("Authorization", "Bearer $access").build()
                } else chain.request()
                chain.proceed(request)
            }
            .addInterceptor { chain ->
                val response = chain.proceed(chain.request())
                // Single retry with a refreshed token on 401.
                if (response.code == 401) {
                    val refresh = runBlocking { tokenManager.tokens().second }
                    if (!refresh.isNullOrBlank()) {
                        val refreshed = runCatching { runBlocking { performRefresh(baseUrl, json, refresh) } }.getOrNull()
                        if (refreshed != null) {
                            runBlocking { tokenManager.save(refreshed.first, refreshed.second) }
                            response.close()
                            val retry = chain.request().newBuilder()
                                .header("Authorization", "Bearer ${refreshed.first}")
                                .build()
                            return@addInterceptor chain.proceed(retry)
                        }
                    }
                }
                response
            }
            .addInterceptor(logging)
            .build()

        api = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ToneApi::class.java)
    }

    private suspend fun performRefresh(
        baseUrl: String,
        json: Json,
        refreshToken: String,
    ): Pair<String, String> {
        val http = OkHttpClient()
        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken))
            .toRequestBodyJson()
        val request = okhttp3.Request.Builder()
            .url(baseUrl.trimEnd('/') + "/auth/refresh")
            .post(body)
            .build()
        http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw ApiException(resp.code, "Session expired; log in again")
            val parsed = json.decodeFromString(
                AuthResponse.serializer(),
                resp.body?.string() ?: throw ApiException(resp.code, "Empty refresh response"),
            )
            return parsed.accessToken to parsed.refreshToken
        }
    }

    private fun String.toRequestBodyJson(): okhttp3.RequestBody =
        okhttp3.RequestBody.create("application/json".toMediaType(), this)
}

/** Map a transport failure to a UI-friendly message. */
fun throwableMessage(t: Throwable): String = when (t) {
    is ApiException -> t.message ?: "Request failed"
    is java.io.IOException -> "Network unavailable — showing cached data"
    else -> t.message ?: "Something went wrong"
}
