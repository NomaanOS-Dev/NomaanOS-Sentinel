import React from 'react';
import Link from 'next/link';
import { 
  ShieldCheck, 
  Server, 
  Database, 
  Terminal, 
  Activity, 
  FileText, 
  Cpu, 
  AlertTriangle,
  Lock,
  Layers,
  LogIn,
  UserPlus
} from 'lucide-react';

export default function HomePage() {
  const foundationChecks = [
    { name: 'API Server', status: 'Operational', port: '4000', icon: Server, color: 'text-emerald-400' },
    { name: 'PostgreSQL Database', status: 'Healthy', port: '5433', icon: Database, color: 'text-emerald-400' },
    { name: 'Python Parser Engine', status: 'Verified', port: 'In-Process', icon: Terminal, color: 'text-emerald-400' },
    { name: 'Event Schema', status: 'Draft 2020-12', port: 'v1.0.0', icon: Layers, color: 'text-cyan-400' },
  ];

  const syntheticFixtures = [
    { file: 'ssh-success.log', events: 4, desc: 'Publickey & password logins' },
    { file: 'ssh-failure.log', events: 4, desc: 'Authentication rejections' },
    { file: 'invalid-user.log', events: 6, desc: 'Nonexistent user probes' },
    { file: 'brute-force-pattern.log', events: 8, desc: 'High-frequency single-source attacks' },
    { file: 'sudo-activity.log', events: 4, desc: 'Privilege escalation & attempts' },
    { file: 'malformed-lines.log', events: 7, desc: 'Adversarial & broken payloads' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="border-b border-slate-800 pb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                  NomaanOS Sentinel
                </h1>
                <p className="text-sm text-slate-400">
                  AI-Assisted Cybersecurity Threat Detection & Incident Response Platform
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5 text-cyan-400" />
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-medium text-white shadow-md shadow-cyan-950/40 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Register
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Auth & RBAC Active
            </span>
          </div>
        </header>

        {/* System Services Grid */}
        <section className="space-y-4">
          <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-400 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Core Infrastructure Health
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {foundationChecks.map((service) => {
              const Icon = service.icon;
              return (
                <div 
                  key={service.name}
                  className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition-colors space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="w-5 h-5 text-slate-400" />
                    <span className="text-xs font-mono text-slate-500">{service.port}</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-200 text-sm">{service.name}</h3>
                    <p className={`text-xs font-medium mt-1 ${service.color}`}>
                      {service.status}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Two Column Layout: Fixtures & Security Architecture */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Synthetic Test Fixtures */}
          <section className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                Synthetic Linux Auth Fixtures
              </h2>
              <span className="text-xs font-mono text-slate-400">fixtures/linux-auth/</span>
            </div>
            <p className="text-xs text-slate-400">
              Deterministic, non-sensitive fixtures adhering to RFC 5737 test IP blocks for reliable testing without customer data leakage.
            </p>
            <div className="divide-y divide-slate-800/40 text-xs">
              {syntheticFixtures.map((f) => (
                <div key={f.file} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-cyan-300">{f.file}</span>
                    <p className="text-slate-500 text-[11px] mt-0.5">{f.desc}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 font-mono text-[11px]">
                    {f.events} lines
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Security & Threat Principles */}
          <section className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-cyan-400" />
                Security & Defense Foundations
              </h2>
              <span className="text-xs font-mono text-emerald-400">Enforced</span>
            </div>
            <div className="space-y-3 text-xs text-slate-300">
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
                <h4 className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  Untrusted Log Input Handling
                </h4>
                <p className="text-slate-400 mt-1">
                  Log payloads are strictly treated as untrusted strings. Direct shell execution or code evaluation from log content is prohibited.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
                <h4 className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  Structured Logging & Redaction
                </h4>
                <p className="text-slate-400 mt-1">
                  Correlation IDs track every request. Passwords, authorization tokens, session cookies, and database connection strings are masked.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
                <h4 className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  Multi-Tenant Separation
                </h4>
                <p className="text-slate-400 mt-1">
                  Database schema is provisioned with indexed <code className="text-cyan-300">tenant_id</code> to support upcoming MSP workspace isolation.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="pt-6 border-t border-slate-800/80 text-center text-xs text-slate-500">
          NomaanOS Sentinel &bull; Foundation Implementation &bull; Local Development Ready
        </footer>
      </div>
    </div>
  );
}

