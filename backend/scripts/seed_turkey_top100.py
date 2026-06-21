#!/usr/bin/env python3
"""Replace seed books with Türkiye's top 100 most read books.

Sources:
  - Kitapyurdu 2025 bestseller lists
  - Hepsiburada 2025 book data
  - Amazon Turkey 2025 data
  - Son 10 yılın en çok satan kitapları

Usage:
    docker cp scripts/seed_turkey_top100.py meetbook-backend-1:/app/scripts/
    docker exec meetbook-backend-1 bash -c "cd /app && PYTHONPATH=/app uv run --no-dev python scripts/seed_turkey_top100.py"
"""

import asyncio
import io
import json
import logging
import os
import random
import sys
import uuid
from datetime import datetime, timezone

import httpx

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

DENIZLI_LAT = 37.1678319
DENIZLI_LNG = 29.5280428

USERS = [
    "30217149-0ca8-482c-8e16-0af8c55119a3",  # Arif
    "65d5f1c6-610c-4b84-b2b6-779aa9061262",  # Habib Doğan
    "7ed9e0d7-f21c-40a5-8c84-58b2e3865240",  # Emir
    "9130ac1e-b945-4cba-ae82-301577e7a3f9",  # Admin
    "2ce5e764-7d2b-4ba7-b26f-6a3228e6c5f6",  # Demo User
    "4998a113-ca1e-4dba-a19d-f8f86d95bdf4",  # Test User 1
]

CONDITIONS = ["new", "like_new", "good", "worn"]

# ── Türkiye'de En Çok Okunan 100 Kitap ──────────────────────────────────────
# Compiled from Kitapyurdu, Hepsiburada, Amazon Turkey, and all-time bestseller data

