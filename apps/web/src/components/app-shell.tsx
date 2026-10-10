'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileView } from '@tracker/contracts';
import { Film, Search, Bookmark, Radio, Users, Settings, LogOut, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { authClient } from '../features/auth/client';
import { apiFetch } from '../lib/api-client';
import { logout, useSessionLifecycle } from '../app/providers';
import { ThemeToggle } from './theme-provider';
import { PresetAvatar } from './preset-avatar';
import { Button } from './ui/button';
const navigation = [['/search','Search',Search],['/my-list','My List',Bookmark],['/feed','Feed',Radio],['/friends','Friends',Users],['/settings','Settings',Settings]] as const;
export function Brand() { return <Link className="brand" href="/settings"><span className="brand-mark"><Film size={23} /></span>Frame<span className="brand-dot">.</span></Link>; }
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const client = useQueryClient(); const lifecycle = useSessionLifecycle();
  const [signingOut, setSigningOut] = useState(false);
  const session = useQuery({ queryKey: ['auth','current-session',pathname], queryFn: async () => { const result = await authClient.getSession({ query: { disableCookieCache: true } }); if (result.error) throw new Error('Session check failed'); return result.data; }, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchInterval: 15000, enabled: !lifecycle.revoked && !signingOut });
  const id = session.data?.user.emailVerified ? session.data.user.id : undefined;
  const profile = useQuery({ queryKey: ['user',id,'profile'], queryFn: ({ signal }) => apiFetch<ProfileView>('/me', { signal }), enabled: !!id && !lifecycle.revoked && !signingOut, staleTime: 0, refetchOnMount: 'always' });
  const unavailable = lifecycle.revoked || (!session.isPending && !session.error && !id);
  useEffect(() => { if (unavailable) { lifecycle.revoke(); router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`); } }, [unavailable, pathname, router, lifecycle]);
  async function signOut() { setSigningOut(true); lifecycle.revoke(); try { await logout(client); } catch { /* Cache and UI still close if the network fails. */ } finally { authClient.$store.notify('$sessionSignal'); router.replace('/sign-in'); } }
  const loading = <main className="session-loading" role="status"><LoaderCircle className="animate-spin" />Checking your session…</main>;
  const failure = <main className="session-loading"><p role="alert">We couldn’t check your account. Please try again.</p><Button onClick={() => { void session.refetch(); if (id) void profile.refetch(); }}>Retry</Button></main>;
  if (unavailable || signingOut || session.isPending) return loading;
  if (session.error) return failure;
  if (profile.isPending) return loading;
  if (profile.error || !profile.data) return failure;
  // Keep unsaved input mounted during fresh rechecks, while hiding all private UI.
  const refreshing = session.isFetching || profile.isFetching;
  return <><div className="app-frame" style={refreshing ? { display: 'none' } : undefined} inert={refreshing}><aside className="sidebar"><Brand /><p className="nav-caption">YOUR SCREENING ROOM</p><nav aria-label="Main navigation">{navigation.map(([href,label,Icon]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}><Icon size={19} />{label}{pathname === href && <span className="nav-dot" />}</Link>)}</nav><div className="sidebar-note"><span className="eyebrow">A LITTLE LESS SCROLLING.</span><p>A little more cinema.</p><ArrowUpRight size={22} /></div><div className="sidebar-account"><PresetAvatar avatar={profile.data.avatar} /><div><strong>{profile.data.displayName}</strong><span>@{profile.data.username}</span></div></div></aside><div className="app-main"><header className="app-header"><span className="mobile-brand"><Brand /></span><span className="header-label">Your next great story starts here.</span><div className="header-actions"><ThemeToggle /><Button variant="ghost" onClick={signOut}><LogOut /> <span>Sign out</span></Button></div></header><main id="main-content" className="page-content">{children}</main><nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(([href,label,Icon]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}><Icon size={19}/><span>{label}</span></Link>)}</nav></div></div>{refreshing && loading}</>;
}
