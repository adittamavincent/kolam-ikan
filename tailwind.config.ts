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
          50: "#eef3ff",
          100: "#dae6ff",
          200: "#b7cfff",
          300: "#95b8ff",
          400: "#7fa8ff",
          500: "#568af2",
          600: "#4d78cc",
          700: "#4269b9",
          800: "#375698",
          900: "#2e477b",
          950: "#243963",
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
        programming: "#61afef", // One Dark blue
        internship: "#c678dd", // One Dark purple
        gym: "#e06c75", // One Dark red
        scholarship: "#98c379", // One Dark green
        hima: "#e5c07b", // One Dark yellow
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