TOP_100_BOOKS = [
    # ── Yerli Edebiyat (Turkish Literature) ──
    ("Kürk Mantolu Madonna", "Sabahattin Ali", "fiction", "tr", "Sabahattin Ali'nin başyapıtı, aşk ve yalnızlık üzerine unutulmaz bir roman."),
    ("İçimizdeki Şeytan", "Sabahattin Ali", "fiction", "tr", "İnsanın içindeki iyi ve kötü arasındaki mücadeleyi anlatan klasik roman."),
    ("Kuyucaklı Yusuf", "Sabahattin Ali", "fiction", "tr", "Bir Anadolu kasabasında geçen trajik bir aşk ve adalet hikayesi."),
    ("İnce Memed", "Yaşar Kemal", "fiction", "tr", "Çukurova'da bir eşkıyanın halk için verdiği mücadeleyi anlatan destansı roman."),
    ("İnce Memed 2", "Yaşar Kemal", "fiction", "tr", "İnce Memed'in mücadelesinin devamı."),
    ("Tutunamayanlar", "Oğuz Atay", "fiction", "tr", "Modern Türk edebiyatının başyapıtı, bireyin topluma yabancılaşmasını anlatır."),
    ("Tehlikeli Oyunlar", "Oğuz Atay", "fiction", "tr", "Oyunlarla gerçeklik arasında sıkışmış bir adamın hikayesi."),
    ("Aşk", "Elif Şafak", "fiction", "tr", "Tasavvuf ve modern aşkın iç içe geçtiği çok satan roman."),
    ("Ustam ve Ben", "Elif Şafak", "fiction", "tr", "Mimar Sinan ve kölesi üzerinden Osmanlı İstanbul'unu anlatan roman."),
    ("Havva'nın Üç Kızı", "Elif Şafak", "fiction", "tr", "İstanbul, Oxford ve New York arasında üç kadının hikayesi."),
    ("Serenad", "Zülfü Livaneli", "fiction", "tr", "Geçmişle yüzleşme ve bir üniversite kasabasında geçen sürükleyici roman."),
    ("Bekle Beni", "Zülfü Livaneli", "fiction", "tr", "2025'in en çok satan yerli kitabı, aşk ve direniş hikayesi."),
    ("Engereğin Gözü", "Zülfü Livaneli", "fiction", "tr", "Tarihi ve politik olayların iç içe geçtiği sürükleyici roman."),
    ("Kafamda Bir Tuhaflık", "Orhan Pamuk", "fiction", "tr", "Nobel ödüllü yazardan İstanbul sokaklarında bir seyyar satıcının hikayesi."),
    ("Benim Adım Kırmızı", "Orhan Pamuk", "fiction", "tr", "Osmanlı minyatür sanatı ve cinayet gizemi etrafında dönen roman."),
    ("Masumiyet Müzesi", "Orhan Pamuk", "fiction", "tr", "Bir aşk hikayesi ve İstanbul'un 1970'lerinden bir kesit."),
    ("Saatleri Ayarlama Enstitüsü", "Ahmet Hamdi Tanpınar", "fiction", "tr", "Türk modernleşmesini hicveden başyapıt."),
    ("Huzur", "Ahmet Hamdi Tanpınar", "fiction", "tr", "İstanbul'da geçen, aşk ve huzur arayışını anlatan klasik."),
    ("Yırtıcı Kuşlar Zamanı", "Ahmet Ümit", "fiction", "tr", "Başkomiser Nevzat'ın çözmesi gereken yeni bir cinayet."),
    ("İstanbul Hatırası", "Ahmet Ümit", "fiction", "tr", "Tarihi eserler etrafında dönen polisiye roman."),
    ("El Kızı", "Orhan Kemal", "fiction", "tr", "Bir aile dramını anlatan gerçekçi roman."),
    ("Bereketli Topraklar Üzerinde", "Orhan Kemal", "fiction", "tr", "Çukurova'da çalışan mevsimlik işçilerin hayat mücadelesi."),
    ("Azdahak", "İskender Pala", "fiction", "tr", "Efsane ve tarihin iç içe geçtiği mistik roman."),
    ("Babil'de Ölüm İstanbul'da Aşk", "İskender Pala", "fiction", "tr", "Tarihi aşk hikayeleri ve gizem."),
    ("Altı Harfli Bir Tatlı", "Şermin Yaşar", "fiction", "tr", "Günlük hayatın komik ve sıcak hikayeleri."),
    ("Annemin Uyurgezer Geceleri", "Ayfer Tunç", "fiction", "tr", "Aile, hafıza ve geçmişle yüzleşme üzerine roman."),
    ("Bir Aile Meselesi", "Zeynep Cihangir Çankaya & Serdar Çankaya", "fiction", "tr", "Aile ilişkileri üzerine sıcak bir roman."),
    ("Huzursuzluk", "Zülfü Livaneli", "fiction", "tr", "Ortadoğu'da geçen güncel bir aşk ve dram hikayesi."),
    ("Kırmızı Saçlı Kadın", "Orhan Pamuk", "fiction", "tr", "Baba-oğul ilişkisi ve mitolojinin iç içe geçtiği roman."),
    ("Od", "İskender Pala", "fiction", "tr", "Ateşin peşinde bir tarihi yolculuk."),

    # ── Dünya Klasikleri / Yabancı Edebiyat ──
    ("Suç ve Ceza", "Fyodor Dostoyevski", "fiction", "tr", "Bir cinayetin ardından vicdan azabıyla boğuşan bir adamın hikayesi."),
    ("Savaş ve Barış", "Lev Tolstoy", "fiction", "tr", "Napolyon savaşları döneminde Rus aristokrasisinin destansı hikayesi."),
    ("Anna Karenina", "Lev Tolstoy", "fiction", "tr", "Yasak aşk ve toplumsal baskılar arasında sıkışan bir kadının trajedisi."),
    ("1984", "George Orwell", "fiction", "tr", "Distopik bir dünyada bireyselliğin ve özgürlüğün yok oluşu."),
    ("Hayvan Çiftliği", "George Orwell", "fiction", "tr", "Totaliter rejimleri hicveden alegorik roman."),
    ("Simyacı", "Paulo Coelho", "fiction", "tr", "Kişisel efsanenin peşinde bir Endülüslü çobanın yolculuğu."),
    ("Dönüşüm", "Franz Kafka", "fiction", "tr", "Bir sabah böceğe dönüşen adamın varoluşsal hikayesi."),
    ("Yabancı", "Albert Camus", "fiction", "tr", "Varoluşçuluğun başyapıtı, duygusuz bir adamın hikayesi."),
    ("Gece Yarısı Kütüphanesi", "Matt Haig", "fiction", "tr", "Hayatın farklı versiyonlarını deneyimleyen bir kadının hikayesi."),
    ("Sarı Yüz", "R. F. Kuang", "fiction", "tr", "Yayın dünyasını hicveden çarpıcı bir roman."),
    ("Yaşamak", "Yu Hua", "fiction", "tr", "Çin'de bir adamın yaşam mücadelesini anlatan dokunaklı roman."),
    ("Küçük Prens", "Antoine de Saint-Exupéry", "children", "tr", "Dünyaya gelen bir prensin gözünden hayatın anlamı."),
    ("Yüzyıllık Yalnızlık", "Gabriel García Márquez", "fiction", "tr", "Büyülü gerçekçiliğin başyapıtı, Macondo kasabasının hikayesi."),
    ("Körlük", "José Saramago", "fiction", "tr", "Bir salgınla gelen körlüğün toplumu nasıl dönüştürdüğünü anlatan roman."),
    ("Satranç", "Stefan Zweig", "fiction", "tr", "Bir satranç maçı etrafında dönen psikolojik gerilim."),
    ("Uçurtma Avcısı", "Khaled Hosseini", "fiction", "tr", "Afganistan'da iki çocuğun dostluk ve ihanet hikayesi."),
    ("Bin Muhteşem Güneş", "Khaled Hosseini", "fiction", "tr", "Afganistan'da iki kadının dayanışma ve umut hikayesi."),
    ("Martin Eden", "Jack London", "fiction", "tr", "Bir denizcinin yazar olma mücadelesi ve sınıf atlama hikayesi."),
    ("Algernon'a Çiçekler", "Daniel Keyes", "fiction", "tr", "Zihinsel engelli bir adamın zekiye dönüşümünün dokunaklı hikayesi."),
    ("Hyunam-Dong Kitabevi", "Hwang Bo-reum", "fiction", "tr", "Bir kitabevinin açılışıyla değişen hayatlar."),
    ("İnsanlığımı Yitirirken", "Osamu Dazai", "fiction", "tr", "Japon edebiyatının başyapıtı, yabancılaşma ve umutsuzluk üzerine."),
    ("Sırların Sırrı", "Dan Brown", "fiction", "tr", "Robert Langdon'ın yeni macerası, gizem ve tarih iç içe."),
    ("Yeraltından Notlar", "Fyodor Dostoyevski", "fiction", "tr", "Modern varoluşçuluğun öncüsü, yeraltı adamının itirafları."),
    ("Ölmek İstiyorum Ama Tteokbokki de Yemek İstiyorum", "Baek Se-hee", "non_fiction", "tr", "Depresyonla mücadele eden bir genç kadının samimi hikayesi."),

    # ── Kişisel Gelişim & Felsefe ──
    ("Kendime Düşünceler", "Marcus Aurelius", "non_fiction", "tr", "Stoacı felsefenin temel metni, bir imparatorun kendine notları."),
    ("Atomik Alışkanlıklar", "James Clear", "non_fiction", "tr", "Küçük alışkanlıklarla büyük değişim yaratmanın bilimsel yöntemi."),
    ("Zengin Baba Yoksul Baba", "Robert Kiyosaki", "non_fiction", "tr", "Finansal okuryazarlık ve yatırım üzerine çok satan kitap."),
    ("Düşüncenin Gücü", "James Allen", "non_fiction", "tr", "Kişisel gelişim ve pozitif düşüncenin gücü üzerine klasik eser."),
    ("21. Yüzyıl İçin 21 Ders", "Yuval Noah Harari", "non_fiction", "tr", "Günümüz dünyasının en büyük sorunlarına dair çarpıcı analizler."),
    ("Hayvanlardan Tanrılara: Sapiens", "Yuval Noah Harari", "non_fiction", "tr", "İnsan türünün kısa bir tarihi."),
    ("Bir Ömür Nasıl Yaşanır?", "İlber Ortaylı", "non_fiction", "tr", "Tarihçi İlber Ortaylı'dan hayat dersleri."),
    ("Dakikalar İçinde Atatürk ve Dünyası", "İlber Ortaylı", "non_fiction", "tr", "Atatürk'ü ve dönemini anlatan kapsamlı bir çalışma."),
    ("Sokrates'in Savunması", "Platon (Eflatun)", "non_fiction", "tr", "Batı felsefesinin temel metinlerinden biri."),
    ("Devlet", "Platon (Eflatun)", "non_fiction", "tr", "İdeal devlet düzeni üzerine felsefi diyalog."),
    ("Mutlu Yaşam Üzerine", "Seneca", "non_fiction", "tr", "Stoacı felsefede mutluluk ve yaşam sanatı."),
    ("İnsan Ne İle Yaşar?", "Lev Tolstoy", "non_fiction", "tr", "İyilik, sevgi ve insanlık üzerine öyküler."),
    ("Labirent: Batı ve Hasımları", "Amin Maalouf", "non_fiction", "tr", "Doğu-Batı çatışmasının tarihsel kökenleri."),
    ("Çocuğumun Aklından Neler Geçiyor?", "Tanith Carey", "non_fiction", "tr", "Çocuk psikolojisi ve ebeveynlik rehberi."),
    ("Kalk Bi Dopamin Demle", "Serkan Karaismailoğlu", "non_fiction", "tr", "Beyin kimyası ve mutluluk üzerine pratik rehber."),

    # ── Ders Kitapları / Akademik ──
    ("Nutuk", "Mustafa Kemal Atatürk", "textbook", "tr", "Atatürk'ün Kurtuluş Savaşı ve Cumhuriyet dönemini anlattığı başyapıt."),
    ("Türkiye'nin Yakın Tarihi", "İlber Ortaylı", "textbook", "tr", "Cumhuriyet dönemi Türkiye tarihine kapsamlı bir bakış."),
    ("Osmanlı'yı Yeniden Keşfetmek", "İlber Ortaylı", "textbook", "tr", "Osmanlı İmparatorluğu'nun bilinmeyen yönleri."),
    ("Türkçe Sözlük", "Türk Dil Kurumu", "textbook", "tr", "Türkçenin en kapsamlı sözlüğü."),
    ("Felsefe Tarihi", "Ahmet Cevizci", "textbook", "tr", "Batı felsefesinin kapsamlı tarihi."),
    ("Sosyolojiye Giriş", "Anthony Giddens", "textbook", "tr", "Sosyoloji bilimine kapsamlı giriş kitabı."),
    ("Mikroekonomi", "Orhan Türkdoğan", "textbook", "tr", "Temel mikroekonomi teorileri ve uygulamaları."),
    ("Psikolojiye Giriş", "Rod Plotnik", "textbook", "tr", "Psikoloji biliminin temel kavramları."),
    ("Genel Fizik", "A. Serway & R. Beichner", "textbook", "tr", "Üniversite fiziğinin temel prensipleri."),
    ("Genel Kimya", "Raymond Chang", "textbook", "tr", "Temel kimya kavramları ve uygulamaları."),

    # ── Çocuk Kitapları ──
    ("Şeker Portakalı", "José Mauro de Vasconcelos", "children", "tr", "Küçük Zezé'nin dokunaklı büyüme hikayesi."),
    ("Küçük Prens", "Antoine de Saint-Exupéry", "children", "tr", "Bir prensin gözünden hayat, aşk ve dostluk."),
    ("Hayvanların En Güzeli", "Aziz Sivaslıoğlu", "children", "tr", "Çocuklar için hayvan hikayeleri."),
    ("Momenti", "Christelle Dabos", "children", "tr", "Yüzen adalarda geçen fantastik bir macera."),
    ("Harry Potter ve Felsefe Taşı", "J.K. Rowling", "children", "tr", "Büyücülük dünyasında geçen unutulmaz serinin ilk kitabı."),
    ("Harry Potter ve Sırlar Odası", "J.K. Rowling", "children", "tr", "Harry Potter'ın Hogwarts'taki ikinci yılı."),
    ("Harry Potter ve Azkaban Tutsağı", "J.K. Rowling", "children", "tr", "Harry Potter'ın üçüncü macerası."),
    ("Yalnız Efe", "Ömer Seyfettin", "children", "tr", "Türk edebiyatının klasik çocuk hikayesi."),
    ("Falaka", "Ömer Seyfettin", "children", "tr", "Çocukluk anıları üzerine unutulmaz öykü."),
    ("Küçük Kara Balık", "Samed Behrengi", "children", "tr", "Küçük bir balığın özgürlük arayışı."),
    ("Uykusu Gelmeyen Porsuk", "Constanze Von Kitzing", "children", "tr", "Uyumak istemeyen porsuğun hikayesi."),
    ("Zorbalığa Karşı Taktiklerim Var", "Saniye Bencik Kangal", "children", "tr", "Çocuklara zorbalıkla baş etme yöntemleri."),
    ("Küçük Piknikçiler", "Behiç Ak", "children", "tr", "Doğa ve arkadaşlık üzerine sıcak bir hikaye."),
    ("Çizgili Pijamalı Çocuk", "John Boyne", "children", "tr", "Holokost'u bir çocuğun gözünden anlatan roman."),
    ("Sol Ayağım", "Christy Brown", "children", "tr", "Engelleri aşan bir çocuğun ilham verici hikayesi."),

    # ── Çizgi Roman / Manga ──
    ("Kedinin Kütüphanesi", "Bige Güven Kızılay", "comics", "tr", "Yerli çizgi roman, bir kedi ve kütüphane hikayesi."),
    ("Dune", "Frank Herbert (Brian Herbert çizgi roman uyarlaması)", "comics", "tr", "Bilim kurgu klasiğinin çizgi roman uyarlaması."),
    ("Watchmen", "Alan Moore", "comics", "tr", "Çizgi roman tarihinin en önemli eserlerinden biri."),
    ("V for Vendetta", "Alan Moore", "comics", "tr", "Distopik bir dünyada özgürlük savaşçısının hikayesi."),
    ("Maus", "Art Spiegelman", "comics", "tr", "Holokost'u anlatan Pulitzer ödüllü çizgi roman."),
    ("Persepolis", "Marjane Satrapi", "comics", "tr", "İran Devrimi'ni bir kız çocuğunun gözünden anlatan çizgi roman."),
    ("One Piece Cilt 1", "Eiichiro Oda", "comics", "tr", "Dünyanın en çok satan mangası, korsan macerası."),
    ("Naruto Cilt 1", "Masashi Kishimoto", "comics", "tr", "Genç bir ninjanın hayallerinin peşinde yolculuğu."),
    ("Death Note Cilt 1", "Tsugumi Ohba", "comics", "tr", "Bir defterle ölüm ve adalet üzerine gerilim dolu manga."),
    ("Attack on Titan Cilt 1", "Hajime Isayama", "comics", "tr", "Devlerle savaşan insanlığın destansı hikayesi."),

    # ── Şiir ──
    ("Bütün Şiirleri", "Orhan Veli Kanık", "poetry", "tr", "Türk şiirinin yenilikçi şairinin tüm eserleri."),
    ("Memleketimden İnsan Manzaraları", "Nazım Hikmet", "poetry", "tr", "Nazım Hikmet'in başyapıtı, bir dönemin destanı."),
    ("Kuvayi Milliye", "Nazım Hikmet", "poetry", "tr", "Kurtuluş Savaşı'nı anlatan epik şiir."),
    ("Saat 21.00 Şiirleri", "Cemal Süreya", "poetry", "tr", "Modern Türk şiirinin önemli eserlerinden biri."),
    ("Ben Sana Mecburum", "Attila İlhan", "poetry", "tr", "Attila İlhan'ın en bilinen şiir kitabı."),
    ("Hüzün Şiirleri", "Cemal Safi", "poetry", "tr", "Türk şiirinde hüzün temasının önemli örneği."),
    ("Şiirler", "Özdemir Asaf", "poetry", "tr", "Kısa ve özlü şiirleriyle tanınan şairin eserleri."),
    ("Daktiloya Çekilmiş Şiirler", "Turgut Uyar", "poetry", "tr", "İkinci Yeni akımının önemli şairinden şiirler."),
    ("Gül Yetiştiren Adam", "Rasim Özdenören", "poetry", "tr", "Anlam arayışı ve içsel yolculuk üzerine derin şiirler."),
    ("Bütün Şiirleri", "Can Yücel", "poetry", "tr", "Halk şiiri geleneğini modern şiirle birleştiren ustanın eserleri."),

    # ── Diğer (Deneme, Öykü, Gezi) ──
    ("Kayıp Tanrılar Ülkesi", "Ahmet Ümit", "other", "tr", "Antalya'da geçen tarihi bir polisiye roman."),
    ("Ömer Seyfettin Hikayeleri", "Ömer Seyfettin", "other", "tr", "Türk hikayeciliğinin kurucu isminden seçme öyküler."),
    ("Beyhude Ömrüm", "İbrahim Balcı", "other", "tr", "Bir Anadolu köyünde geçen hayat mücadelesi."),
    ("İstanbul Üçlemesi: Şehir Hatıraları", "M. Şevket Eygi", "other", "tr", "İstanbul'un geçmişine dair hatıralar ve gözlemler."),
    ("Boğaz'daki Define", "İsmail Bilgin", "other", "tr", "Tarihi gizem ve macera romanı."),
    ("Dünya Klasikleri Masalları", "Kolektif", "other", "tr", "Dünya edebiyatından seçme masallar."),
    ("Kayıp Kıta Mu", "James Churchward", "other", "tr", "Kayıp kıta Mu üzerine araştırma kitabı."),
    ("Puslu Kıtalar Atlası", "İhsan Oktay Anar", "other", "tr", "Gerçeklik ve kurguyu harmanlayan postmodern roman."),
    ("Hapı Yuttuk Eczanesi", "Mert Arık", "other", "tr", "Mizahi bir dille yazılmış eczane anıları."),
    ("Genel Kültür Kitabım - Konuşuyorum", "Çağrı Odabaşı", "other", "tr", "Çocuklar için genel kültür ve konuşma becerileri kitabı."),
]

