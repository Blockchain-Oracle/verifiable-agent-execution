import type { Config } from "tailwindcss";

/**
 * Tailwind config baked against context/docs/ux-spec.md palette.
 *
 * The palette is dark-only (no light-mode toggle in scope per the
 * UX spec § "Theme: dark-mode only for hackathon"). Colors are
 * exposed as semantic tokens (bg, surface, accent-verify, etc) so
 * components don't hardcode hex values — anti-slop guard from
 * CLAUDE.md "no `from-purple-500 to-pink-500`".
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Backgrounds + surfaces — slightly warmer/deeper for red brand
        bg: "#07090D",
        surface: "#0D1119",
        "surface-elev": "#131C28",
        border: "#1C2A3C",
        // Text
        "text-primary": "#F0F4F8",
        "text-secondary": "#7A8FA0",
        // Semantic accents — green/amber retain their meaning
        "accent-verify": "#36D399", // verified / success
        "accent-mock": "#F5B84B",   // mock / warning
        "accent-unverified": "#FF6B6B", // unverified / error (salmon, distinct from brand red)
        // Brand primary: crimson red — replaces blue across all interactive
        // elements (links, eyebrow labels, step numbers, hover borders).
        // Both aliases kept so existing callsites compile unchanged.
        link: "#E5263A",
        "accent-link": "#E5263A",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
        // Rajdhani: condensed military-grade display font for hero headings.
        // Imported via next/font/google in layout.tsx.
        display: ["var(--font-rajdhani)", "Rajdhani", "sans-serif"],
      },
      // 4px base scale per UX spec § Spacing.
      spacing: {
        "1.5": "0.375rem",
        "2.5": "0.625rem",
      },
    },
  },
  plugins: [],
};

export default config;
