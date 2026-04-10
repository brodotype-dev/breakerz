'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getUserRoles } from '@/lib/auth';

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  let from = (formData.get('from') as string) || '/admin';
  // Prevent open redirect — only allow relative paths
  if (!from.startsWith('/') || from.startsWith('//')) from = '/admin';

  if (!email || !password) {
    redirect(`/admin/login?error=missing&from=${encodeURIComponent(from)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect(`/admin/login?error=invalid&from=${encodeURIComponent(from)}`);
  }

  // Verify the user has an admin or contributor role
  const roles = await getUserRoles(data.user.id);
  if (roles.length === 0) {
    await supabase.auth.signOut();
    redirect(`/admin/login?error=unauthorized&from=${encodeURIComponent(from)}`);
  }

  redirect(from);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/admin/login');
}
