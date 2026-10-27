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

  const validateFile = (selectedFile: File): string | null => {
    if (selectedFile.size > MAX_FILE_SIZE) {
      return `File exceeds the 50 MB limit (${formatBytes(selectedFile.size)})`;
    }
    const ext = '.' + selectedFile.name.split('.').pop()?.toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return `Files with extension "${ext}" are blocked for security reasons.`;
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
    setUploadStatus('Requesting secure presigned upload...');

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
      setUploadStatus('Uploading file directly to S3...');
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
        console.warn('navigator.clipboard failed:', err);
      }
    }
    // 2. Fallback for HTTP (execCommand copy)
    if (!copied && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
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
    <div className="w-full max-w-xl mx-auto">
      {/* Upload Success View */}
      {successResult ? (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/80 p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full mx-auto flex items-center justify-center">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">File Ready to Share!</h2>
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{successResult.fileName}</span> ({formatBytes(successResult.size)})
            </p>
          </div>

          {deleteSuccess ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-3">
              <p className="text-sm font-semibold text-amber-800">
                This file has been permanently deleted from S3 and DynamoDB.
              </p>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition"
              >
                Upload Another File
              </button>
            </div>
          ) : (
            <>
              {/* Share Link Box */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Public Share Link
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={successResult.shareUrl}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-700 font-mono select-all focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(successResult.shareUrl, false)}
                    className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-medium text-sm rounded-xl transition flex items-center gap-1.5 shadow-sm active:scale-95"
                  >
                    {copiedLink ? (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

              {/* Expiration Notice */}
              <div className="flex items-center justify-between p-3.5 bg-sky-50/60 border border-sky-100 rounded-xl text-xs text-sky-900">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Auto-expires: {new Date(successResult.expiresAt * 1000).toLocaleString()}</span>
                </div>
                <span className="font-semibold text-sky-700 capitalize">{expiry} link</span>
              </div>

              {/* Secret Delete Token & Early Deletion */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Uploader Secret Delete Token
                    </h3>
                    <p className="text-[11px] text-slate-400">Save this if you want to delete the file before it auto-expires.</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(successResult.deleteToken, true)}
                    className="text-xs text-slate-600 hover:text-slate-900 font-medium underline"
                  >
                    {copiedToken ? 'Token Copied!' : 'Copy Token'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    onClick={handleEarlyDelete}
                    disabled={isDeleting}
                    className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium rounded-lg transition disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete File Early'}
                  </button>

                  <button
                    onClick={resetForm}
                    className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition"
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
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/80 p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Share Files Anonymously
            </h1>
            <p className="text-sm text-slate-500">
              Ephemeral, serverless, and private. Files self-destruct after expiry.
            </p>
          </div>

          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-all duration-200 ${
              isDragging
                ? 'border-sky-500 bg-sky-50/70 scale-[1.01]'
                : file
                ? 'border-emerald-400 bg-emerald-50/40'
                : 'border-slate-300 hover:border-sky-400 hover:bg-slate-50/60'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="hidden"
            />

            {file ? (
              <div className="space-y-3">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center shadow-sm">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-slate-800 text-base break-all">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                </div>
                <span className="inline-block text-xs text-sky-600 hover:underline">Click or drag another file to replace</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-2xl mx-auto flex items-center justify-center shadow-inner">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-slate-700 text-sm">
                    Drag and drop your file here, or <span className="text-sky-600 font-bold">browse</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Maximum size: 50 MB &bull; Executable scripts blocked
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Expiry Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
              File Expiration Window
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: '1h', label: '1 Hour', desc: 'Short-lived' },
                { id: '6h', label: '6 Hours', desc: 'Standard' },
                { id: '24h', label: '24 Hours', desc: 'Full Day' }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setExpiry(item.id as ExpiryOption)}
                  className={`py-3 px-3 rounded-xl border text-center transition flex flex-col items-center justify-center ${
                    expiry === item.id
                      ? 'border-sky-600 bg-sky-50 text-sky-900 ring-2 ring-sky-500/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <span className="text-sm font-bold">{item.label}</span>
                  <span className="text-[10px] text-slate-400">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
              <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Upload Progress Bar */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-600">
                <span>{uploadStatus}</span>
                <span className="font-bold">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 transition-all duration-150 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Submit Upload Button */}
          <button
            type="button"
            disabled={!file || isUploading}
            onClick={handleUpload}
            className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white shadow-lg transition-all ${
              !file || isUploading
                ? 'bg-slate-300 cursor-not-allowed shadow-none'
                : 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 shadow-sky-500/25 active:scale-[0.99]'
            }`}
          >
            {isUploading ? 'Uploading to S3...' : file ? 'Create Share Link' : 'Select a File to Upload'}
          </button>
        </div>
      )}
    </div>
  );
}
