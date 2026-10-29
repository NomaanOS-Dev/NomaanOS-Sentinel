'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, CheckCircle2, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/api';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const performVerification = async () => {
      setLoading(true);
      setError(null);

      const res = await apiRequest('/api/v1/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      });

      setLoading(false);

      if (res.error) {
        setError(res.error);
        return;
      }

      setSuccess(true);
    };

    performVerification();
  }, [token]);

  return (
    <div className="p-6 md:p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-2xl backdrop-blur-sm space-y-6 text-center">
      {loading ? (
        <div className="py-8 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mx-auto" />
          <p className="text-xs text-slate-400">Verifying your cryptographic token...</p>
        </div>
      ) : success ? (
        <div className="space-y-4">
          <div className="inline-flex p-3 rounded-full bg-emerald-950/60 border border-emerald-800/50 text-emerald-400">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-white">Email Address Verified</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your identity has been confirmed. You now have full access to workspace creation, member management, and threat investigation features.
          </p>
          <div className="pt-4">
            <Link
              href="/workspaces"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-medium text-white shadow-lg transition-colors"
            >
              Enter Workspaces Console
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ) : error ? (
        <div className="space-y-4">
          <div className="inline-flex p-3 rounded-full bg-rose-950/60 border border-rose-800/50 text-rose-400">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-white">Verification Failed</h3>
          <p className="text-xs text-rose-300 leading-relaxed">{error}</p>
          <div className="pt-4">
            <Link
              href="/workspaces"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
            >
              Go to Workspace Dashboard
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            No verification token detected in the URL. Please check your verification email link or request a new one from your workspace dashboard.
          </p>
          <div className="pt-4">
            <Link
              href="/workspaces"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 mb-2">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Account Verification</h1>
          <p className="text-sm text-slate-400">Cryptographic token validation</p>
        </div>

        <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Processing token...</div>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}

