import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Automatically cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock ResizeObserver
if (typeof window !== 'undefined') {
  window.ResizeObserver = window.ResizeObserver || class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  clear: vi.fn(),
  removeItem: vi.fn(),
  key: vi.fn(),
  length: 0,
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { 
    value: localStorageMock,
    writable: true 
  });
} else {
  Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
    writable: true
  });
}
