import { AuthForm } from '../../features/auth/auth-form';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const raw = await searchParams;
 const params = Object.fromEntries(Object.entries(raw).map(([key,value]) => [key, typeof value === 'string' ? value : undefined]));
 return <AuthForm mode="verify-email" params={params} />;
}