# ── S3 Config ──
S3_CONFIG = {
    "endpoint_url": "http://minio:9000",
    "external_endpoint": "http://192.168.8.199:9100",
    "bucket": "meetbook-photos",
    "access_key": "meetbook_minio",
    "secret_key": "meetbook_minio_dev",
}


# ── Helpers ──

def random_location_near_denizli() -> tuple[float, float]:
    lat_offset = random.uniform(-0.045, 0.045)
    lng_offset = random.uniform(-0.045, 0.045)
    return DENIZLI_LAT + lat_offset, DENIZLI_LNG + lng_offset


def blur_location(lat: float, lng: float, grid: float = 0.01) -> tuple[float, float]:
    return round(lat / grid) * grid, round(lng / grid) * grid


async def search_ol_for_book(client: httpx.AsyncClient, title: str, author: str) -> tuple[int | None, str | None]:
    """Search Open Library for a book and return (cover_id, description)."""
    query = f"{title} {author}"
    url = "https://openlibrary.org/search.json"
    params = {"q": query, "limit": 3, "fields": "cover_i,key,first_publish_year"}
    try:
        resp = await client.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        docs = data.get("docs", [])
        if docs:
            cover_id = docs[0].get("cover_i")
            return cover_id, None
    except Exception as e:
        logger.warning(f"  ⚠ OL search failed for '{title}': {e}")
    return None, None


