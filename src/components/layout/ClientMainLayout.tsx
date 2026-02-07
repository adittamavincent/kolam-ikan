'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { DomainSwitcher } from '@/components/layout/DomainSwitcher';
import { Navigator } from '@/components/layout/Navigator';

interface ClientMainLayoutProps {
  children: React.ReactNode;
  userId: string;
}

export function ClientMainLayout({ children, userId }: ClientMainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 shadow-lg md:hidden"
      >
        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Domain Switcher & Navigator */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex transform transition-transform md:relative md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <DomainSwitcher userId={userId} />
        <Navigator userId={userId} />
      </div>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
