import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import './styles.css';

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Платформа КУЛИСА — пульт постановки',
  description: 'Учебный контур системы управления театральной постановкой.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