async def download_cover(client: httpx.AsyncClient, cover_id: int) -> bytes | None:
    for size in ["L", "M"]:
        url = f"https://covers.openlibrary.org/b/id/{cover_id}-{size}.jpg"
        try:
            resp = await client.get(url, timeout=15.0)
            if resp.status_code == 200 and len(resp.content) > 500:
                return resp.content
        except Exception:
            continue
    return None


async def upload_to_minio(book_id: uuid.UUID, cover_bytes: bytes) -> str | None:
    import aioboto3
    from botocore.config import Config

    filename = f"{uuid.uuid4()}.jpg"
    key = f"books/{book_id}/{filename}"

    try:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=S3_CONFIG["endpoint_url"],
            aws_access_key_id=S3_CONFIG["access_key"],
            aws_secret_access_key=S3_CONFIG["secret_key"],
            config=Config(signature_version="s3v4"),
        ) as s3:
            await s3.put_object(
                Bucket=S3_CONFIG["bucket"],
                Key=key,
                Body=cover_bytes,
                ContentType="image/jpeg",
            )

        external = S3_CONFIG["external_endpoint"]
        return f"{external}/{S3_CONFIG['bucket']}/{key}"
    except Exception as e:
        logger.warning(f"  ⚠ MinIO upload failed: {e}")
        return None


