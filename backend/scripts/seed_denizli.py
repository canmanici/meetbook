#!/usr/bin/env python3
"""Seed ~100 books near Denizli with proper ORM. Run inside backend container:
   cd /app && PYTHONPATH=/app uv run --no-dev python scripts/seed_denizli.py
"""
import asyncio
import os
import random
import sys
import uuid
from datetime import datetime, timezone

# Ensure path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["ENV"] = "development"

from sqlalchemy import select, text
from app.core.config import get_settings
from app.core.db import get_session_factory
from app.modules.books.models import Book
from app.modules.auth.models import User

DENIZLI_LAT = 37.1678319
DENIZLI_LNG = 29.5280428

CONDITIONS = ["new", "like_new", "good", "worn"]

BOOKS = [
    ("Kürk Mantolu Madonna", "Sabahattin Ali", "fiction", "tr"),
    ("İçimizdeki Şeytan", "Sabahattin Ali", "fiction", "tr"),
    ("Kuyucaklı Yusuf", "Sabahattin Ali", "fiction", "tr"),
    ("İnce Memed", "Yaşar Kemal", "fiction", "tr"),
    ("Tutunamayanlar", "Oğuz Atay", "fiction", "tr"),
    ("Tehlikeli Oyunlar", "Oğuz Atay", "fiction", "tr"),
    ("Aşk", "Elif Şafak", "fiction", "tr"),
    ("Ustam ve Ben", "Elif Şafak", "fiction", "tr"),
    ("Serenad", "Zülfü Livaneli", "fiction", "tr"),
    ("Kafamda Bir Tuhaflık", "Orhan Pamuk", "fiction", "tr"),
    ("Benim Adım Kırmızı", "Orhan Pamuk", "fiction", "tr"),
    ("Masumiyet Müzesi", "Orhan Pamuk", "fiction", "tr"),
    ("Saatleri Ayarlama Enstitüsü", "Ahmet Hamdi Tanpınar", "fiction", "tr"),
    ("Huzur", "Ahmet Hamdi Tanpınar", "fiction", "tr"),
    ("İstanbul Hatırası", "Ahmet Ümit", "fiction", "tr"),
    ("Bereketli Topraklar Üzerinde", "Orhan Kemal", "fiction", "tr"),
    ("Puslu Kıtalar Atlası", "İhsan Oktay Anar", "fiction", "tr"),
    ("Suç ve Ceza", "Fyodor Dostoyevski", "fiction", "tr"),
    ("Savaş ve Barış", "Lev Tolstoy", "fiction", "tr"),
    ("Anna Karenina", "Lev Tolstoy", "fiction", "tr"),
    ("1984", "George Orwell", "fiction", "tr"),
    ("Hayvan Çiftliği", "George Orwell", "fiction", "tr"),
    ("Simyacı", "Paulo Coelho", "fiction", "tr"),
    ("Dönüşüm", "Franz Kafka", "fiction", "tr"),
    ("Yabancı", "Albert Camus", "fiction", "tr"),
    ("Gece Yarısı Kütüphanesi", "Matt Haig", "fiction", "tr"),
    ("Küçük Prens", "Antoine de Saint-Exupéry", "children", "tr"),
    ("Yüzyıllık Yalnızlık", "Gabriel García Márquez", "fiction", "tr"),
    ("Körlük", "José Saramago", "fiction", "tr"),
    ("Satranç", "Stefan Zweig", "fiction", "tr"),
    ("Uçurtma Avcısı", "Khaled Hosseini", "fiction", "tr"),
    ("Bin Muhteşem Güneş", "Khaled Hosseini", "fiction", "tr"),
    ("Martin Eden", "Jack London", "fiction", "tr"),
    ("Şeker Portakalı", "José Mauro de Vasconcelos", "children", "tr"),
    ("Harry Potter ve Felsefe Taşı", "J.K. Rowling", "children", "tr"),
    ("Harry Potter ve Sırlar Odası", "J.K. Rowling", "children", "tr"),
    ("Harry Potter ve Azkaban Tutsağı", "J.K. Rowling", "children", "tr"),
    ("Küçük Kara Balık", "Samed Behrengi", "children", "tr"),
    ("Çizgili Pijamalı Çocuk", "John Boyne", "children", "tr"),
    ("Sol Ayağım", "Christy Brown", "children", "tr"),
    ("Atomik Alışkanlıklar", "James Clear", "non_fiction", "tr"),
    ("Zengin Baba Yoksul Baba", "Robert Kiyosaki", "non_fiction", "tr"),
    ("Sapiens", "Yuval Noah Harari", "non_fiction", "tr"),
    ("21. Yüzyıl İçin 21 Ders", "Yuval Noah Harari", "non_fiction", "tr"),
    ("Bir Ömür Nasıl Yaşanır?", "İlber Ortaylı", "non_fiction", "tr"),
    ("Nutuk", "Mustafa Kemal Atatürk", "textbook", "tr"),
    ("Kendime Düşünceler", "Marcus Aurelius", "non_fiction", "tr"),
    ("İnsan Ne İle Yaşar?", "Lev Tolstoy", "non_fiction", "tr"),
    ("Sokrates'in Savunması", "Platon", "non_fiction", "tr"),
    ("Devlet", "Platon", "non_fiction", "tr"),
    ("Felsefe Tarihi", "Ahmet Cevizci", "textbook", "tr"),
    ("Bütün Şiirleri", "Orhan Veli Kanık", "poetry", "tr"),
    ("Memleketimden İnsan Manzaraları", "Nazım Hikmet", "poetry", "tr"),
    ("Kuvayi Milliye", "Nazım Hikmet", "poetry", "tr"),
    ("Saat 21.00 Şiirleri", "Cemal Süreya", "poetry", "tr"),
    ("Ben Sana Mecburum", "Attila İlhan", "poetry", "tr"),
    ("Şiirler", "Özdemir Asaf", "poetry", "tr"),
    ("Daktiloya Çekilmiş Şiirler", "Turgut Uyar", "poetry", "tr"),
    ("Watchmen", "Alan Moore", "comics", "tr"),
    ("V for Vendetta", "Alan Moore", "comics", "tr"),
    ("Maus", "Art Spiegelman", "comics", "tr"),
    ("Persepolis", "Marjane Satrapi", "comics", "tr"),
    ("One Piece Cilt 1", "Eiichiro Oda", "comics", "tr"),
    ("Naruto Cilt 1", "Masashi Kishimoto", "comics", "tr"),
    ("Death Note Cilt 1", "Tsugumi Ohba", "comics", "tr"),
    ("Attack on Titan Cilt 1", "Hajime Isayama", "comics", "tr"),
    ("Kayıp Tanrılar Ülkesi", "Ahmet Ümit", "fiction", "tr"),
    ("Ömer Seyfettin Hikayeleri", "Ömer Seyfettin", "fiction", "tr"),
    ("Beyhude Ömrüm", "İbrahim Balcı", "fiction", "tr"),
    ("Dünya Klasikleri Masalları", "Kolektif", "children", "tr"),
    ("Hapı Yuttuk Eczanesi", "Mert Arık", "fiction", "tr"),
    ("Od", "İskender Pala", "fiction", "tr"),
    ("Babil'de Ölüm İstanbul'da Aşk", "İskender Pala", "fiction", "tr"),
    ("Azdahak", "İskender Pala", "fiction", "tr"),
    ("Yırtıcı Kuşlar Zamanı", "Ahmet Ümit", "fiction", "tr"),
    ("El Kızı", "Orhan Kemal", "fiction", "tr"),
    ("Yaşamak", "Yu Hua", "fiction", "tr"),
    ("Algernon'a Çiçekler", "Daniel Keyes", "fiction", "tr"),
    ("Hyunam-Dong Kitabevi", "Hwang Bo-reum", "fiction", "tr"),
    ("İnsanlığımı Yitirirken", "Osamu Dazai", "fiction", "tr"),
    ("Yeraltından Notlar", "Fyodor Dostoyevski", "fiction", "tr"),
    ("Ölmek İstiyorum Ama Tteokbokki de Yemek İstiyorum", "Baek Se-hee", "non_fiction", "tr"),
    ("Düşüncenin Gücü", "James Allen", "non_fiction", "tr"),
    ("Mutlu Yaşam Üzerine", "Seneca", "non_fiction", "tr"),
    ("Labirent: Batı ve Hasımları", "Amin Maalouf", "non_fiction", "tr"),
    ("Kalk Bi Dopamin Demle", "Serkan Karaismailoğlu", "non_fiction", "tr"),
    ("Türkiye'nin Yakın Tarihi", "İlber Ortaylı", "textbook", "tr"),
    ("Osmanlı'yı Yeniden Keşfetmek", "İlber Ortaylı", "textbook", "tr"),
    ("Gül Yetiştiren Adam", "Rasim Özdenören", "poetry", "tr"),
    ("Bütün Şiirleri", "Can Yücel", "poetry", "tr"),
    ("Hüzün Şiirleri", "Cemal Safi", "poetry", "tr"),
    ("Kayıp Kıta Mu", "James Churchward", "other", "tr"),
    ("Bir Aile Meselesi", "Zeynep Cihangir Çankaya", "fiction", "tr"),
    ("Kırmızı Saçlı Kadın", "Orhan Pamuk", "fiction", "tr"),
    ("Huzursuzluk", "Zülfü Livaneli", "fiction", "tr"),
    ("Annemin Uyurgezer Geceleri", "Ayfer Tunç", "fiction", "tr"),
    ("Havva'nın Üç Kızı", "Elif Şafak", "fiction", "tr"),
]


