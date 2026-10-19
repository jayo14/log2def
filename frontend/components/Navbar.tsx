'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { BookOpen, User as UserIcon, LogOut, PlusCircle, LayoutDashboard, ShieldCheck } from 'lucide-react';

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-border/80 bg-background/95 backdrop-blur-sm sticky top-0 z-40 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-md bg-emerald-800 text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-sm transition-transform group-hover:scale-105">
              L2D
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-foreground tracking-tight text-base leading-tight">Log2Def</span>
              <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">SIWES Platform</span>
            </div>
          </Link>

          {user && (
            <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-foreground/80 hover:text-foreground hover:bg-muted transition-colors"
              >
                <LayoutDashboard className="w-4 h-4 text-emerald-700" />
                Dashboard
              </Link>
              <Link
                href="/projects/new"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-foreground/80 hover:text-foreground hover:bg-muted transition-colors"
              >
                <PlusCircle className="w-4 h-4 text-emerald-700" />
                New Report Project
              </Link>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-foreground">
                  {user.first_name ? `${user.first_name} ${user.last_name}` : user.username}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">{user.email}</span>
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
                title="Logout"
              >
                <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="px-3.5 py-1.5 text-sm font-medium text-foreground hover:text-emerald-800 transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="px-3.5 py-1.5 rounded-md bg-emerald-800 text-white text-sm font-medium hover:bg-emerald-900 shadow-sm transition-colors"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
