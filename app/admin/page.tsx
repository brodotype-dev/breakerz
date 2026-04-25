import { redirect } from 'next/navigation';

// Admin index now lives at /admin/products. Redirect for any old links/bookmarks.
export default function AdminIndex() {
  redirect('/admin/products');
}
