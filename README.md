# RSS Finder

A modern web application to discover RSS feeds from any website. Powered by feedfinder-ts for reliable RSS feed detection.

## Features

- **Robust Detection**: Uses [feedfinder-ts](https://github.com/0x2E/feedfinder-ts) under the hood for comprehensive RSS feed discovery
- **Fast & Lightweight**: Optimized for performance with minimal dependencies

## Getting Started

<details>
<summary>1. Using Docker Image (Recommended)</summary>

```bash
docker run -d -p 3000:3000 --name rss-finder ghcr.io/0x2E/rss-finder:latest
```

Visit `http://localhost:3000` to use the application.

</details>

<details>
<summary>2. Build from Source or Deploy to Cloud Services</summary>

- Node.js 22+
- pnpm

```bash
# Clone the repository
git clone <your-repo-url>
cd rss-finder

# Install dependencies
pnpm install

# Build for production
pnpm build

# or build for Node.js
pnpm build:node
```

Since this app is built with SvelteKit, it's compatible with multiple runtimes. Check the [SvelteKit docs](https://svelte.dev/docs/kit/building-your-app) for platform-specific deployment instructions.

</details>

## API

### Find RSS Feeds

**POST** `/api/find-feeds`

```json
{
	"url": "https://example.com"
}
```

**Response:**

```json
{
	"feeds": [
		{
			"title": "Example Blog RSS",
			"url": "https://example.com/rss.xml",
			"type": "application/rss+xml"
		}
	]
}
```

### Find Curated External Links

**POST** `/api/find-links`

```json
{
	"url": "https://example.com"
}
```

### Evaluate a Site for Discovery

**POST** `/api/evaluate`

```json
{
	"url": "https://example.com"
}
```

The score measures whether a site is suitable for inclusion in website-discovery results. It
does not attempt to judge the author or the site's intrinsic worth.

**Response:**

```json
{
	"url": "https://example.com/",
	"recommended": true,
	"score": 78,
	"reasons": ["many_content_entries", "original_content_variety"],
	"signals": {
		"generator": "Hugo 0.150",
		"sampledPosts": 12,
		"siteBuildingPosts": 1,
		"tutorialPosts": 2,
		"selfHostingPosts": 0,
		"operationalPosts": 1,
		"repetitivePosts": 0,
		"themeFeatures": [],
		"historyYears": 3,
		"latestPostYear": 2026,
		"feedPosts": 10,
		"archivePosts": 0
	}
}
```

`recommended` is deliberately strict: `true` means the site can be included in discovery
results and used as a source for further discovery. Uncertain and rejected sites both return
`false`. The numeric score and signals remain available for debugging. The reusable server-side
evaluator is exported from `src/lib/server/evaluate-site.ts`. When the homepage advertises a
same-origin RSS or Atom feed, the evaluator also samples its recent titles; cross-origin feeds
are deliberately not fetched.

**Response:**

```json
{
	"links": [
		{
			"title": "A Recommended Site",
			"url": "https://recommended.example.org/"
		}
	]
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT

## Credits

- [feedfinder-ts](https://github.com/0x2E/feedfinder-ts) - For reliable RSS feed detection
