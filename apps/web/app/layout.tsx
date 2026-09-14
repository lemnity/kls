import type { Metadata } from 'next';
import { Rubik } from 'next/font/google';
import './styles.css';
import { ThemeScript } from './theme-script.js';

const rubik = Rubik({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-rubik',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Платформа КУЛИСА — пульт постановки',
  description: 'Учебный контур системы управления театральной постановкой.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={rubik.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
