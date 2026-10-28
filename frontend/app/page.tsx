'use client';

import React, { useState, useRef, useCallback } from 'react';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.js', '.vbs', '.ps1'
]);

type ExpiryOption = '1h' | '6h' | '24h';

interface UploadResult {
  fileId: string;
  shareUrl: string;
  deleteToken: string;
  fileName: string;
  size: number;
  expiresAt: number;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState<ExpiryOption>('1h');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successResult, setSuccessResult] = useState<UploadResult | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
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

  const validateFile = (selectedFile: File): string | null => {
    if (selectedFile.size > MAX_FILE_SIZE) {
      return `File exceeds the 50 MB limit (${formatBytes(selectedFile.size)})`;
    }
    const ext = '.' + selectedFile.name.split('.').pop()?.toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return `Executable and script files with "${ext}" are blocked for security reasons.`;
    }
    return null;
  };

  const handleFileSelect = (selectedFile: File) => {
    setErrorMessage('');
    const error = validateFile(selectedFile);
    if (error) {
      setErrorMessage(error);
      setFile(null);
      return;
    }
    setFile(selectedFile);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }, []);

  const handleUpload = async () => {
    if (!file) return;

    setErrorMessage('');
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('Requesting secure presigned URL...');

    const createUploadUrl =
      process.env.NEXT_PUBLIC_CREATE_UPLOAD_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      '';

    if (!createUploadUrl) {
      setErrorMessage('Configuration error: NEXT_PUBLIC_CREATE_UPLOAD_URL is not set.');
      setIsUploading(false);
      return;
    }

    try {
      // Step 1: Call Lambda createUpload
      const createResponse = await fetch(createUploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          expiry: expiry
        })
      });

      if (!createResponse.ok) {
        const errData = await createResponse.json().catch(() => ({}));
        throw new Error(errData.error || `Upload creation failed (${createResponse.status})`);
      }

      const { fileId, upload, deleteToken, expiresAt } = await createResponse.json();

      // Step 2: Upload directly to S3 with XMLHttpRequest for progress tracking
      setUploadStatus('Streaming directly to private S3 bucket...');
      const formData = new FormData();
      Object.entries(upload.fields).forEach(([key, value]) => {
        formData.append(key, value as string);
      });
      // CRITICAL: File must be the last field appended
      formData.append('file', file);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', upload.url, true);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(percent);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`S3 upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error uploading to S3'));
        };

        xhr.send(formData);
      });

      // Step 3: Success!
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const shareUrl = `${origin}/f/?id=${fileId}`;

      setSuccessResult({
        fileId,
        shareUrl,
        deleteToken,
        fileName: file.name,
        size: file.size,
        expiresAt
      });
    } catch (err: any) {
      console.error('Upload flow error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during upload.');
    } finally {
      setIsUploading(false);
      setUploadStatus('');
    }
  };

  const copyToClipboard = async (text: string, isToken: boolean) => {
    let copied = false;
    // 1. Modern Async Clipboard API (for HTTPS / localhost)
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (err) {
        console.warn('navigator.clipboard failed, attempting fallback:', err);
      }
    }
    // 2. Fallback for HTTP (execCommand copy with temporary input)
    if (!copied && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        copied = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (err) {
        console.error('Fallback copy failed:', err);
      }
    }
    if (copied) {
      if (isToken) {
        setCopiedToken(true);
        setTimeout(() => setCopiedToken(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    }
  };

  const handleEarlyDelete = async () => {
    if (!successResult) return;
    if (!confirm('Are you sure you want to permanently delete this file right now?')) return;

    setIsDeleting(true);
    setErrorMessage('');

    const deleteFileUrl =
      process.env.NEXT_PUBLIC_DELETE_FILE_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      '';

    try {
      const res = await fetch(deleteFileUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: successResult.fileId,
          deleteToken: successResult.deleteToken
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete file');
      }

      setDeleteSuccess(true);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error deleting file early');
    } finally {
      setIsDeleting(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setSuccessResult(null);
    setUploadProgress(0);
    setErrorMessage('');
    setDeleteSuccess(false);
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-8">
      {/* Hero Intro Header */}
      {!successResult && (
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200/80 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
            <span>100% Serverless Ephemeral Transfer</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Share Files That <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-600 via-indigo-600 to-violet-600">Self-Destruct</span>
          </h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            Fast, secure, anonymous file sharing. Files stream directly to Amazon S3 and automatically vanish forever when time expires.
          </p>
        </div>
      )}

      {/* Main Interactive Card */}
      <div className="bg-white/90 backdrop-blur-2xl rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-200/80 p-6 sm:p-8 transition-all">
        {successResult ? (
          /* Upload Success View */
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 bg-gradient-to-tr from-emerald-500 to-teal-400 text-white rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/25 animate-bounce-short">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900">Your File is Ready!</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Recipient can download it until the countdown expires.
                </p>
              </div>

              {/* File Info Pill */}
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 max-w-full">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="font-semibold truncate max-w-[220px]">{successResult.fileName}</span>
                <span className="text-slate-400">&bull;</span>
                <span className="font-mono text-slate-500">{formatBytes(successResult.size)}</span>
              </div>
            </div>

            {deleteSuccess ? (
              <div className="p-6 bg-amber-50 border border-amber-200/80 rounded-2xl text-center space-y-3">
                <div className="w-10 h-10 bg-amber-100 text-amber-700 rounded-full mx-auto flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-amber-900">File Permanently Purged</h3>
                <p className="text-xs text-amber-700">
                  This file and its DynamoDB record have been purged immediately upon your request.
                </p>
                <button
                  onClick={resetForm}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition"
                >
                  Upload Another File
                </button>
              </div>
            ) : (
              <>
                {/* Share Link Box */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      Public Share Link
                    </label>
                    <span className="text-[11px] text-slate-400">Click link to select all</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={successResult.shareUrl}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-1 bg-slate-50 border border-slate-200/90 rounded-2xl px-4 py-3 text-sm text-slate-800 font-mono select-all focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer shadow-inner"
                    />
                    <button
                      onClick={() => copyToClipboard(successResult.shareUrl, false)}
                      className="px-5 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white font-semibold text-sm rounded-2xl transition flex items-center gap-1.5 shadow-md shadow-sky-500/20 active:scale-95 shrink-0"
                    >
                      {copiedLink ? (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Expiration Banner */}
                <div className="flex items-center justify-between p-4 bg-sky-50/70 border border-sky-100/90 rounded-2xl text-xs text-sky-900">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-sky-100 text-sky-600 rounded-xl flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-sky-950">Auto-destructs at</p>
                      <p className="text-sky-700 font-mono text-[11px]">{new Date(successResult.expiresAt * 1000).toLocaleString()}</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 bg-white/80 rounded-lg font-bold text-sky-800 text-[11px] border border-sky-200/60 shadow-xs uppercase">
                    {expiry} window
                  </span>
                </div>

                {/* Secret Delete Token Box */}
                <div className="border-t border-slate-100 pt-5 space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Uploader Secret Delete Token
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Keep this private. It allows you to destroy the file from S3 & DynamoDB before expiration.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={successResult.deleteToken}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-1 bg-slate-50 border border-slate-200/90 rounded-xl px-3.5 py-2.5 text-xs text-slate-700 font-mono select-all focus:outline-none focus:ring-2 focus:ring-rose-400 cursor-pointer shadow-inner"
                    />
                    <button
                      onClick={() => copyToClipboard(successResult.deleteToken, true)}
                      className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-xl transition flex items-center gap-1.5 active:scale-95 shrink-0"
                    >
                      {copiedToken ? (
                        <>
                          <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-emerald-700 font-semibold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          <span>Copy Token</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      onClick={handleEarlyDelete}
                      disabled={isDeleting}
                      className="px-3.5 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold rounded-xl transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      {isDeleting ? 'Purging...' : 'Delete File Early'}
                    </button>

                    <button
                      onClick={resetForm}
                      className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition shadow-sm active:scale-95"
                    >
                      Upload Another
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          /* Upload Form View */
          <div className="space-y-6">
            {/* Drag & Drop Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative cursor-pointer rounded-2xl p-8 sm:p-10 text-center transition-all duration-200 border-2 border-dashed ${
                isDragging
                  ? 'border-sky-500 bg-sky-50/80 scale-[1.01] shadow-lg shadow-sky-500/10'
                  : file
                  ? 'border-emerald-400 bg-emerald-50/40'
                  : 'border-slate-300 hover:border-sky-400 hover:bg-slate-50/80'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />

              {file ? (
                /* Selected File Card */
                <div className="space-y-4">
                  <div className="flex items-center justify-center">
                    <div className="inline-flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-md max-w-full">
                      <span className={`px-2.5 py-1 rounded-xl text-xs font-extrabold uppercase border ${getFileBadge(file.name).bg}`}>
                        {getFileBadge(file.name).label}
                      </span>
                      <div className="text-left min-w-0 pr-2">
                        <p className="font-bold text-slate-800 text-sm truncate max-w-[240px] sm:max-w-[280px]">
                          {file.name}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">{formatBytes(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                        }}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-600 transition"
                        title="Remove file"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-sky-600 font-medium">Click or drag another file to replace</p>
                </div>
              ) : (
                /* Empty Dropzone State */
                <div className="space-y-3">
                  <div className="w-16 h-16 bg-gradient-to-tr from-sky-500/10 via-indigo-500/10 to-violet-500/10 text-sky-600 rounded-3xl mx-auto flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-800 text-base">
                      Drag & drop your file here, or <span className="text-sky-600 underline decoration-sky-300 underline-offset-4">browse</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      Up to 50 MB &bull; Client-to-S3 direct encryption &bull; No login required
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
                    {['PDF', 'Images', 'Videos', 'Archives', 'Docs'].map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Expiration Options Selector */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Retention Lifetime
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: '1h', label: '1 Hour', icon: '⚡', desc: 'Short-lived drop' },
                  { id: '6h', label: '6 Hours', icon: '⏳', desc: 'Standard transfer' },
                  { id: '24h', label: '24 Hours', icon: '🌙', desc: 'Full-day availability' }
                ].map((item) => {
                  const isSelected = expiry === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setExpiry(item.id as ExpiryOption)}
                      className={`relative py-3.5 px-3 rounded-2xl border text-center transition-all duration-150 flex flex-col items-center justify-center gap-0.5 ${
                        isSelected
                          ? 'border-sky-500 bg-sky-50/80 text-sky-950 shadow-sm ring-2 ring-sky-500/30'
                          : 'border-slate-200/90 bg-white/70 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span className="text-xs font-bold tracking-tight">{item.label}</span>
                      <span className="text-[10px] text-slate-400">{item.desc}</span>
                      {isSelected && (
                        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-sky-500"></span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="p-4 bg-rose-50 border border-rose-200/80 rounded-2xl flex items-start gap-3 text-xs text-rose-800 animate-shake">
                <div className="w-5 h-5 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-bold">Upload Notice</p>
                  <p className="text-rose-700 mt-0.5">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Upload Progress Bar */}
            {isUploading && (
              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-700 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
                    {uploadStatus}
                  </span>
                  <span className="font-mono font-bold text-sky-600">{uploadProgress}%</span>
                </div>
                <div className="w-full h-3 bg-slate-200/70 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 transition-all duration-150 rounded-full"
                    style={{ width: `${uploadProgress}%` }}
                  />
                  <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                </div>
              </div>
            )}

            {/* Upload Submit CTA */}
            <button
              type="button"
              disabled={!file || isUploading}
              onClick={handleUpload}
              className={`w-full py-4 px-6 rounded-2xl font-bold text-sm text-white shadow-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                !file || isUploading
                  ? 'bg-slate-300 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-sky-600 via-indigo-600 to-violet-600 hover:from-sky-700 hover:via-indigo-700 hover:to-violet-700 shadow-sky-500/25 active:scale-[0.99]'
              }`}
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Uploading to S3...</span>
                </>
              ) : file ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Generate Ephemeral Link</span>
                </>
              ) : (
                <span>Select a File to Begin</span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Feature Strip Highlights */}
      {!successResult && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="p-4 rounded-2xl bg-white/60 backdrop-blur-sm border border-slate-200/60 shadow-xs flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Direct S3 Streaming</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">Files go straight to private S3. Lambda never inspects raw data.</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/60 backdrop-blur-sm border border-slate-200/60 shadow-xs flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Auto Self-Destruct</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">DynamoDB TTL + S3 Lifecycles permanently purge files upon expiry.</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/60 backdrop-blur-sm border border-slate-200/60 shadow-xs flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Zero Tracking</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">No login, no cookies, no tracking telemetry. Total anonymity.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