def random_location_near_denizli() -> tuple[float, float]:
    lat_offset = random.uniform(-0.045, 0.045)
    lng_offset = random.uniform(-0.045, 0.045)
    return DENIZLI_LAT + lat_offset, DENIZLI_LNG + lng_offset


def blur_location(lat: float, lng: float, grid: float = 0.01) -> tuple[float, float]:
    return round(lat / grid) * grid, round(lng / grid) * grid


async def seed():
    print("=" * 60)
    print("  MeetBook — Denizli Seed")
    print("=" * 60)

    factory = get_session_factory()
    async with factory() as session:
        # Get real users (active or not — we just need owner IDs)
        result = await session.execute(select(User.id))
        user_ids = [r[0] for r in result]
        if not user_ids:
            print("  ✗ No users found! Run seed.py first.")
            return 1
        print(f"  ✓ {len(user_ids)} users found")

        # Delete old books (hard delete — clean slate)
        print("\n── Cleaning old books ──────────────────────────────────")
        await session.execute(text("DELETE FROM book_photos"))
        await session.execute(text("DELETE FROM book_favorites"))
        await session.execute(text("DELETE FROM exchange_requests"))
        await session.execute(text("DELETE FROM geofence_alerts"))
        await session.execute(text("DELETE FROM books"))
        await session.commit()
        print("  ✓ Old books deleted")

        # Insert new books
        print(f"\n── Seeding {len(BOOKS)} books near Denizli ───────────────")
        now = datetime.now(timezone.utc)
        for idx, (title, author, category, lang) in enumerate(BOOKS, 1):
            lat, lng = random_location_near_denizli()
            pub_lat, pub_lng = blur_location(lat, lng)
            loc_wkt = f"SRID=4326;POINT({lng} {lat})"
            pub_wkt = f"SRID=4326;POINT({pub_lng} {pub_lat})"

            book = Book(
                owner_id=random.choice(user_ids),
                title=title,
                author=author,
                isbn=f"978{random.randint(100000000, 999999999)}",
                description=f"{title} — {author}",
                category=category,
                language=lang,
                condition=random.choice(CONDITIONS),
                is_available=True,
                location=loc_wkt,
                public_location=pub_wkt,
                created_at=now,
                updated_at=now,
            )
            session.add(book)
            if idx % 20 == 0:
                await session.flush()
                print(f"  {idx}/{len(BOOKS)} seeded")
        await session.commit()
        print(f"  ✓ All {len(BOOKS)} books seeded")

    # Summary
    async with factory() as session:
        total = await session.execute(text("SELECT COUNT(*) FROM books"))
        print(f"\n{'=' * 60}")
        print(f"  ✅ Complete! {total.scalar()} books near Denizli")
        print(f"  📍 {DENIZLI_LAT}, {DENIZLI_LNG}")
    return 0


def main():
    return asyncio.run(seed())


if __name__ == "__main__":
    sys.exit(main())
