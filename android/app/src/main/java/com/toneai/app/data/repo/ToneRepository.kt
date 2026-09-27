package com.toneai.app.data.repo

import com.toneai.app.data.local.ConversationDao
import com.toneai.app.data.local.ConversationEntity
import com.toneai.app.data.local.MessageDao
import com.toneai.app.data.local.MessageEntity
import com.toneai.app.data.local.TokenManager
import com.toneai.app.data.remote.ApiException
import com.toneai.app.data.remote.ApiModule
import com.toneai.app.data.remote.AccountsResponse
import com.toneai.app.data.remote.AuthResponse
import com.toneai.app.data.remote.ConnectMockRequest
import com.toneai.app.data.remote.ConversationDetailResponse
import com.toneai.app.data.remote.ConversationsResponse
import com.toneai.app.data.remote.DraftDto
import com.toneai.app.data.remote.DraftResponse
import com.toneai.app.data.remote.GenerateRequest
import com.toneai.app.data.remote.LoginRequest
import com.toneai.app.data.remote.MemoryResponse
import com.toneai.app.data.remote.MemoryPatch
import com.toneai.app.data.remote.MessagesResponse
import com.toneai.app.data.remote.OkResponse
import com.toneai.app.data.remote.RegisterRequest
import com.toneai.app.data.remote.RewriteRequest
import com.toneai.app.data.remote.SendRequest
import com.toneai.app.data.remote.SendResponse
import com.toneai.app.data.remote.SyncRequest

/**
 * Repository: the single bridge between ViewModels and (API + Room cache).
 * Read paths serve cached data first and refresh in the background; write
 * paths require connectivity and only report success on server confirmation.
 */
class ToneRepository(
    private val api: ApiModule,
    private val tokenManager: TokenManager,
    private val conversationDao: ConversationDao,
    private val messageDao: MessageDao,
) {
    val apiService get() = api.api

    // ---- Auth ----

    suspend fun register(email: String, password: String, displayName: String?): AuthResponse {
        val res = api.api.register(RegisterRequest(email, password, displayName))
        tokenManager.save(res.accessToken, res.refreshToken, res.user?.id)
        return res
    }

    suspend fun login(email: String, password: String): AuthResponse {
        val res = api.api.login(LoginRequest(email, password))
        tokenManager.save(res.accessToken, res.refreshToken, res.user?.id)
        return res
    }

    suspend fun logout() {
        val (_, refresh) = tokenManager.tokens()
        runCatching { refresh?.let { api.api.logout(com.toneai.app.data.remote.RefreshRequest(it)) } }
        tokenManager.clear()
    }

    suspend fun isLoggedIn(): Boolean = tokenManager.tokens().first != null

    // ---- Instagram accounts ----

    suspend fun accounts(): AccountsResponse = api.api.accounts()

    suspend fun connectMock(username: String) = api.api.connect(ConnectMockRequest(username))

    suspend fun disconnect(accountId: String): OkResponse = api.api.disconnect(
        com.toneai.app.data.remote.DisconnectRequest(accountId),
    )

    suspend fun deleteAccount(accountId: String): OkResponse = api.api.deleteAccount(accountId)

    suspend fun sync(accountId: String) = api.api.sync(SyncRequest(accountId))

    // ---- Conversations (cache-backed) ----

    fun observeConversations(accountId: String) = conversationDao.observeForAccount(accountId)

    suspend fun refreshConversations(accountId: String) {
        val res = api.api.conversations(accountId)
        conversationDao.upsertAll(
            res.conversations.map {
                ConversationEntity(
                    id = it.id,
                    igAccountId = accountId,
                    participantName = it.participantName,
                    lastMessagePreview = it.lastMessagePreview,
                    lastMessageAt = it.lastMessageAt,
                    unreadCount = it.unreadCount,
                    hasAiDraft = it.hasAiDraft,
                    autoReplyMode = it.autoReplyMode,
                )
            },
        )
    }

    suspend fun conversationDetail(id: String): ConversationDetailResponse = api.api.conversation(id)

    fun observeMessages(conversationId: String) = messageDao.observe(conversationId)

    suspend fun refreshMessages(conversationId: String) {
        val res: MessagesResponse = api.api.messages(conversationId)
        messageDao.upsertAll(
            res.messages.map {
                MessageEntity(
                    id = it.id,
                    conversationId = conversationId,
                    sender = it.sender,
                    text = it.text,
                    classification = it.classification,
                    sensitive = it.sensitive,
                    sentVia = it.sentVia,
                    createdAt = it.createdAt,
                )
            },
        )
    }

    // ---- AI drafts ----

    suspend fun generate(conversationId: String, replyMode: String, customInstruction: String?): DraftDto {
        val res: DraftResponse = api.api.generate(conversationId, GenerateRequest(replyMode, customInstruction))
        conversationDao.markHasDraft(conversationId)
        return res.draft
    }

    suspend fun regenerate(conversationId: String, replyMode: String, customInstruction: String?): DraftDto =
        api.api.regenerate(conversationId, GenerateRequest(replyMode, customInstruction)).draft

    suspend fun rewrite(conversationId: String, generationId: String, action: String?, customInstruction: String?): DraftDto =
        api.api.rewrite(conversationId, RewriteRequest(generationId, action, customInstruction)).draft

    /**
     * Send requires explicit user approval (the UI calls this only from the
     * SEND button). Success = provider accepted the message server-side.
     */
    suspend fun send(conversationId: String, text: String, generationId: String?, edited: Boolean): SendResponse {
        val res: SendResponse = api.api.send(conversationId, SendRequest(text, generationId, edited))
        if (res.ok) refreshMessages(conversationId)
        return res
    }

    suspend fun conversationSettings(conversationId: String, autoReplyMode: String?, memoryEnabled: Boolean?): OkResponse =
        api.api.conversationSettings(
            conversationId,
            com.toneai.app.data.remote.ConversationSettingsRequest(autoReplyMode, memoryEnabled),
        )

    // ---- Memory ----

    suspend fun memory(conversationId: String): MemoryResponse = api.api.memory(conversationId)

    suspend fun updateMemory(conversationId: String, patch: MemoryPatch): OkResponse = api.api.updateMemory(conversationId, patch)

    suspend fun deleteMemory(conversationId: String): OkResponse = api.api.deleteMemory(conversationId)

    // ---- Generic passthrough for settings/tone/usage/privacy screens ----

    suspend fun <T> call(block: suspend () -> T): T = try {
        block()
    } catch (e: ApiException) {
        throw e
    }

    // ---- Instagram chat export import ----

    /**
     * Parse the user's Instagram "Download your information" JSON locally and
     * upload it so the backend learns the user's tone from THEIR OWN messages.
     * The file never leaves the user except to their own backend.
     */
    suspend fun importChats(json: kotlinx.serialization.json.JsonElement, accountHint: String?): com.toneai.app.data.remote.ImportChatsResponse {
        val res = api.api.importChats(
            com.toneai.app.data.remote.ImportChatsRequest(json = json, accountHint = accountHint),
        )
        return res
    }

    suspend fun importStatus(): com.toneai.app.data.remote.ImportStatusResponse = api.api.importStatus()
}
