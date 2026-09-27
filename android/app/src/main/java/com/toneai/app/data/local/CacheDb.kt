package com.toneai.app.data.local

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

/**
 * Room cache for offline support. Conversations and messages are cached so the
 * inbox opens instantly and works without connectivity. Cached data is always
 * labeled offline; sends wait for server confirmation.
 */
@Entity(tableName = "conversations")
data class ConversationEntity(
    @PrimaryKey val id: String,
    val igAccountId: String,
    val participantName: String,
    val lastMessagePreview: String?,
    val lastMessageAt: String?,
    val unreadCount: Int,
    val hasAiDraft: Boolean,
    val autoReplyMode: String,
)

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val id: String,
    val conversationId: String,
    val sender: String,
    val text: String,
    val classification: String?,
    val sensitive: Boolean,
    val sentVia: String?,
    val createdAt: String,
)

@Dao
interface ConversationDao {
    @Query("SELECT * FROM conversations WHERE igAccountId = :accountId ORDER BY lastMessageAt DESC")
    fun observeForAccount(accountId: String): Flow<List<ConversationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<ConversationEntity>)

    @Query("DELETE FROM conversations WHERE igAccountId = :accountId")
    suspend fun clearForAccount(accountId: String)

    @Query("UPDATE conversations SET hasAiDraft = 1 WHERE id = :conversationId")
    suspend fun markHasDraft(conversationId: String)
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE conversationId = :conversationId ORDER BY createdAt ASC")
    fun observe(conversationId: String): Flow<List<MessageEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<MessageEntity>)

    @Query("DELETE FROM messages WHERE conversationId = :conversationId")
    suspend fun clear(conversationId: String)
}

@Database(entities = [ConversationEntity::class, MessageEntity::class], version = 1, exportSchema = false)
abstract class ToneDatabase : RoomDatabase() {
    abstract fun conversationDao(): ConversationDao
    abstract fun messageDao(): MessageDao

    companion object {
        @Volatile private var instance: ToneDatabase? = null

        fun get(context: Context): ToneDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context, ToneDatabase::class.java, "toneai.db")
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { instance = it }
            }
    }
}
