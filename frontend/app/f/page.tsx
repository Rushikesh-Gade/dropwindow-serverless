'use client';

import React, { Suspense, useEffect, useState, useTransition } from 'react';
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

  useEffect(() => {
    if (!fileId) {
      setLoading(false);
      setErrorStatus(400);
      setErrorMessage('No file ID provided in the link.');
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
      <div className="w-full max-w-lg mx-auto bg-white rounded-3xl shadow-xl border border-slate-200/80 p-10 text-center space-y-4">
        <div className="w-12 h-12 border-4 border-sky-200 border-t-sky-600 rounded-full animate-spin mx-auto" />
        <h2 className="text-lg font-bold text-slate-800">Locating file...</h2>
        <p className="text-xs text-slate-400">Verifying security token and generating presigned download access.</p>
      </div>
    );
  }

  // File Deleted State
  if (isDeleted) {
    return (
      <div className="w-full max-w-lg mx-auto bg-white rounded-3xl shadow-xl border border-slate-200/80 p-8 sm:p-10 text-center space-y-6">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full mx-auto flex items-center justify-center">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-slate-900">File Deleted</h1>
          <p className="text-sm text-slate-500">
            This file and its associated DynamoDB record have been permanently removed.
          </p>
        </div>
        <a
          href="/"
          className="inline-block px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold text-sm rounded-xl transition"
        >
          Upload New File
        </a>
      </div>
    );
  }

  // Expired State (410 Gone) or File Not Found (404)
  if (errorStatus === 410 || errorStatus === 404 || errorMessage) {
    const isExpired = errorStatus === 410;
    return (
      <div className="w-full max-w-lg mx-auto bg-white rounded-3xl shadow-xl border border-slate-200/80 p-8 sm:p-10 text-center space-y-6">
        <div className={`w-16 h-16 ${isExpired ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'} rounded-full mx-auto flex items-center justify-center`}>
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
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            {isExpired
              ? 'This temporary transfer has exceeded its time-to-live (TTL) and has been permanently purged.'
              : errorMessage || 'The file you are looking for does not exist or was deleted early by the uploader.'}
          </p>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-xl transition shadow-md"
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

  return (
    <div className="w-full max-w-lg mx-auto bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/80 p-6 sm:p-8 space-y-6">
      {/* File Header */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center shrink-0 shadow-inner">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 truncate" title={fileData.fileName}>
            {fileData.fileName}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span className="font-semibold text-slate-700">{formatBytes(fileData.size)}</span>
            <span>&bull;</span>
            <span className="truncate max-w-[150px]">{fileData.contentType || 'file'}</span>
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

      {/* Live Countdown Box */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white space-y-2 shadow-md">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            Time Remaining (Live Countdown)
          </span>
          <span>Self-destructs at zero</span>
        </div>
        <div className="flex items-baseline justify-center gap-3 pt-1">
          <div className="text-center">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight">
              {String(timeLeft.hours).padStart(2, '0')}
            </span>
            <span className="block text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Hours</span>
          </div>
          <span className="text-2xl font-bold text-slate-500">:</span>
          <div className="text-center">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight">
              {String(timeLeft.minutes).padStart(2, '0')}
            </span>
            <span className="block text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Minutes</span>
          </div>
          <span className="text-2xl font-bold text-slate-500">:</span>
          <div className="text-center">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-sky-400">
              {String(timeLeft.seconds).padStart(2, '0')}
            </span>
            <span className="block text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Seconds</span>
          </div>
        </div>
      </div>

      {/* Download Action Button */}
      <div className="space-y-3">
        <a
          href={fileData.downloadUrl}
          download={fileData.fileName}
          className="w-full py-4 px-6 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white font-bold text-base rounded-2xl shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2.5 transition active:scale-[0.99]"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Download File ({formatBytes(fileData.size)})</span>
        </a>
        <p className="text-center text-[11px] text-slate-400">
          Direct secure link via AWS S3 Presigned URL &bull; 60-second download window
        </p>
      </div>

      {/* Early Deletion Accordion / Trigger */}
      <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
        <a href="/" className="text-xs text-slate-500 hover:text-slate-800 font-medium">
          &larr; Upload a file
        </a>
        <button
          onClick={() => setShowDeleteModal(!showDeleteModal)}
          className="text-xs text-rose-600 hover:text-rose-700 font-medium hover:underline"
        >
          Have a delete token?
        </button>
      </div>

      {/* Delete Token Modal */}
      {showDeleteModal && (
        <form onSubmit={handleDeleteSubmit} className="p-4 bg-rose-50/70 border border-rose-100 rounded-2xl space-y-3">
          <label className="block text-xs font-semibold text-rose-900">
            Enter Secret Delete Token to Remove File Early
          </label>
          <input
            type="text"
            required
            placeholder="Paste your deleteToken..."
            value={deleteTokenInput}
            onChange={(e) => setDeleteTokenInput(e.target.value)}
            className="w-full px-3 py-2 text-xs border border-rose-200 rounded-xl bg-white font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
          />
          {deleteError && <p className="text-xs text-rose-600">{deleteError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteModal(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeleting}
              className="px-3 py-1.5 text-xs bg-rose-600 text-white font-medium rounded-lg hover:bg-rose-700 disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Confirm Delete'}
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
        <div className="w-full max-w-lg mx-auto bg-white rounded-3xl shadow-xl border border-slate-200/80 p-10 text-center space-y-4">
          <div className="w-12 h-12 border-4 border-sky-200 border-t-sky-600 rounded-full animate-spin mx-auto" />
          <h2 className="text-lg font-bold text-slate-800">Loading share page...</h2>
        </div>
      }
    >
      <SharePageContent />
    </Suspense>
  );
}
