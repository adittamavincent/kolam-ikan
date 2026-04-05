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
        primary: {
          100: "var(--color-primary-100)",
          200: "var(--color-primary-200)",
          500: "var(--color-primary-500)",
          700: "var(--color-primary-700)",
          800: "var(--color-primary-800)",
          900: "var(--color-primary-900)",
          950: "var(--color-primary-950)",
        },
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          default: "var(--bg-surface-default)",
          subtle: "var(--bg-surface-subtle)",
          elevated: "var(--bg-surface-elevated)",
          hover: "var(--bg-surface-hover)",
        },
        overlay: {
          backdrop: "var(--overlay-backdrop)",
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
          bg: "var(--action-bg)",
          hover: "var(--action-hover)",
          text: "var(--action-text)",
          disabled: "var(--action-disabled)",
        },
        status: {
          error: {
            bg: "var(--status-error-bg)",
            border: "var(--status-error-border)",
            text: "var(--status-error-text)",
          },
          success: {
            bg: "var(--status-success-bg)",
            border: "var(--status-success-border)",
            text: "var(--status-success-text)",
          },
          warning: {
            bg: "var(--status-warning-bg)",
            border: "var(--status-warning-border)",
            text: "var(--status-warning-text)",
          },
          info: {
            bg: "var(--status-info-bg)",
            border: "var(--status-info-border)",
            text: "var(--status-info-text)",
          },
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      fontSize: {
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
      },
      borderRadius: {
        none: "0px",
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
