import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_KEEPER_API_BASE_URL = 'http://localhost:8787';

function getKeeperApiBaseUrl() {
  const configured = process.env.KEEPER_API_BASE_URL;
  return (configured || DEFAULT_KEEPER_API_BASE_URL).trim().replace(/\/$/, '');
}

export async function GET(request: NextRequest) {
  const userAddress = request.nextUrl.searchParams.get('userAddress');
  const limit = request.nextUrl.searchParams.get('limit') || '10';
  const offset = request.nextUrl.searchParams.get('offset');
  const page = request.nextUrl.searchParams.get('page');
  const status = request.nextUrl.searchParams.get('status');
  const sort = request.nextUrl.searchParams.get('sort');

  const url = new URL(`${getKeeperApiBaseUrl()}/recipes/logs`);
  url.searchParams.set('limit', limit);
  if (offset) {
    url.searchParams.set('offset', offset);
  }
  if (page) {
    url.searchParams.set('page', page);
  }
  if (userAddress) {
    url.searchParams.set('userAddress', userAddress);
  }
  if (status) {
    url.searchParams.set('status', status);
  }
  if (sort) {
    url.searchParams.set('sort', sort);
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    });

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !data) {
      const errorMessage =
        data && typeof data.error === 'string'
          ? data.error
          : `Failed to fetch logs from keeper (${response.status}).`;
      return NextResponse.json({ success: false, error: errorMessage, logs: [] }, { status: 200 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown logs fetch error';
    return NextResponse.json({ success: false, error: message, logs: [] }, { status: 200 });
  }
}
