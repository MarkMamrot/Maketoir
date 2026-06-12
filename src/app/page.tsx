// src/app/page.tsx
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export default function Home() {
  const session = cookies().get('marketoir_session');
  if (session?.value) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
