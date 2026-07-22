import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findLinks } from './find-links.js';

const { evaluateSiteMock } = vi.hoisted(() => ({ evaluateSiteMock: vi.fn() }));

vi.mock('./evaluate-site.js', () => ({ evaluateSite: evaluateSiteMock }));

interface MockPage {
	body: string;
	contentType?: string;
	status?: number;
}

const originalFetch = globalThis.fetch;

function linkWithFeed(title: string, url: string, feed = new URL('/feed.xml', url).href) {
	return { title, url, feeds: [{ title: '', link: feed }] };
}

function mockPages(pages: Record<string, MockPage>) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			const hostname = new URL(url).hostname;
			const page =
				pages[url] ||
				(hostname !== 'source.test' && hostname !== 'www.source.test'
					? {
							body: `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`
						}
					: { body: 'Not found', status: 404 });
			return new Response(page.body, {
				status: page.status ?? 200,
				headers: { 'Content-Type': page.contentType || 'text/html; charset=utf-8' }
			});
		})
	);
}

beforeEach(() => {
	evaluateSiteMock.mockReset();
	evaluateSiteMock.mockResolvedValue({ recommended: true });
});

afterEach(() => {
	vi.unstubAllGlobals();
	globalThis.fetch = originalFetch;
});

describe('findLinks', () => {
	it('returns one unified list from a conventional resources page', async () => {
		mockPages({
			'https://source.test/': {
				body: '<nav><a href="/resources">资源</a></nav>'
			},
			'https://source.test/resources': {
				body: `<main><h1>资源</h1>
					<div data-main-group><h2>精选博客</h2>
						<a href="https://friend.test/">Friend Blog</a></div>
					<div data-main-group><h2>常用工具</h2>
						<a href="https://tool.test/app">Useful Tool</a></div>
					<h2>开源项目</h2><ul><li>
						<a href="https://project.test/">Useful Project</a></li></ul>
					</main>`
			}
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({
			links: [
				linkWithFeed('Friend Blog', 'https://friend.test/'),
				linkWithFeed('Useful Tool', 'https://tool.test/app'),
				linkWithFeed('Useful Project', 'https://project.test/')
			]
		});
	});

	it('accepts a generic links page when its content is clearly curated', async () => {
		mockPages({
			'https://source.test/': {
				body: '<nav><a href="/links">Links</a></nav>'
			},
			'https://source.test/links': {
				body: `<main><h1>Links</h1>
					<h2>Blogs I read</h2><ul>
						<li><a href="https://writer.test/">Writer</a></li>
					</ul></main>`
			}
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({
			links: [linkWithFeed('Writer', 'https://writer.test/')]
		});
	});

	it('returns only recommended links whose pages expose a feed', async () => {
		mockPages({
			'https://source.test/': {
				body: '<nav><a href="/links">Links</a></nav>'
			},
			'https://source.test/links': {
				body: `<main><h1>Links</h1><h2>Blogs I read</h2><ul>
					<li><a href="https://feed.test/">Feed Blog</a></li>
					<li><a href="https://no-feed.test/">No Feed Blog</a></li>
				</ul></main>`
			},
			'https://feed.test/': {
				body: '<link rel="alternate" type="application/atom+xml" href="/atom.xml">'
			},
			'https://no-feed.test/': {
				body: '<html><head><title>No feed here</title></head><body></body></html>'
			}
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({
			links: [linkWithFeed('Feed Blog', 'https://feed.test/', 'https://feed.test/atom.xml')]
		});
	});

	it('removes feed-enabled sites rejected by the evaluator', async () => {
		evaluateSiteMock.mockImplementation(async (url: string) => ({
			recommended: !url.includes('rejected')
		}));
		mockPages({
			'https://source.test/': {
				body: `<main><h1>Blogroll</h1><h2>Blogs I read</h2><ul>
					<li><a href="https://accepted.test/">Accepted</a></li>
					<li><a href="https://rejected.test/">Rejected</a></li>
				</ul></main>`
			}
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({
			links: [linkWithFeed('Accepted', 'https://accepted.test/')]
		});
	});

	it('does not treat ordinary article citations as recommendations', async () => {
		mockPages({
			'https://source.test/': {
				body: `<html><head><title>A normal article</title></head><body><main>
					<h1>A normal article</h1><p>
						According to <a href="https://research.test/paper">this paper</a> ...
					</p></main></body></html>`
			}
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({ links: [] });
	});

	it('ignores a recommendation route that returns the homepage unchanged', async () => {
		const homepage = `<html><head><title>Personal site</title></head><body>
			<nav><a href="/links">Links</a></nav><main><h1>Latest posts</h1><ul>
				<li><a href="https://news.test/story">An ordinary citation</a></li>
			</ul></main></body></html>`;
		mockPages({
			'https://source.test/': { body: homepage },
			'https://source.test/links': { body: homepage }
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({ links: [] });
	});

	it('groups each friend card and removes feeds, social profiles and same-site links', async () => {
		mockPages({
			'https://www.source.test/': {
				body: `<main><h1>Personal site</h1><h2>友情链接</h2><ul>
					<li><a href="https://friend.test/">Friend</a>
						<a href="https://friend.test/feed">RSS</a></li>
					<li><a href="https://blog.writer.test/">Writer's Blog</a>
						<a href="https://writer.test/">Homepage</a>
						<a href="https://blog.writer.test/index.xml">Feed</a></li>
					<li><a href="https://blog.source.test/">My own blog</a></li>
					<li><a href="https://x.com/writer">Writer on X</a></li>
					<li><a href="https://space.bilibili.com/123">Writer on BiliBili</a></li>
					<li><a href="https://qm.qq.com/q/example">QQ group</a></li>
					<li><a rel="sponsored" href="https://advert.test/">Advertisement</a></li>
				</ul><aside><div class="card-info"><a href="https://sidebar.test/">
					Sidebar profile</a></div></aside></main>`
			}
		});

		await expect(findLinks('https://www.source.test/')).resolves.toEqual({
			links: [
				linkWithFeed('Friend', 'https://friend.test/'),
				linkWithFeed("Writer's Blog", 'https://blog.writer.test/')
			]
		});
	});

	it('discovers the conventional linkroll spelling without a special label', async () => {
		mockPages({
			'https://source.test/': {
				body: '<nav><a href="/linkroll/">林卷</a></nav>'
			},
			'https://source.test/linkroll/': {
				body: `<main><h1>林卷</h1><h2>我常看的博客</h2><ul>
					<li><a href="https://writer.test/">Writer</a></li>
					<li><a href="https://publication.test/">Publication</a></li>
				</ul></main>`
			}
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({
			links: [
				linkWithFeed('Writer', 'https://writer.test/'),
				linkWithFeed('Publication', 'https://publication.test/')
			]
		});
	});

	it('keeps a focused blogroll section separate from external-link statistics', async () => {
		mockPages({
			'https://source.test/linkroll/': {
				body: `<main><h1>林卷</h1>
					<h2>我常看的博客</h2><div class="grid">
						<a class="card" href="https://writer.test/"><h3>Writer</h3></a>
						<a class="card" href="https://essayist.test/"><h3>Essayist</h3></a>
					</div>
					<h2>外部链接排行</h2><ol>
						<li><a href="https://music.test/">Music platform</a></li>
						<li><a href="https://docs.test/">Documentation</a></li>
					</ol></main>`
			}
		});

		await expect(findLinks('https://source.test/linkroll/')).resolves.toEqual({
			links: [
				linkWithFeed('Writer', 'https://writer.test/'),
				linkWithFeed('Essayist', 'https://essayist.test/')
			]
		});
	});

	it('combines blogroll and uses pages while omitting RSS endpoints', async () => {
		mockPages({
			'https://source.test/': {
				body: '<nav><a href="/uses">Uses</a><a href="/blogroll">部落卷</a></nav>'
			},
			'https://source.test/blogroll': {
				body: `<main><h1>Blogroll</h1>
					<h2>Blogs I read</h2><ul>
						<li><a href="https://writer.test/">Writer</a></li>
					</ul><h2>Other recommendations</h2><ul>
						<li><a href="https://article.test/post">A thoughtful article</a></li>
						<li><a href="https://podcast.test/feed.xml">Podcast feed</a></li>
						<li><a href="https://publication.test/">Publication</a></li>
					</ul></main>`
			},
			'https://source.test/uses': {
				body: `<main><h1>Uses</h1><ul>
					<li><a href="https://tool.test/app">Useful Tool</a></li>
				</ul></main>`
			}
		});

		await expect(findLinks('https://source.test/')).resolves.toEqual({
			links: [
				linkWithFeed('Writer', 'https://writer.test/'),
				linkWithFeed('A thoughtful article', 'https://article.test/post'),
				linkWithFeed('Publication', 'https://publication.test/'),
				linkWithFeed('Useful Tool', 'https://tool.test/app')
			]
		});
	});
});
