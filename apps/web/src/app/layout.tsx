import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
export const metadata: Metadata = { title: 'Frame — Your personal screening room', description: 'A home for the films and series you love.' };
const themeScript = `try{if(localStorage.getItem('tracker-theme')==='light'){document.documentElement.dataset.theme='light';document.documentElement.classList.remove('dark')}}catch{}`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><a href="#main-content" className="skip-link">Skip to content</a><Providers>{children}</Providers></body></html>;
}
