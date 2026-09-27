package com.toneai.app.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---------- Auth ----------

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class AuthResponse(
    val user: UserDto? = null,
    val accessToken: String,
    val refreshToken: String,
)

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val displayName: String? = null,
)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class MeResponse(val user: UserDto)

// ---------- Instagram ----------

@Serializable
data class IgAccountDto(
    val id: String,
    val igUserId: String,
    val username: String,
    val accountType: String? = null,
    val status: String,
    val provider: String,
    val lastSyncAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class AccountsResponse(val accounts: List<IgAccountDto>, val oauthConfigured: Boolean = false)

@Serializable
data class ConnectMockRequest(val username: String, val provider: String = "mock")

@Serializable
data class ConnectResponse(val accountId: String? = null, val mode: String? = null, val message: String? = null, val authorizeUrl: String? = null)

@Serializable
data class DisconnectRequest(val accountId: String)

@Serializable
data class SyncRequest(val accountId: String)

@Serializable
data class SyncResponse(val ok: Boolean, val conversations: Int = 0, val messages: Int = 0)

@Serializable
data class OkResponse(val ok: Boolean)

// ---------- Conversations ----------

@Serializable
data class ConversationDto(
    val id: String,
    val participantName: String,
    val participantAvatarUrl: String? = null,
    val isKnownContact: Boolean = false,
    val lastMessageAt: String? = null,
    val lastMessagePreview: String? = null,
    val unreadCount: Int = 0,
    val autoReplyMode: String = "draft_only",
    val hasAiDraft: Boolean = false,
)

@Serializable
data class ConversationsResponse(val conversations: List<ConversationDto>)

@Serializable
data class ConversationDetailDto(
    val id: String,
    val participantName: String,
    val isKnownContact: Boolean = false,
    val memoryEnabled: Boolean = true,
    val autoReplyMode: String = "draft_only",
    val unreadCount: Int = 0,
)

@Serializable
data class ConversationDetailResponse(val conversation: ConversationDetailDto)

@Serializable
data class MessageDto(
    val id: String,
    val sender: String,
    val text: String,
    val classification: String? = null,
    val sensitive: Boolean = false,
    val sentVia: String? = null,
    val createdAt: String,
)

@Serializable
data class MessagesResponse(val messages: List<MessageDto>)

@Serializable
data class GenerateRequest(
    val replyMode: String = "normal",
    val customInstruction: String? = null,
    val previousGenerationId: String? = null,
)

@Serializable
data class DraftDto(
    val generationId: String,
    val reply: String,
    val model: String,
    val classification: String,
    val sensitive: Boolean,
    /** True when turbo mode sent this reply without prior approval. */
    val autoSent: Boolean = false,
)

@Serializable
data class DraftResponse(val draft: DraftDto)

@Serializable
data class RewriteRequest(
    val generationId: String,
    val action: String? = null,
    val customInstruction: String? = null,
)

@Serializable
data class SendRequest(
    val text: String,
    val generationId: String? = null,
    val edited: Boolean = false,
)

@Serializable
data class SendResponse(val ok: Boolean, val messageId: String? = null)

@Serializable
data class ConversationSettingsRequest(
    val autoReplyMode: String? = null,
    val memoryEnabled: Boolean? = null,
    val isKnownContact: Boolean? = null,
)

// ---------- Memory ----------

@Serializable
data class MemoryDto(
    val summary: String? = null,
    val importantFacts: List<String> = emptyList(),
    val unansweredQuestions: List<String> = emptyList(),
    val language: String? = null,
    val toneContext: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class MemoryResponse(val memory: MemoryDto)

@Serializable
data class MemoryPatch(
    val summary: String? = null,
    val importantFacts: List<String>? = null,
    val unansweredQuestions: List<String>? = null,
    val toneContext: String? = null,
    val language: String? = null,
    val memoryEnabled: Boolean? = null,
)

// ---------- Tone ----------

@Serializable
data class ToneProfileDto(
    val avgMessageLength: Int = 24,
    val formality: Int = 20,
    val emojiFrequency: Float = 0.1f,
    val preferredEmojis: List<String> = emptyList(),
    val commonSlang: List<String> = emptyList(),
    val commonPhrases: List<String> = emptyList(),
    val punctuationStyle: String = "minimal",
    val capitalization: String = "lowercase",
    val humorLevel: Int = 40,
    val languages: List<String> = emptyList(),
    val hinglishUsage: Float = 0f,
    val asksFollowups: Boolean = true,
    val mirrorsTone: Boolean = true,
    val learningEnabled: Boolean = true,
    val notes: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class ToneProfileResponse(val toneProfile: ToneProfileDto)

@Serializable
data class StyleExampleDto(
    val id: String,
    val text: String,
    val category: String? = null,
    val language: String? = null,
    val tone: String? = null,
    val situation: String? = null,
    val source: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class StyleExamplesResponse(val examples: List<StyleExampleDto>)

@Serializable
data class StyleExampleCreate(
    val text: String,
    val category: String? = null,
    val language: String? = null,
    val tone: String? = null,
    val situation: String? = null,
)

// ---------- Instagram chat export import ----------

@Serializable
data class ImportChatsRequest(
    /** The parsed Instagram export JSON (array of message_N.json objects or one object). */
    val json: kotlinx.serialization.json.JsonElement,
    val accountHint: String? = null,
    val igAccountId: String? = null,
)

@Serializable
data class ToneStatsDto(
    val messageCount: Int = 0,
    val avgMessageLength: Int = 0,
    val emojiFrequency: Float = 0f,
    val preferredEmojis: List<String> = emptyList(),
    val capitalization: String = "standard",
    val formality: Int = 0,
    val hinglishUsage: Float = 0f,
    val languages: List<String> = emptyList(),
    val commonSlang: List<String> = emptyList(),
    val asksFollowups: Boolean = true,
)

@Serializable
data class ImportChatsResponse(
    val ok: Boolean = false,
    val conversations: Int = 0,
    val totalMessages: Int = 0,
    val myMessages: Int = 0,
    val styleExamplesCreated: Int = 0,
    val learned: ToneStatsDto? = null,
    val myName: String? = null,
)

@Serializable
data class ImportStatusResponse(
    val importedExamples: Int = 0,
    val lastImportAt: String? = null,
)

// ---------- Settings / usage / rules ----------

@Serializable
data class SettingsDto(
    val notificationMode: String = "ai_drafts_only",
    val newDmEnabled: Boolean = true,
    val hasFcmToken: Boolean = false,
    val updatedAt: String? = null,
)

@Serializable
data class SettingsResponse(val settings: SettingsDto)

@Serializable
data class SettingsPatch(
    val notificationMode: String? = null,
    val newDmEnabled: Boolean? = null,
    val fcmToken: String? = null,
)

@Serializable
data class UsageToday(
    val promptTokens: Long = 0,
    val completionTokens: Long = 0,
    val generations: Int = 0,
    val tokenLimit: Long = 0,
    val generationLimit: Int = 0,
)

@Serializable
data class UsageMonth(val totalTokens: Long = 0, val totalGenerations: Long = 0)

@Serializable
data class UsageResponse(val usage: UsageSummary)

@Serializable
data class UsageSummary(val today: UsageToday, val month: UsageMonth)

@Serializable
data class RuleDto(
    val id: String,
    val conversationId: String? = null,
    val igAccountId: String? = null,
    val ruleType: String,
    val enabled: Boolean = true,
    val createdAt: String? = null,
)

@Serializable
data class RulesResponse(val rules: List<RuleDto>)

@Serializable
data class RuleCreate(
    val ruleType: String,
    val conversationId: String? = null,
    val igAccountId: String? = null,
    val enabled: Boolean = true,
)

@Serializable
data class RuleCreatedResponse(val id: String)

@Serializable
data class RuleUpdate(val enabled: Boolean)

// ---------- Turbo mode ----------

@Serializable
data class TurboSettingsDto(
    val turboMode: Boolean = false,
    val turboAcknowledgedAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class TurboResponse(val turbo: TurboSettingsDto)

@Serializable
data class TurboUpdateRequest(val enabled: Boolean, val acknowledgement: String? = null)

@Serializable
data class DiagnosticsDto(
    val backendConnection: String,
    val dbConnected: Boolean,
    val dbLatencyMs: Int,
    val aiProvider: String,
    val aiConfigured: Boolean,
    val instagramOAuthConfigured: Boolean,
    val instagramAccounts: List<IgAccountStatus> = emptyList(),
    val activeSessions: Int = 0,
    val notificationProvider: String,
    val apiVersion: String,
    val serverTime: String,
)

@Serializable
data class IgAccountStatus(val provider: String, val status: String, val lastSyncAt: String? = null)

@Serializable
data class DiagnosticsResponse(val diagnostics: DiagnosticsDto)

// ---------- Errors ----------

@Serializable
data class ApiError(
    val error: String? = null,
    val message: String? = null,
)
