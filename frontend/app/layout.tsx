import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DropBox-lite | Fast, Ephemeral File Sharing',
  description: 'Share files temporarily with automatic expiration and zero persistent tracking. Built serverless with AWS.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased flex flex-col min-h-screen text-slate-800">
        <header className="w-full border-b border-slate-200/80 bg-white/70 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20 group-hover:scale-105 transition-transform">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-slate-900 tracking-tight text-lg leading-tight">DropBox<span className="text-sky-600">-lite</span></span>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Serverless Ephemeral Transfer</span>
              </div>
            </a>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Serverless Ready
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
          {children}
        </main>

        <footer className="w-full border-t border-slate-200 bg-white/50 py-6 text-center text-xs text-slate-500">
          <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p>DropBox-lite &bull; Ephemeral Files Automatically Expire via AWS DynamoDB TTL</p>
            <p className="text-slate-400">AWS Lambda &bull; S3 &bull; CloudFront OAC</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
