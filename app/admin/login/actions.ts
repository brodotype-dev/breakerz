'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function login(formData: FormData) {
  const password = formData.get('password') as string;

  if (!password || password.trim() !== process.env.ADMIN_PASSWORD?.trim()) {
    redirect('/admin/login?error=1');
  }

  const cookieStore = await cookies();
  cookieStore.set('admin_session', process.env.ADMIN_SESSION_SECRET!, {
    httpOnly: true,
    path: '/admin',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  redirect('/admin');
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete('admin_session');
  redirect('/admin/login');
}
