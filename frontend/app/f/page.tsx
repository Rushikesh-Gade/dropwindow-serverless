'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface FileMetadata {
  fileId: string;
  fileName: string;
  size: number;
  contentType: string;
  expiresAt: number;
  createdAt: string;
  downloads: number;
  downloadUrl: string;
}

function SharePageContent() {
  const searchParams = useSearchParams();
  const fileId = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [fileData, setFileData] = useState<FileMetadata | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; seconds: number; totalSeconds: number }>({
    hours: 0,
    minutes: 0,
    seconds: 0,
    totalSeconds: 0
  });

  // Early delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTokenInput, setDeleteTokenInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleted, setIsDeleted] = useState(false);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getFileBadge = (filename: string) => {
    const ext = filename.split('.').pop()?.toUpperCase() || 'FILE';
    if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(ext)) {
      return { label: ext, bg: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    }
    if (['PDF', 'DOC', 'DOCX', 'TXT', 'MD', 'CSV'].includes(ext)) {
      return { label: ext, bg: 'bg-sky-100 text-sky-700 border-sky-200' };
    }
    if (['ZIP', 'TAR', 'GZ', '7Z', 'RAR'].includes(ext)) {
      return { label: ext, bg: 'bg-amber-100 text-amber-700 border-amber-200' };
    }
    if (['MP4', 'MOV', 'AVI', 'MKV', 'MP3', 'WAV'].includes(ext)) {
      return { label: ext, bg: 'bg-purple-100 text-purple-700 border-purple-200' };
    }
    return { label: ext.slice(0, 4), bg: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  useEffect(() => {
    if (!fileId) {
      setLoading(false);
      setErrorStatus(400);
      setErrorMessage('No file ID was provided in the share link.');
      return;
    }

    const getFileUrl =
      process.env.NEXT_PUBLIC_GET_FILE_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      '';

    if (!getFileUrl) {
      setLoading(false);
      setErrorMessage('Configuration error: NEXT_PUBLIC_GET_FILE_URL is not configured.');
      return;
    }

    const fetchFileData = async () => {
      try {
        const res = await fetch(`${getFileUrl}?id=${encodeURIComponent(fileId)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' }
        });

        if (res.status === 410) {
          setErrorStatus(410);
          setErrorMessage('This link has expired');
          return;
        }

        if (res.status === 404) {
          setErrorStatus(404);
          setErrorMessage('File not found or has been deleted');
          return;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to fetch file details (${res.status})`);
        }

        const data: FileMetadata = await res.json();
        setFileData(data);
      } catch (err: any) {
        console.error('Fetch file error:', err);
        setErrorMessage(err.message || 'Error loading file metadata');
      } finally {
        setLoading(false);
      }
    };

    fetchFileData();
  }, [fileId]);

  // Live countdown timer updating every second
  useEffect(() => {
    if (!fileData || !fileData.expiresAt) return;

    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = fileData.expiresAt - now;

      if (remaining <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 });
        setErrorStatus(410);
        setErrorMessage('This link has expired');
        return;
      }

      const hours = Math.floor(remaining / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      const seconds = remaining % 60;

      setTimeLeft({ hours, minutes, seconds, totalSeconds: remaining });
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);

    return () => clearInterval(timer);
  }, [fileData]);

  const handleDeleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileId || !deleteTokenInput.trim()) return;

    setIsDeleting(true);
    setDeleteError('');

    const deleteFileUrl =
      process.env.NEXT_PUBLIC_DELETE_FILE_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      '';

    try {
      const res = await fetch(deleteFileUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          deleteToken: deleteTokenInput.trim()
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Invalid delete token');
      }

      setIsDeleted(true);
      setShowDeleteModal(false);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete file');
    } finally {
      setIsDeleting(false);
    }
  };

  // Loading State
  if (loading) {
    return (
      <div className="w-full max-w-lg mx-auto bg-white/90 backdrop-blur-2xl rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/80 p-10 text-center space-y-4">
        <div className="w-14 h-14 border-4 border-sky-100 border-t-sky-600 rounded-full animate-spin mx-auto shadow-sm" />
        <h2 className="text-xl font-bold text-slate-800">Locating your file...</h2>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          Querying AWS DynamoDB metadata and generating 60-second presigned S3 download credentials.
        </p>
      </div>
    );
  }

  // File Deleted State
  if (isDeleted) {
    return (
      <div className="w-full max-w-lg mx-auto bg-white/90 backdrop-blur-2xl rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/80 p-8 sm:p-10 text-center space-y-6">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-slate-900">File Permanently Deleted</h1>
          <p className="text-sm text-slate-500 max-w-xs mx-auto">
            This file has been purged from Amazon S3 and its record erased from DynamoDB.
          </p>
        </div>
        <a
          href="/"
          className="inline-block px-6 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white font-bold text-sm rounded-2xl shadow-lg shadow-sky-500/20 transition active:scale-95"
        >
          Send a New File
        </a>
      </div>
    );
  }

  // Expired State (410 Gone) or File Not Found (404)
  if (errorStatus === 410 || errorStatus === 404 || errorMessage) {
    const isExpired = errorStatus === 410;
    return (
      <div className="w-full max-w-lg mx-auto bg-white/90 backdrop-blur-2xl rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/80 p-8 sm:p-10 text-center space-y-6">
        <div className={`w-16 h-16 ${isExpired ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'} rounded-2xl mx-auto flex items-center justify-center shadow-lg ${isExpired ? 'shadow-amber-500/20' : 'shadow-rose-500/20'}`}>
          {isExpired ? (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-slate-900">
            {isExpired ? 'This link has expired' : 'File Not Found'}
          </h1>
          <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
            {isExpired
              ? 'This transfer reached its scheduled expiration time and was permanently purged from cloud storage.'
              : errorMessage || 'The file you requested does not exist or was deleted early by the sender.'}
          </p>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-2xl transition shadow-md active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Upload Your Own File
        </a>
      </div>
    );
  }

  if (!fileData) return null;

  const isLowTime = timeLeft.totalSeconds < 900; // < 15 minutes

  return (
    <div className="w-full max-w-lg mx-auto bg-white/90 backdrop-blur-2xl rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-200/80 p-6 sm:p-8 space-y-6">
      {/* File Info Header */}
      <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50/80 border border-slate-200/60 shadow-inner">
        <div className="w-14 h-14 bg-gradient-to-tr from-sky-500/10 to-indigo-500/10 text-sky-600 rounded-2xl flex items-center justify-center shrink-0 border border-sky-200/40">
          <span className={`px-2 py-0.5 rounded-lg text-xs font-extrabold uppercase border ${getFileBadge(fileData.fileName).bg}`}>
            {getFileBadge(fileData.fileName).label}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate" title={fileData.fileName}>
            {fileData.fileName}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span className="font-semibold text-slate-800">{formatBytes(fileData.size)}</span>
            <span>&bull;</span>
            <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
              <svg className="w-3.5 h-3.5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {fileData.downloads} {fileData.downloads === 1 ? 'download' : 'downloads'}
            </span>
          </div>
        </div>
      </div>

      {/* Live Countdown Box (HUD Card) */}
      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 rounded-2xl p-6 text-white space-y-3 shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/10 rounded-full blur-2xl"></div>
        <div className="flex items-center justify-between text-xs text-slate-400 relative z-10">
          <span className="flex items-center gap-2 font-semibold">
            <span className={`w-2 h-2 rounded-full ${isLowTime ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-ping'}`}></span>
            <span className={isLowTime ? 'text-amber-300' : 'text-slate-300'}>
              {isLowTime ? 'Expiring Soon' : 'Link Active (Countdown)'}
            </span>
          </span>
          <span className="text-[11px] font-mono text-slate-500">Auto-destructs at 00:00:00</span>
        </div>

        {/* Digital Clock Display */}
        <div className="flex items-baseline justify-center gap-2 sm:gap-4 pt-2 relative z-10">
          <div className="text-center bg-white/5 border border-white/10 rounded-xl px-3 sm:px-4 py-2 min-w-[70px]">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-white">
              {String(timeLeft.hours).padStart(2, '0')}
            </span>
            <span className="block text-[9px] uppercase text-slate-400 font-bold tracking-wider mt-0.5">Hours</span>
          </div>
          <span className="text-2xl font-bold text-slate-500">:</span>
          <div className="text-center bg-white/5 border border-white/10 rounded-xl px-3 sm:px-4 py-2 min-w-[70px]">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-white">
              {String(timeLeft.minutes).padStart(2, '0')}
            </span>
            <span className="block text-[9px] uppercase text-slate-400 font-bold tracking-wider mt-0.5">Minutes</span>
          </div>
          <span className="text-2xl font-bold text-slate-500">:</span>
          <div className="text-center bg-white/5 border border-white/10 rounded-xl px-3 sm:px-4 py-2 min-w-[70px]">
            <span className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight ${isLowTime ? 'text-amber-400' : 'text-sky-400'}`}>
              {String(timeLeft.seconds).padStart(2, '0')}
            </span>
            <span className="block text-[9px] uppercase text-slate-400 font-bold tracking-wider mt-0.5">Seconds</span>
          </div>
        </div>
      </div>

      {/* Download Action CTA */}
      <div className="space-y-3">
        <a
          href={fileData.downloadUrl}
          download={fileData.fileName}
          className="w-full py-4 px-6 bg-gradient-to-r from-sky-600 via-indigo-600 to-violet-600 hover:from-sky-700 hover:via-indigo-700 hover:to-violet-700 text-white font-bold text-base rounded-2xl shadow-xl shadow-sky-500/25 flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.99]"
        >
          <svg className="w-5 h-5 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Download File ({formatBytes(fileData.size)})</span>
        </a>
        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>Direct Amazon S3 Presigned URL &bull; 60-Second Signed Token</span>
        </div>
      </div>

      {/* Early Deletion Accordion / Trigger */}
      <div className="border-t border-slate-100 pt-4 flex items-center justify-between text-xs">
        <a href="/" className="text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1">
          <span>&larr;</span> Send a file
        </a>
        <button
          onClick={() => setShowDeleteModal(!showDeleteModal)}
          className="text-rose-600 hover:text-rose-700 font-medium hover:underline flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>Have a delete token?</span>
        </button>
      </div>

      {/* Delete Token Modal */}
      {showDeleteModal && (
        <form onSubmit={handleDeleteSubmit} className="p-4 bg-rose-50/80 border border-rose-200/80 rounded-2xl space-y-3 animate-fade-in">
          <div>
            <label className="block text-xs font-bold text-rose-900">
              Destroy File Early
            </label>
            <p className="text-[11px] text-rose-700 mt-0.5">
              Enter the secret deleteToken issued during upload to immediately purge this file.
            </p>
          </div>
          <input
            type="text"
            required
            placeholder="Paste your 32-character deleteToken..."
            value={deleteTokenInput}
            onChange={(e) => setDeleteTokenInput(e.target.value)}
            className="w-full px-3.5 py-2.5 text-xs border border-rose-200 rounded-xl bg-white font-mono focus:outline-none focus:ring-2 focus:ring-rose-400 shadow-inner"
          />
          {deleteError && <p className="text-xs text-rose-600 font-semibold">{deleteError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowDeleteModal(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeleting}
              className="px-4 py-1.5 text-xs bg-rose-600 text-white font-semibold rounded-xl hover:bg-rose-700 disabled:opacity-50 transition shadow-sm"
            >
              {isDeleting ? 'Verifying & Deleting...' : 'Confirm Destruction'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-lg mx-auto bg-white/90 backdrop-blur-2xl rounded-3xl shadow-xl border border-slate-200/80 p-10 text-center space-y-4">
          <div className="w-12 h-12 border-4 border-sky-100 border-t-sky-600 rounded-full animate-spin mx-auto" />
          <h2 className="text-lg font-bold text-slate-800">Loading transfer...</h2>
        </div>
      }
    >
      <SharePageContent />
    </Suspense>
  );
}
