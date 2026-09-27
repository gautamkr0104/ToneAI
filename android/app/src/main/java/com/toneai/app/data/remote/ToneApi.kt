package com.toneai.app.data.remote

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit interface mirroring the ToneAI backend REST API 1:1.
 * All authenticated routes require a Bearer access token (added by AuthInterceptor).
 */
interface ToneApi {

    // ---- Auth ----
    @POST("auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponse

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponse

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): AuthResponse

    @POST("auth/logout")
    suspend fun logout(@Body body: RefreshRequest): OkResponse

    @POST("auth/logout-all")
    suspend fun logoutAll(): OkResponse

    @GET("me")
    suspend fun me(): MeResponse

    // ---- Instagram accounts ----
    @GET("instagram/accounts")
    suspend fun accounts(): AccountsResponse

    @POST("instagram/connect")
    suspend fun connect(@Body body: ConnectMockRequest): ConnectResponse

    @POST("instagram/disconnect")
    suspend fun disconnect(@Body body: DisconnectRequest): OkResponse

    @POST("instagram/sync")
    suspend fun sync(@Body body: SyncRequest): SyncResponse

    @DELETE("instagram/accounts/{id}")
    suspend fun deleteAccount(@Path("id") id: String): OkResponse

    // ---- Conversations ----
    @GET("conversations")
    suspend fun conversations(@Query("igAccountId") igAccountId: String): ConversationsResponse

    @GET("conversations/{id}")
    suspend fun conversation(@Path("id") id: String): ConversationDetailResponse

    @GET("conversations/{id}/messages")
    suspend fun messages(@Path("id") conversationId: String): MessagesResponse

    @POST("conversations/{id}/generate")
    suspend fun generate(@Path("id") conversationId: String, @Body body: GenerateRequest): DraftResponse

    @POST("conversations/{id}/regenerate")
    suspend fun regenerate(@Path("id") conversationId: String, @Body body: GenerateRequest): DraftResponse

    @POST("conversations/{id}/rewrite")
    suspend fun rewrite(@Path("id") conversationId: String, @Body body: RewriteRequest): DraftResponse

    @POST("conversations/{id}/send")
    suspend fun send(@Path("id") conversationId: String, @Body body: SendRequest): SendResponse

    @PUT("conversations/{id}/settings")
    suspend fun conversationSettings(@Path("id") conversationId: String, @Body body: ConversationSettingsRequest): OkResponse

    // ---- Memory ----
    @GET("memories/{conversationId}")
    suspend fun memory(@Path("conversationId") conversationId: String): MemoryResponse

    @PUT("memories/{conversationId}")
    suspend fun updateMemory(@Path("conversationId") conversationId: String, @Body body: MemoryPatch): OkResponse

    @DELETE("memories/{conversationId}")
    suspend fun deleteMemory(@Path("conversationId") conversationId: String): OkResponse

    // ---- Tone ----
    @GET("tone-profile")
    suspend fun toneProfile(): ToneProfileResponse

    @PUT("tone-profile")
    suspend fun updateToneProfile(@Body body: ToneProfileDto): ToneProfileResponse

    @POST("tone-profile/reset")
    suspend fun resetToneProfile(): OkResponse

    @GET("style-examples")
    suspend fun styleExamples(): StyleExamplesResponse

    @POST("style-examples")
    suspend fun addStyleExample(@Body body: StyleExampleCreate): OkResponse

    @DELETE("style-examples/{id}")
    suspend fun deleteStyleExample(@Path("id") id: String): OkResponse

    // ---- Instagram chat export import ----
    @POST("tone/import-chats")
    suspend fun importChats(@Body body: ImportChatsRequest): ImportChatsResponse

    @GET("tone/import-chats/status")
    suspend fun importStatus(): ImportStatusResponse

    // ---- Settings / usage / rules / privacy ----
    @GET("settings")
    suspend fun settings(): SettingsResponse

    @PUT("settings")
    suspend fun updateSettings(@Body body: SettingsPatch): SettingsResponse

    @GET("usage")
    suspend fun usage(): UsageResponse

    @GET("automation/rules")
    suspend fun rules(): RulesResponse

    // ---- Turbo mode ----
    @GET("automation/turbo")
    suspend fun turbo(): TurboResponse

    @PUT("automation/turbo")
    suspend fun setTurbo(@Body body: TurboUpdateRequest): TurboResponse

    @POST("automation/rules")
    suspend fun createRule(@Body body: RuleCreate): RuleCreatedResponse

    @PUT("automation/rules/{id}")
    suspend fun updateRule(@Path("id") id: String, @Body body: RuleUpdate): OkResponse

    @DELETE("automation/rules/{id}")
    suspend fun deleteRule(@Path("id") id: String): OkResponse

    @POST("privacy/delete-conversations")
    suspend fun privacyDeleteConversations(): OkResponse

    @POST("privacy/delete-style-examples")
    suspend fun privacyDeleteStyleExamples(): OkResponse

    @POST("privacy/delete-memories")
    suspend fun privacyDeleteMemories(): OkResponse

    @POST("privacy/reset-tone-profile")
    suspend fun privacyResetToneProfile(): OkResponse

    @POST("privacy/disable-learning")
    suspend fun privacyDisableLearning(): OkResponse

    @POST("privacy/disable-memory")
    suspend fun privacyDisableMemory(): OkResponse

    // ---- Diagnostics ----
    @GET("diagnostics")
    suspend fun diagnostics(): DiagnosticsResponse
}
