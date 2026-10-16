import { defineConfig, type Plugin } from 'vitest/config';

// Injects absolute social-card meta tags when SITE_URL is known (set by the Pages workflow); crawlers
// ignore relative image URLs, so without it the tags are simply omitted.
function socialCard(): Plugin {
  return {
    name: 'social-card',
    transformIndexHtml(html) {
      const site = process.env.SITE_URL;
      if (!site) return html;
      const tags = [
        `<link rel="canonical" href="${site}" />`,
        '<meta property="og:type" content="website" />',
        '<meta property="og:title" content="Run the Cut" />',
        '<meta property="og:description" content="Pastel, physics-driven boating games: run Haulover Inlet in Miami, or find the bait and hook a tuna off Montauk." />',
        `<meta property="og:url" content="${site}" />`,
        `<meta property="og:image" content="${site}og.jpg" />`,
        '<meta name="twitter:card" content="summary_large_image" />',
      ];
      return html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`);
    },
  };
}

// `base: './'` keeps every asset URL relative, so the build works from any
// GitHub Pages path (https://<user>.github.io/<repo>/) or a custom domain.
export default defineConfig({
  base: './',
  plugins: [socialCard()],
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Most of this suite is deterministic physics and rules run through whole scripted days and dockings, so a test
    // is CPU-bound, never waiting on something that might hang. Vitest's 5 s default only passes on a fast, idle
    // machine: a loaded 4-vCPU CI runner took 7.6 s over a Montauk day that takes 2.3 s here, and that broke the
    // Pages deploy. Slow tests may still set their own (longer) timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
