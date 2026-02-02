# Barbacane Website

The commercial website for [Barbacane](https://github.com/barbacane-dev/barbacane) - the spec-driven API gateway.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Stack

- [Astro](https://astro.build/) - Static site generator
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## Structure

```
src/
├── components/     # Reusable components
├── layouts/        # Page layouts
├── pages/          # Routes
│   ├── index.astro      # Homepage
│   ├── pricing.astro    # Services & pricing
│   └── trademarks.astro # Trademark policy
└── styles/         # Global styles
public/             # Static assets
```

## License

Apache-2.0
