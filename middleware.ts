import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL!;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY!;

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Cookie-aware client — required by @supabase/ssr to refresh sessions
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh the session (required — do not remove)
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Protect /admin/* pages (except /admin/login itself)
  const isAdminRoute = pathname.startsWith('/admin') && !pathname.startsWith('/admin/login');
  // Protect /api/admin/* routes
  const isAdminApi = pathname.startsWith('/api/admin');
  // Gate consumer routes — unauthenticated visitors redirected to waitlist
  const isConsumerRoute = pathname.startsWith('/break') || pathname.startsWith('/analysis');

  if ((isAdminRoute || isAdminApi) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/admin/login';
    if (isAdminRoute) loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isConsumerRoute && !user) {
    const waitlistUrl = request.nextUrl.clone();
    waitlistUrl.pathname = '/waitlist';
    return NextResponse.redirect(waitlistUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    '/break/:path*',
    '/analysis/:path*',
  ],
};
