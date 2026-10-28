import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DropWindow | Serverless Ephemeral File Sharing',
  description: 'Fast, anonymous, temporary file transfers that automatically self-destruct. Built 100% serverless on AWS.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased flex flex-col min-h-screen text-slate-900 bg-slate-50/50 relative overflow-x-hidden">
        {/* Background Ambient Glow Elements */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-tr from-sky-400/15 via-indigo-400/15 to-violet-400/15 rounded-full blur-3xl animate-pulse-slow"></div>
          <div className="absolute top-1/2 -right-40 w-96 h-96 bg-sky-300/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-10 -left-40 w-96 h-96 bg-indigo-300/10 rounded-full blur-3xl"></div>
          <div className="absolute inset-0 bg-grid-pattern opacity-40"></div>
        </div>

        {/* Floating Glassmorphism Header */}
        <header className="w-full border-b border-slate-200/70 bg-white/75 backdrop-blur-xl sticky top-0 z-50 transition-all">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <a href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-sky-500/25 group-hover:scale-105 group-hover:shadow-sky-500/40 transition-all duration-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-900 tracking-tight text-lg leading-tight group-hover:text-sky-600 transition-colors">
                    Drop<span className="text-sky-600">Window</span>
                  </span>
                  <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200/60">
                    Ephemeral
                  </span>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Zero-Server File Transfer
                </span>
              </div>
            </a>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/80 text-slate-700 border border-slate-200/80 shadow-sm backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>AWS ap-south-1</span>
              </div>
              <a
                href="/"
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm hover:shadow"
              >
                + New Drop
              </a>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col justify-center relative z-10">
          {children}
        </main>

        {/* Modern Footer */}
        <footer className="w-full border-t border-slate-200/70 bg-white/60 backdrop-blur-md py-6 text-xs text-slate-500 relative z-10">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-slate-600">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
              <span>DropWindow &bull; Ephemeral Files Auto-Purged via DynamoDB TTL & S3 Lifecycle</span>
            </div>
            <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
              <span>AWS Lambda (arm64)</span>
              <span>&bull;</span>
              <span>Amazon S3</span>
              <span>&bull;</span>
              <span>DynamoDB</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
