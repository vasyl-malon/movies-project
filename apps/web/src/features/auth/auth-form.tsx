'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Film, LockKeyhole, Mail, Check } from 'lucide-react';
import { authClient, accountError, safeDestination } from './client';
import { useSessionLifecycle } from '../../app/providers';
import { Brand } from '../../components/app-shell';
import { ThemeToggle } from '../../components/theme-provider';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
export type AuthMode = 'sign-in' | 'sign-up' | 'verify-email' | 'forgot-password' | 'reset-password';
const copy = {
  'sign-in': ['Welcome back','The stories you love are waiting for you.'],
  'sign-up': ['Start your story','A home for everything you watch. And everything next.'],
  'verify-email': ['Check your inbox','One last step before the opening credits.'],
  'forgot-password': ['Forgot your password?','We’ll send you a link to get back to your screening room.'],
  'reset-password': ['A fresh start','Choose a new password for your account.'],
};
export function AuthForm({ mode, params = {} }: { mode: AuthMode; params?: Record<string, string | undefined> }) {
  const router = useRouter(); const lifecycle = useSessionLifecycle();
  const [email, setEmail] = useState(params.email ?? ''); const [password, setPassword] = useState('');
  const [username, setUsername] = useState(''); const [name, setName] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const verified = mode === 'verify-email' && params.verified === '1' && !params.error;
  const invalidLink = !!params.error || (mode === 'reset-password' && !params.token);
  const title = verified ? 'Email verified' : mode === 'verify-email' && invalidLink ? 'This link has expired' : mode === 'reset-password' && invalidLink ? 'Request a fresh link' : copy[mode][0];
  const verificationURL = () => `${window.location.origin}/verify-email?verified=1`;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess('');
    if (mode === 'sign-up' && !/^[a-z0-9_]{3,30}$/.test(username.toLowerCase())) { setError('Use 3–30 letters, numbers, or underscores for your username.'); return; }
    setPending(true);
    try {
      if (mode === 'sign-in') {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) { setError(accountError(result.error)); return; }
        lifecycle.resume(); router.replace(safeDestination(params.next));
      } else if (mode === 'sign-up') {
        const result = await authClient.signUp.email({ email, password, name, username: username.toLowerCase(), callbackURL: verificationURL() });
        if (result.error) { setError(accountError(result.error)); return; }
        router.replace(`/verify-email?email=${encodeURIComponent(email)}`);
      } else if (mode === 'verify-email') {
        const result = await authClient.sendVerificationEmail({ email, callbackURL: verificationURL() });
        if (result.error) { setError(accountError(result.error)); return; }
        setSuccess('If this account needs verification, a new link is on its way. Check your inbox.');
      } else if (mode === 'forgot-password') {
        const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
        if (result.error) { setError(accountError(result.error)); return; }
        setSuccess('If an account exists for this email, a reset link is on its way.');
      } else {
        const result = await authClient.resetPassword({ newPassword: password, token: params.token! });
        if (result.error) { setError('This reset link has expired or has already been used. Request a fresh link.'); return; }
        lifecycle.revoke(); setSuccess('Password updated. Sign in with your new password.'); setPassword('');
      }
    } catch { setError('We couldn’t connect. Please try again.'); }
    finally { setPending(false); }
  }
  const hasForm = !verified && !(mode === 'reset-password' && (invalidLink || success));
  return <div className="auth-page"><header className="auth-header"><Brand /><div className="header-actions"><span className="auth-header-note">A life in frames.</span><ThemeToggle /></div></header><main id="main-content" className="auth-main"><section className="auth-editorial" aria-label="About Frame"><div className="editorial-tag"><span /> FOR THE LOVE OF THE SCREEN</div><h2>Good stories<br/>stay with you.<br/><em>Keep them close.</em></h2><p>Your films. Your series. Your point of view.<br/>Make a little space for the stories that matter.</p><div className="film-art" aria-hidden="true"><div className="film-window"><Film size={46}/><span>YOUR NEXT<br/>GREAT STORY</span></div><div className="film-ticket"><span>ADMIT ONE</span><b>FRAME CINEMA</b><span>∞ &nbsp; STORIES TO DISCOVER</span></div></div><div className="editorial-footer"><span>01 / THE OPENING SCENE</span><span>● ● ○</span></div></section><section className="auth-panel"><div className="auth-icon">{verified ? <Check /> : mode.includes('password') ? <LockKeyhole /> : <Mail />}</div><span className="eyebrow">{mode === 'sign-up' ? 'MAKE IT YOURS' : 'YOUR PERSONAL SCREENING ROOM'}</span><h1>{title}</h1><p className="auth-description">{verified ? 'You’re all set. Sign in to make yourself at home.' : invalidLink ? 'Links are time limited. Request a new one to continue.' : copy[mode][1]}</p>{error && <p className="form-error" role="alert" id="form-error">{error}</p>}{success && <p className="form-success" role="status">{success}</p>}{hasForm && <form onSubmit={submit} className="account-form" aria-describedby={error ? 'form-error' : undefined}>
    {mode === 'sign-up' && <><div className="field"><Label htmlFor="displayName">Display name</Label><Input id="displayName" autoComplete="name" maxLength={80} required value={name} onChange={e => setName(e.target.value)} placeholder="How should we call you?" /></div><div className="field"><Label htmlFor="username">Username</Label><Input id="username" autoComplete="username" required minLength={3} maxLength={30} value={username} onChange={e => setUsername(e.target.value)} placeholder="your_screen_name" /><p className="field-hint">3–30 letters, numbers, or underscores.</p></div></>}
    {mode !== 'reset-password' && <div className="field"><Label htmlFor="email">Email</Label><Input id="email" autoComplete="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>}
    {(mode === 'sign-in' || mode === 'sign-up' || mode === 'reset-password') && <div className="field"><div className="field-row"><Label htmlFor="password">{mode === 'reset-password' ? 'New password' : 'Password'}</Label>{mode === 'sign-in' && <Link href="/forgot-password">Forgot password?</Link>}</div><Input id="password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required minLength={mode === 'sign-in' ? 1 : 8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'sign-in' ? 'Your password' : 'At least 8 characters'} /></div>}
    <Button className="submit-button" disabled={pending} type="submit">{pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : mode === 'verify-email' ? 'Send new verification link' : mode === 'forgot-password' ? 'Send reset link' : 'Update password'}{!pending && <ArrowRight />}</Button>
  </form>}{verified && <Button asChild className="submit-button"><Link href="/sign-in">Continue to sign in <ArrowRight /></Link></Button>}{mode === 'sign-in' && <p className="auth-secondary">New to Frame? <Link href="/sign-up">Create an account</Link><br/><Link href="/verify-email">Need a new verification link?</Link></p>}{mode === 'sign-up' && <p className="auth-secondary">Already have an account? <Link href="/sign-in">Sign in</Link></p>}{mode === 'reset-password' && <p className="auth-secondary"><Link href="/forgot-password">Request a fresh reset link</Link><br/><Link href="/sign-in">Back to sign in</Link></p>}{(mode === 'verify-email' || mode === 'forgot-password') && !verified && <p className="auth-secondary"><Link href="/sign-in">Back to sign in</Link></p>}<div className="auth-footnote"><LockKeyhole size={13}/><span>Your story is yours. Keep it that way.</span></div></section></main><footer className="auth-footer"><span>FRAME — A PLACE FOR YOUR STORIES</span><span>Made for the credits, and everything before.</span></footer></div>;
}
