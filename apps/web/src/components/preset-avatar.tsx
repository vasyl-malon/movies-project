import { Film, Popcorn, Ticket, UserRound } from 'lucide-react';
import { PRESET_AVATARS } from '@tracker/contracts';
const icons = { default: UserRound, popcorn: Popcorn, film: Film, ticket: Ticket };
export function PresetAvatar({ avatar, className = '' }: { avatar: string; className?: string }) {
  const Icon = icons[PRESET_AVATARS.includes(avatar as typeof PRESET_AVATARS[number]) ? avatar as keyof typeof icons : 'default'];
  return <span className={`avatar ${className}`} aria-hidden="true"><Icon /></span>;
}