# ── Main Seeding ──

async def seed() -> int:
    print("=" * 70)
    print("  MeetBook — Türkiye'nin En Çok Okunan 100 Kitabı")
    print("=" * 70)

    # ── 1. Fetch cover IDs from Open Library ──
    print("\n── Fetching cover info from Open Library ─────────────────────────")
    async with httpx.AsyncClient() as client:
        cover_map = {}
        for idx, (title, author, cat, lang, desc) in enumerate(TOP_100_BOOKS, 1):
            cover_id, _ = await search_ol_for_book(client, title, author)
            if cover_id:
                cover_map[idx] = cover_id
            if idx % 20 == 0:
                logger.info(f"  Checked {idx}/100 books")
            await asyncio.sleep(0.2)
        logger.info(f"  Found covers for {len(cover_map)} books")

    # ── 2. Delete old seed books ──
    print("\n── Cleaning up old seed books ────────────────────────────────────")
    try:
        import asyncpg
        conn = await asyncpg.connect(
            user="meetbook", password="meetbook_dev", host="db", port=5432, database="meetbook"
        )

        # Delete books that don't match the old demo books (keep only 6 originals)
        old_ids_res = await conn.fetch("""
            SELECT id FROM books WHERE deleted_at IS NULL 
            AND title IN ('A', 'D', 'Test4', 'The Hobbit', '1984', 'Hayvan Çiftliği')
        """)
        keep_ids = [r['id'] for r in old_ids_res]

        # Soft-delete all other non-deleted books
        result = await conn.execute("""
            UPDATE books SET deleted_at = NOW() 
            WHERE deleted_at IS NULL AND id != ALL($1::uuid[])
        """, keep_ids)
        logger.info(f"  ✓ Old seed books removed")

        # Also delete their photos
        await conn.execute("""
            DELETE FROM book_photos WHERE book_id NOT IN (SELECT id FROM books WHERE deleted_at IS NULL)
        """)
        logger.info(f"  ✓ Orphaned photos cleaned")

    except Exception as e:
        logger.error(f"  ✗ Cleanup failed: {e}")
        return 1

    # ── 3. Insert new books ──
    print(f"\n── Seeding 100 books ────────────────────────────────────────────")
    async with httpx.AsyncClient() as client:
        seeded = 0
        photos = 0

        for idx, (title, author, category, lang, description) in enumerate(TOP_100_BOOKS, 1):
            book_id = uuid.uuid4()
            owner_id = uuid.UUID(random.choice(USERS))
            condition = random.choice(CONDITIONS)

            # Location near Denizli
            lat, lng = random_location_near_denizli()
            pub_lat, pub_lng = blur_location(lat, lng)
            loc_wkt = f"SRID=4326;POINT({lng} {lat})"
            pub_wkt = f"SRID=4326;POINT({pub_lng} {pub_lat})"
            now = datetime.now(timezone.utc)
            isbn = f"978{random.randint(100000000, 999999999)}"

            try:
                await conn.execute("""
                    INSERT INTO books (id, owner_id, title, author, isbn, description,
                                      category, language, condition, is_available,
                                      location, public_location, view_count, favorite_count,
                                      created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                           $11::geography, $12::geography, 0, 0, $13, $14)
                """, book_id, owner_id, title[:200], author[:200] if author else None,
                    isbn[:20], description[:2000] if description else None,
                    category, lang[:10], condition, True,
                    loc_wkt, pub_wkt, now, now)

                # Try to get cover
                if idx in cover_map:
                    cover_bytes = await download_cover(client, cover_map[idx])
                    if cover_bytes:
                        url = await upload_to_minio(book_id, cover_bytes)
                        if url:
                            await conn.execute("""
                                INSERT INTO book_photos (id, book_id, url, position, created_at)
                                VALUES ($1, $2, $3, 0, $4)
                            """, uuid.uuid4(), book_id, url, now)
                            photos += 1

                seeded += 1
                if idx % 10 == 0 or idx == 100:
                    logger.info(f"  {idx}/{100} seeded ({photos} photos)")

            except Exception as e:
                logger.warning(f"  ⚠ Failed to insert '{title}': {e}")

    # ── 4. Summary ──
    print(f"\n{'=' * 70}")
    total = await conn.fetchval("SELECT COUNT(*) FROM books WHERE deleted_at IS NULL")
    photo_total = await conn.fetchval("SELECT COUNT(*) FROM book_photos")
    cats = await conn.fetch("""
        SELECT category, COUNT(*) as cnt FROM books 
        WHERE deleted_at IS NULL GROUP BY category ORDER BY cnt DESC
    """)

    print(f"  ✅ İşlem Tamam!")
    print(f"  📚 Toplam kitap: {total}")
    print(f"  📸 Fotoğraf: {photo_total}")
    print(f"  📍 Konum: Denizli ({DENIZLI_LAT}, {DENIZLI_LNG})")
    print(f"\n  Kategori dağılımı:")
    for row in cats:
        print(f"    • {row['category']}: {row['cnt']}")

    await conn.close()
    return 0


def main() -> int:
    return asyncio.run(seed())


if __name__ == "__main__":
    sys.exit(main())
