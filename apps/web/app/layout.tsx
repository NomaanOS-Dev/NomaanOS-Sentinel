import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NomaanOS Sentinel — Threat Detection & Response',
  description: 'AI-assisted security monitoring and investigation platform for MSPs and IT consultancies.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-cyan-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}

