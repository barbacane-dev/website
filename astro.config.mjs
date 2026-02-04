import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  integrations: [
    tailwind(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          fr: 'fr',
          de: 'de',
          es: 'es',
        },
      },
    }),
  ],
  site: 'https://barbacane.dev',
  i18n: {
    locales: ['en', 'fr', 'de', 'es'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: true,
    },
  },
  redirects: {
    '/fr/trademarks': '/trademarks',
    '/de/trademarks': '/trademarks',
    '/es/trademarks': '/trademarks',
  },
});
