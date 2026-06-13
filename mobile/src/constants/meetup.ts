import type { MeetupValidationStatus } from '@/lib/api/client';

/** Mirrors `SAFE_CATEGORIES` in `backend/app/modules/places/service.py`. */
export const SAFE_MEETUP_CATEGORIES = [
  'cafe',
  'library',
  'book_store',
  'shopping_mall',
  'university',
  'transit_station',
  'restaurant',
  'park',
] as const;

export const MEETUP_CATEGORY_LABELS: Record<string, string> = {
  cafe: 'Kafe',
  library: 'Kütüphane',
  book_store: 'Kitapçı',
  shopping_mall: 'AVM',
  university: 'Üniversite',
  transit_station: 'Toplu Taşıma İstasyonu',
  restaurant: 'Restoran',
  park: 'Park',
};

export const MEETUP_VALIDATION_LABELS: Record<MeetupValidationStatus, string> = {
  auto: 'Güvenli buluşma noktası',
  warning: 'Önerilmeyen buluşma noktası',
  rejected: 'Reddedildi',
};

export const MEETUP_SAFETY_TITLE = 'Güvenli Buluşma İpuçları';

export const MEETUP_SAFETY_BULLETS = [
  'Buluşma için kafe, kütüphane, kitapçı, AVM veya toplu taşıma istasyonu gibi kalabalık, halka açık yerleri tercih edin.',
  'Mümkünse buluşmaya yanınızda bir arkadaşınızla gidin veya buluşma bilgilerinizi güvendiğiniz biriyle paylaşın.',
  'Kitap takasını gün içinde ve aydınlık saatlerde yapmayı tercih edin.',
  'Karşı tarafla buluşmadan önce uygulama içinden iletişimde kalın, kişisel bilgilerinizi paylaşmayın.',
  'İçinizde bir şüphe oluşursa buluşmayı iptal etmekten veya yerini değiştirmekten çekinmeyin.',
];

export const MEETUP_SAFETY_ACK_LABEL = 'Anladım, devam et';

export const MEETUP_ACKNOWLEDGMENT_WARNING =
  'Bu buluşma noktası önerilen güvenli kategorilerden biri değil. Devam etmeden önce güvenlik ipuçlarını okuyup onaylamanız gerekiyor.';
