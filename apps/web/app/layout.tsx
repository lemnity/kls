import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Платформа КУЛИСА — пульт постановки',
  description: 'Учебный контур системы управления театральной постановкой.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
