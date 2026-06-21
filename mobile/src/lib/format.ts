import { conditionLabels } from '@/components/ui/card';

const CATEGORIES: Record<string, string> = {
  fiction: 'Roman',
  non_fiction: 'Bilim',
  textbook: 'Ders',
  comics: 'Çizgi Roman',
  children: 'Çocuk',
  poetry: 'Şiir',
  other: 'Diğer',
};

const TIME_SEGMENTS = [
  { label: 'yıl', seconds: 31536000 },
  { label: 'ay', seconds: 2592000 },
  { label: 'hafta', seconds: 604800 },
  { label: 'gün', seconds: 86400 },
  { label: 'saat', seconds: 3600 },
  { label: 'dakika', seconds: 60 },
] as const;

export function categoryLabel(cat: string): string {
  return CATEGORIES[cat] ?? cat;
}

export { conditionLabels };

export function conditionLabel(cond: string): string {
  return conditionLabels[cond as keyof typeof conditionLabels] ?? cond;
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 0) return 'az önce';
  if (diffSec < 60) return 'az önce';
  for (const seg of TIME_SEGMENTS) {
    const count = Math.floor(diffSec / seg.seconds);
    if (count >= 1) return `${count} ${seg.label} önce`;
  }
  return 'uzun zaman önce';
}

export function formatStats(views: number, favorites: number): string {
  const parts: string[] = [];
  if (views > 0) parts.push(`${views} görüntülenme`);
  if (favorites > 0) parts.push(`${favorites} favori`);
  return parts.join(' · ');
}
