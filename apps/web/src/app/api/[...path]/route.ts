import { proxyRequest } from '../../../lib/api-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = (request: Request) => proxyRequest(request);
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
