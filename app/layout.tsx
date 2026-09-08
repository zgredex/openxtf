import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenXTF — XT 글꼴 만들기',
  description: '브라우저에서 XTF 및 레거시 BIN 글꼴을 로컬로 만드세요.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
