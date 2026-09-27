package com.toneai.app

import android.app.Application
import com.toneai.app.data.local.ToneDatabase
import com.toneai.app.data.local.TokenManager
import com.toneai.app.data.remote.ApiModule
import com.toneai.app.data.repo.ToneRepository

/**
 * Application-scoped singletons. Simple manual DI — no framework needed at
 * this scale, keeps the APK lean.
 */
class ToneAIApp : Application() {

    lateinit var tokenManager: TokenManager
        private set
    lateinit var apiModule: ApiModule
        private set
    lateinit var repository: ToneRepository
        private set
    val database: ToneDatabase by lazy { ToneDatabase.get(this) }

    override fun onCreate() {
        super.onCreate()
        tokenManager = TokenManager(this)
        apiModule = ApiModule(tokenManager, BuildConfig.API_BASE_URL, debugLogging = false)
        repository = ToneRepository(
            api = apiModule,
            tokenManager = tokenManager,
            conversationDao = database.conversationDao(),
            messageDao = database.messageDao(),
        )
    }
}
