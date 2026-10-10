'use client';
import { createAuthClient } from 'better-auth/react';
import { usernameClient } from 'better-auth/client/plugins';
import { isProfileUsername } from '../profiles/links';
export const authClient = createAuthClient({ basePath: '/api/auth', plugins: [usernameClient()], fetchOptions: { credentials: 'same-origin', cache: 'no-store' } });
export function safeDestination(value: string | null | undefined) {
  if (value && /^\/titles\/tt\d{7,10}$/.test(value)) return value;
  if (value?.startsWith('/profiles/') && isProfileUsername(value.slice('/profiles/'.length))) {
    return value;
  }
  return ['/settings','/search','/my-list','/feed','/friends'].includes(value ?? '') ? value! : '/settings';
}
export function accountError(error: { code?: string; status?: number } | null | undefined) {
  if (error?.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (error?.code === 'EMAIL_NOT_VERIFIED') return 'Verify your email before signing in. You can request a new link below.';
  if (error?.code === 'INVALID_EMAIL_OR_PASSWORD') return 'Email or password is incorrect. Please try again.';
  if (error?.code?.includes('USERNAME')) return 'That username is unavailable. Choose another username.';
  if (error?.code === 'USER_ALREADY_EXISTS' || error?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') return 'An account could not be created with these details. Try signing in or use another email.';
  return 'We couldn’t complete this request. Please try again.';
}
