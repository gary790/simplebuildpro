import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { ToastContainer } from '@/components/ui/toast';

export const metadata: Metadata = {
  title: {
    default: 'SimpleBuild Pro — Enterprise Website Builder',
    template: '%s | SimpleBuild Pro',
  },
  description: 'Build, preview, and deploy production websites at enterprise scale. AI-powered code editor, real-time preview, one-click deploy.',
  metadataBase: new URL('https://simplebuildpro.com'),
  openGraph: {
    title: 'SimpleBuild Pro',
    description: 'Enterprise Website Builder',
    url: 'https://simplebuildpro.com',
    siteName: 'SimpleBuild Pro',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SimpleBuild Pro',
    description: 'Enterprise Website Builder',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full bg-white text-slate-900 antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
        <ToastContainer />
      </body>
    </html>
  );
}
