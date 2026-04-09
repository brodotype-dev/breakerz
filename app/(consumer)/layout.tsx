import { redirect } from 'next/navigation';
import { getCurrentUser, getUserRoles } from '@/lib/auth';
import ConsumerNav from './ConsumerNav';

export default async function ConsumerLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user && process.env.NODE_ENV !== 'development') redirect('/waitlist');

  const roles = user ? await getUserRoles(user.id) : [];
  const isAdmin = roles.some(r => r === 'admin' || r === 'contributor');

  const showNav = !!user || process.env.NODE_ENV === 'development';

  return (
    <>
      {showNav && <ConsumerNav isAdmin={isAdmin} />}
      {children}
    </>
  );
}
