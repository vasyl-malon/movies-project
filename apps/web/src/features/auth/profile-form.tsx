'use client';
import { useState } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { PRESET_AVATARS, type ProfileView } from '@tracker/contracts';
import { writeProfileForCurrentSession } from './profile-cache';
import { apiFetch, ApiError } from '../../lib/api-client';
import { PresetAvatar } from '../../components/preset-avatar';
import { ThemeToggle } from '../../components/theme-provider';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
export function ProfileSettings() {
  const client = useQueryClient();
  const session = client.getQueriesData<{ user: { id: string } }>({ queryKey: ['auth','current-session'] }).find(([,value]) => value?.user)?.[1];
  const profile = useQuery({ queryKey: ['user',session?.user.id,'profile'], queryFn: ({ signal }) => apiFetch<ProfileView>('/me', { signal }), staleTime: Infinity });
  if (!profile.data) return null;
  return <ProfileForm key={profile.data.id} profile={profile.data} />;
}
function ProfileForm({ profile }: { profile: ProfileView }) {
  const client = useQueryClient(); const [name,setName] = useState(profile.displayName); const [username,setUsername] = useState(profile.username); const [avatar,setAvatar] = useState(profile.avatar); const [validation,setValidation] = useState('');
  const mutation = useMutation({ mutationFn: (body: { displayName: string; avatar: string; username?: string }) => apiFetch<ProfileView>('/me', { method: 'PATCH', body }), onSuccess: updated => {
    if (writeProfileForCurrentSession(client, updated)) {
      setUsername(updated.username); setName(updated.displayName);
    }
  } });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setValidation(''); mutation.reset();
    const canonical = username.toLowerCase(); const changed = canonical !== profile.username;
    if (changed && !/^[a-z0-9_]{3,30}$/.test(canonical)) { setValidation('Use 3–30 letters, numbers, or underscores for your username.'); return; }
    if (!name.trim()) { setValidation('Enter a display name.'); return; }
    mutation.mutate({ displayName: name.trim(), avatar, ...(changed ? { username: canonical } : {}) });
  }
  return <><div className="page-heading"><span className="eyebrow">MAKE YOURSELF AT HOME</span><h1>Account settings<span>.</span></h1><p>A few details that make this space yours.</p></div><div className="settings-grid"><Card className="profile-card"><CardHeader><CardTitle>Your profile</CardTitle><CardDescription>How you appear to other signed-in members.</CardDescription></CardHeader><CardContent><form onSubmit={submit} className="account-form"><div className="profile-preview"><PresetAvatar avatar={avatar} className="large"/><div><strong>{name || 'Your name'}</strong><span>@{username}</span></div><span className="preview-label">PREVIEW</span></div><fieldset><legend>Choose your avatar</legend><div className="avatar-options">{PRESET_AVATARS.map(value => <label key={value} className="avatar-option"><input type="radio" name="avatar" value={value} checked={avatar === value} onChange={() => setAvatar(value)} /><PresetAvatar avatar={value}/><span>{value.charAt(0).toUpperCase()+value.slice(1)}</span></label>)}</div></fieldset><div className="field"><Label htmlFor="displayName">Display name</Label><Input id="displayName" value={name} required maxLength={80} autoComplete="name" onChange={e => { setName(e.target.value); mutation.reset(); }} /></div><div className="field"><Label htmlFor="username">Username</Label><Input id="username" value={username} required maxLength={30} autoComplete="username" onChange={e => { setUsername(e.target.value); mutation.reset(); }} /><p className="field-hint">New usernames use 3–30 letters, numbers, or underscores.</p></div>{(validation || mutation.error) && <p role="alert" className="form-error">{validation || (mutation.error instanceof ApiError && mutation.error.status === 409 ? 'That username is taken. Try another.' : 'We couldn’t save your profile. Please try again.')}</p>}{mutation.isSuccess && <p role="status" className="form-success">Profile saved.</p>}<div className="form-footer"><span>Small details. Your own character.</span><Button disabled={mutation.isPending} type="submit">{mutation.isPending ? 'Saving…' : 'Save profile'}</Button></div></form></CardContent></Card><div className="settings-side"><Card><CardHeader><CardTitle>Set the mood</CardTitle><CardDescription>Lights down for movie night.<br/>Or a brighter view for the daytime.</CardDescription></CardHeader><CardContent className="appearance-control"><span>Appearance</span><ThemeToggle /></CardContent></Card><div className="settings-note"><span className="eyebrow">CURATED BY YOU</span><p>Every great collection<br/>starts with a point<br/><em>of view.</em></p><span className="note-rule" /><span>THIS ONE IS YOURS.</span></div></div></div></>;
}
