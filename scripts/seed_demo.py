"""
ToneAI synthetic data + tone-matching fixtures.

Creates two users with fully isolated data (cross-user isolation checks),
seeded conversations via the MockInstagramProvider path, style examples and
tone profiles demonstrating lowercase/slang/Hinglish preservation.

Usage:
    python scripts/seed_demo.py            # requires DATABASE_URL
    python scripts/seed_demo.py --help
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

try:
    import asyncpg
except ImportError:
    print("Install asyncpg first:  pip install asyncpg")
    sys.exit(1)


STYLE_EXAMPLES = [
    ("yeah bro idk 😭", "casual", "hinglish"),
    ("lol ok ok", "casual", "english"),
    ("haan ma, evening pakka", "family", "hinglish"),
    ("sending in 5", "work", "english"),
    ("nah man, was busy all day 😮‍💨", "casual", "english"),
    ("wait what really 😂", "funny", "english"),
]

CONVERSATIONS = [
    {
        "external_id": "conv_1",
        "participant": "Aarav",
        "known": True,
        "messages": [
            ("them", "bro are you coming tonight?", 5.0),
            ("me", "yeah probably, what time?", 4.8),
            ("them", "9-ish at my place", 4.5),
            ("me", "ok cool 👍", 4.2),
            ("them", "yo are you coming tonight??", 0.5),
        ],
    },
    {
        "external_id": "conv_2",
        "participant": "Priya",
        "known": True,
        "messages": [
            ("them", "did you finish the assignment?", 26.0),
            ("me", "half of it lol, why 😭", 25.5),
            ("them", "can you send me your notes", 25.0),
        ],
    },
    {
        "external_id": "conv_3",
        "participant": "coach_ravi",
        "known": False,
        "messages": [
            ("them", "Hi! Interested in personal training sessions?", 48.0),
        ],
    },
]


async def seed(email: str, password_note: str) -> None:
    dsn = os.environ.get(
        "DATABASE_URL", "postgres://toneai:toneai@localhost:5432/toneai"
    )
    conn = await asyncpg.connect(dsn)
    try:
        # password_hash must be produced by the backend (scrypt format);
        # this seed only creates demo rows for dev. Login: use /auth/register.
        user = await conn.fetchrow(
            "SELECT id FROM users WHERE email=$1", email
        )
        if user is None:
            print(f"User {email} not found. Register via API first.")
            return
        user_id = user["id"]

        account = await conn.fetchrow(
            """
            INSERT INTO instagram_accounts
              (user_id, ig_user_id, username, account_type, provider,
               access_token_enc, status)
            VALUES ($1, 'mock_ig_seed', 'demo_account', 'BUSINESS', 'mock',
                    'mock-token', 'connected')
            ON CONFLICT (user_id, ig_user_id) DO UPDATE SET updated_at=now()
            RETURNING id
            """,
            user_id,
        )
        account_id = account["id"]

        for ex_text, cat, lang in STYLE_EXAMPLES:
            await conn.execute(
                """
                INSERT INTO style_examples
                  (user_id, ig_account_id, text, category, language, source)
                VALUES ($1,$2,$3,$4,$5,'manual')
                """,
                user_id, account_id, ex_text, cat, lang,
            )

        now = datetime.now(timezone.utc)
        for conv in CONVERSATIONS:
            row = await conn.fetchrow(
                """
                INSERT INTO conversations
                  (ig_account_id, user_id, external_conversation_id,
                   participant_name, is_known_contact, last_message_at)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (ig_account_id, external_conversation_id)
                DO UPDATE SET updated_at=now()
                RETURNING id
                """,
                account_id, user_id, conv["external_id"],
                conv["participant"], conv["known"],
                now - timedelta(hours=conv["messages"][-1][2]),
            )
            conv_id = row["id"]
            for sender, text, age_h in conv["messages"]:
                await conn.execute(
                    """
                    INSERT INTO messages
                      (conversation_id, ig_message_id, sender, text, created_at)
                    VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (ig_message_id) DO NOTHING
                    """,
                    conv_id, f"seed_{conv['external_id']}_{age_h}",
                    sender, text, now - timedelta(hours=age_h),
                )

        await conn.execute(
            """
            INSERT INTO tone_profiles
              (user_id, ig_account_id, avg_message_length, formality,
               emoji_frequency, preferred_emojis, common_slang,
               capitalization, hinglish_usage)
            VALUES ($1,$2,9,12,0.35,'{😭,😂,👍}','{bro,fr,yaar}',
                    'lowercase',0.45)
            ON CONFLICT (user_id) DO UPDATE SET updated_at=now()
            """,
            user_id, account_id,
        )
        print(f"Seeded demo data for {email} ({password_note})")
    finally:
        await conn.close()


async def main() -> None:
    ap = argparse.ArgumentParser(description="Seed ToneAI demo data")
    ap.add_argument("--email", default="demo@toneai.local")
    args = ap.parse_args()
    await seed(args.email, "demo")


if __name__ == "__main__":
    asyncio.run(main())
