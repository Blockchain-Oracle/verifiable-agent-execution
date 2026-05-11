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
        // Backgrounds + surfaces (UX spec § Palette table)
        bg: "#15171A",
        surface: "#1A1B1F",
        "surface-elev": "#22252D",
        border: "#363A45",
        // Text
        "text-primary": "#F5F5F5",
        "text-secondary": "#A3A6B1",
        // Accents — semantic, NOT decorative
        "accent-verify": "#10B981", // verified / success
        "accent-mock": "#F59E0B",   // mock / warning
        "accent-unverified": "#EF4444", // unverified / error
        link: "#3B82F6",
      },
      fontFamily: {
        // Geist Sans for body + headings; Geist Mono for hashes /
        // timestamps / addresses. Wired via next/font/google in
        // src/app/layout.tsx; the CSS variables are bound here.
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
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
