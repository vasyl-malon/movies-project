'use client';
import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';
const subscribe = (callback: () => void) => { window.addEventListener('theme-change', callback); return () => window.removeEventListener('theme-change', callback); };
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', () => 'dark');
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
    try { localStorage.setItem('tracker-theme', next); } catch { /* Theme still works without storage. */ }
    window.dispatchEvent(new Event('theme-change'));
  }
  return <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>;
}
