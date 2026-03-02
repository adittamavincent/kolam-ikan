import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Kolam Ikan Brand Colors
        primary: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
          950: "#082f49",
        },
        // Semantic Tokens
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          default: "var(--bg-surface-default)",
          subtle: "var(--bg-surface-subtle)",
          elevated: "var(--bg-surface-elevated)",
          overlay: "var(--bg-surface-overlay)",
          hover: "var(--bg-surface-hover)",
          dark: "var(--bg-surface-dark)",
        },
        text: {
          default: "var(--text-default)",
          subtle: "var(--text-subtle)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
        },
        border: {
          default: "var(--border-default)",
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
        action: {
          primary: {
            bg: "var(--action-primary-bg)",
            hover: "var(--action-primary-hover)",
            text: "var(--action-primary-text)",
            disabled: "var(--action-primary-disabled)",
          },
          secondary: {
            bg: "var(--action-secondary-bg)",
            hover: "var(--action-secondary-hover)",
            text: "var(--action-secondary-text)",
            border: "var(--action-secondary-border)",
          },
        },
        status: {
          error: {
            bg: "var(--status-error-bg)",
            border: "var(--status-error-border)",
            text: "var(--status-error-text)",
          },
          success: {
            bg: "var(--status-success-bg)",
            text: "var(--status-success-text)",
          },
        },
        // Domain Colors
        programming: "#3B82F6", // Blue
        internship: "#8B5CF6", // Purple
        gym: "#EF4444", // Red
        scholarship: "#10B981", // Green
        hima: "#F59E0B", // Orange
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
        "slide-down": "slideDown 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideDown: {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
