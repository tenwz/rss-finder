import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateSite, evaluateSiteHTML, evaluateSitePage } from './evaluate-site.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
	vi.unstubAllGlobals();
	globalThis.fetch = originalFetch;
});

function postList(titles: string[], publishedAt = new Date().toISOString()): string {
	return titles
		.map(
			(title, index) =>
				`<article><h2><a href="/posts/${index}">${title}</a></h2><time datetime="${publishedAt}"></time><p>${'原创内容 '.repeat(50)}</p></article>`
		)
		.join('');
}

describe('evaluateSiteHTML', () => {
	it('keeps a content-rich long-running site', () => {
		const html = `<html><head><meta name="generator" content="Hugo 0.150"></head><body>
			<main>${postList([
				'关于城市步行的三个观察',
				'读完卡利古拉以后',
				'一个数据库迁移事故的复盘',
				'今年使用过的几种写作方法',
				'如何理解网络社区里的信任',
				'一次穿过群山的旅行',
				'给未来项目留下的设计笔记',
				'从一封旧信开始的调查'
			])}<time datetime="2022-01-01"></time><time datetime="2026-01-01"></time></main>
		</body></html>`;

		const result = evaluateSiteHTML(html, 'https://writer.test/');
		expect(result.recommended).toBe(true);
		expect(result.score).toBeGreaterThanOrEqual(65);
		expect(result.signals).toMatchObject({
			generator: 'Hugo 0.150',
			sampledPosts: 8,
			siteBuildingPosts: 0,
			historyYears: 4
		});
	});

	it('excludes a decorative theme showcase dominated by site-building posts', () => {
		const html = `<html><head>
			<meta name="generator" content="Hexo 7.0">
			<link rel="stylesheet" href="/themes/hexo-theme-anzhiyu/main.css">
			<script src="/js/live2d-widget.js"></script><script src="/js/APlayer.min.js"></script>
		</head><body><main>${postList([
			'Hexo 博客搭建完整教程',
			'AnZhiYu 主题配置记录',
			'博客鼠标特效与美化',
			'使用 Waline 配置评论系统',
			'Vercel 部署博客的方法',
			'申请友情链接之前请阅读',
			'周末随笔',
			'最近在听的音乐'
		])}</main></body></html>`;

		const result = evaluateSiteHTML(html, 'https://theme-blog.test/');
		expect(result.recommended).toBe(false);
		expect(result.score).toBeLessThan(40);
		expect(result.reasons).toContain('theme_showcase_pattern');
		expect(result.signals.themeFeatures).toEqual(['live2d', 'anzhiyu-theme', 'background-music']);
	});

	it('does not reject a site merely because it uses Hexo', () => {
		const html = `<html><head><meta name="generator" content="Hexo 7.0"></head><body>
			<main>${postList([
				'编译器错误恢复设计',
				'为 SQLite 编写一个扩展',
				'分布式系统中的时间问题',
				'一次生产环境性能调查',
				'阅读操作系统源码的方法',
				'实现一个小型解析器',
				'关于接口兼容性的笔记',
				'今年最有价值的三篇论文'
			])}</main></body></html>`;

		const result = evaluateSiteHTML(html, 'https://engineer.test/');
		expect(result.recommended).toBe(true);
		expect(result.signals.generator).toBe('Hexo 7.0');
		expect(result.signals.themeFeatures).toEqual([]);
	});

	it('recognizes common Sakura and Kratos theme fingerprints', () => {
		const sakura = evaluateSiteHTML(
			`<html><head><link rel="stylesheet" href="/wp-content/themes/Sakura/style.css"></head><body class="wp-theme-Sakura"><main>${postList(
				[
					'城市夜行笔记',
					'一次系统升级记录',
					'最近读过的几本书',
					'周末骑行路线',
					'整理旧照片',
					'厨房里的失败实验',
					'关于长期写作',
					'夏天的声音'
				]
			)}</main></body></html>`,
			'https://sakura.test/'
		);
		const kratos = evaluateSiteHTML(
			`<html><head><link rel="stylesheet" href="/hexo-theme-kratos-rebirth/kr-core.css"></head><body><main>${postList(
				[
					'城市夜行笔记',
					'一次系统升级记录',
					'最近读过的几本书',
					'周末骑行路线',
					'整理旧照片',
					'厨房里的失败实验',
					'关于长期写作',
					'夏天的声音'
				]
			)}</main></body></html>`,
			'https://kratos.test/'
		);

		expect(sakura.recommended).toBe(false);
		expect(sakura.signals.themeFeatures).toContain('sakura-theme');
		expect(kratos.recommended).toBe(false);
		expect(kratos.signals.themeFeatures).toContain('kratos-theme');
	});

	it.each([
		['Sakurairo', '/wp-content/themes/Sakurairo/style.css', 'sakura-theme'],
		['Volantis', '/node_modules/hexo-theme-volantis/source/css/app.css', 'volantis-theme'],
		['Handsome', '/usr/themes/handsome/assets/css/style.css', 'handsome-theme'],
		['Joe', '/usr/themes/Joe/assets/css/joe.min.css', 'joe-theme'],
		['Argon', '/wp-content/themes/argon-theme/style.css', 'argon-theme'],
		['MDx', '/wp-content/themes/mdx/css/mdui.min.css', 'mdx-theme'],
		['Koharu', 'https://github.com/cosZone/astro-koharu', 'koharu-theme']
	])('blocks the common decorative %s theme', (_, asset, feature) => {
		const result = evaluateSiteHTML(
			`<html><head><link rel="stylesheet" href="${asset}"></head><body><main>${postList([
				'城市夜行笔记',
				'一次系统升级记录',
				'最近读过的几本书',
				'周末骑行路线',
				'整理旧照片',
				'厨房里的失败实验',
				'关于长期写作',
				'夏天的声音'
			])}</main></body></html>`,
			'https://decorative.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.signals.themeFeatures).toContain(feature);
		expect(result.reasons).toContain('recommendation_blocked_by_theme');
	});

	it('blocks Live2D even when the site has many posts', () => {
		const result = evaluateSiteHTML(
			`<html><head><script src="/js/live2d-widget.js"></script></head><body><main>${postList([
				'城市夜行笔记',
				'一次系统升级记录',
				'最近读过的几本书',
				'周末骑行路线',
				'整理旧照片',
				'厨房里的失败实验',
				'关于长期写作',
				'夏天的声音'
			])}</main></body></html>`,
			'https://live2d.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.signals.themeFeatures).toContain('live2d');
	});

	it('does not block a plain Hugo Stack site merely for using Stack', () => {
		const result = evaluateSiteHTML(
			`<html><head><link rel="stylesheet" href="/hugo-theme-stack/style.css"></head><body><main>${postList(
				[
					'城市夜行笔记',
					'一次系统升级记录',
					'最近读过的几本书',
					'周末骑行路线',
					'整理旧照片',
					'厨房里的失败实验',
					'关于长期写作',
					'夏天的声音'
				]
			)}</main></body></html>`,
			'https://plain.test/'
		);

		expect(result.recommended).toBe(true);
		expect(result.signals.themeFeatures).toEqual([]);
	});

	it('reads common Icarus and article-list title structures', () => {
		const html = `<html><body><div class="column-main">
			<article><p class="title"><a href="/one">城市夜行笔记</a></p></article>
			<article><p class="title"><a href="/two">读完卡利古拉以后</a></p></article>
			<article><p class="title"><a href="/three">一次数据库事故复盘</a></p></article>
		</div><div class="markdown-body"><h2>Articles</h2><ul>
			<li><a href="/four">今年使用过的写作方法</a></li>
			<li><a href="/five">网络社区里的信任</a></li>
			</ul><p>Archived:</p><ul>
				<li><a href="/six">一次穿过群山的旅行</a></li>
				<li><a href="/seven">给未来项目的设计笔记</a></li>
				<li><a href="/eight">从一封旧信开始的调查</a></li>
			</ul><time datetime="${new Date().toISOString()}"></time><p>${'文章摘要内容 '.repeat(160)}</p></div></body></html>`;

		const result = evaluateSiteHTML(html, 'https://lists.test/');
		expect(result.signals.sampledPosts).toBe(8);
		expect(result.recommended).toBe(true);
	});

	it('rejects a site dominated by quick tutorials', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList([
				'Docker 安装完整教程',
				'Nginx 配置踩坑指南',
				'如何修复服务器证书问题',
				'一键部署自己的网盘',
				'校园网绕过认证教程',
				'城市夜行笔记',
				'最近读过的几本书',
				'周末骑行路线'
			])}</main></body></html>`,
			'https://tutorials.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.signals.tutorialPosts).toBe(5);
		expect(result.reasons).toContain('tutorial_content_dominates');
	});

	it('rejects a site whose content is substantially about self-hosting', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList([
				'我的 HomeLab 网络结构',
				'Tailscale 与 Headscale 使用笔记',
				'Nginx 反代家庭服务器',
				'城市夜行笔记',
				'最近读过的几本书',
				'周末骑行路线',
				'整理旧照片',
				'厨房里的失败实验'
			])}</main></body></html>`,
			'https://homelab.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.signals.selfHostingPosts).toBe(3);
		expect(result.reasons).toContain('self_hosting_content_is_prominent');
	});

	it('rejects procedural technical content without explicit tutorial wording', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList([
				'反编译 PyInstaller 打包程序',
				'从源码编译 wxWidgets',
				'访客卡片 API 使用文档',
				'natapp 免费隧道动态域名解析',
				'Python 自动切换节点与定期备份',
				'城市夜行笔记',
				'最近读过的几本书',
				'周末骑行路线',
				'厨房里的失败实验'
			])}</main></body></html>`,
			'https://operations.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.signals.operationalPosts).toBe(5);
		expect(result.reasons).toContain('operational_tech_content_dominates');
	});

	it('rejects a site filled with near-identical posts', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList([
				'江西省2026年专升本考试政治复习材料第一章',
				'江西省2026年专升本考试政治复习材料第二章',
				'江西省2026年专升本考试政治复习材料第三章',
				'江西省2026年专升本考试政治复习材料第四章',
				'江西省2026年专升本考试政治复习材料第五章',
				'江西省2026年专升本考试政治复习材料第六章',
				'江西省2026年专升本考试政治复习材料第七章',
				'江西省2026年专升本考试政治复习材料第八章'
			])}</main></body></html>`,
			'https://repetitive.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.signals.repetitivePosts).toBe(8);
		expect(result.reasons).toContain('repetitive_content_dominates');
	});

	it('does not confuse a recurring editorial series with duplicate content', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList([
				'FoxThinking #35: 季度总结',
				'FoxThinking #34: 提升免疫力？',
				'FoxThinking #33: 背景音',
				'FoxThinking #32: 等待中',
				'Markon Review Weekly #36',
				'Markon Review Weekly #35',
				'2026 年 5 月新作盘点',
				'2026 年 4 月新作盘点'
			])}</main></body></html>`,
			'https://series.test/'
		);

		expect(result.recommended).toBe(true);
		expect(result.signals.repetitivePosts).toBe(0);
	});

	it('rejects a content-rich stale archive while reporting staleness', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList(
				[
					'城市夜行笔记',
					'一次系统调查记录',
					'最近读过的几本书',
					'周末骑行路线',
					'整理旧照片',
					'厨房里的失败实验',
					'关于长期写作',
					'夏天的声音'
				],
				'2023-01-01'
			)}</main></body></html>`,
			'https://stale.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.signals.latestPostYear).toBe(2023);
		expect(result.reasons).toContain('stale_content');
	});

	it('requires a publication from the previous three calendar months', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T12:00:00Z'));
		try {
			const titles = [
				'城市夜行笔记',
				'一次系统调查记录',
				'最近读过的几本书',
				'周末骑行路线',
				'整理旧照片',
				'厨房里的失败实验',
				'关于长期写作',
				'夏天的声音'
			];
			expect(
				evaluateSiteHTML(
					`<main>${postList(titles, '2026-04-22T12:00:00Z')}</main>`,
					'https://inactive.test/'
				).recommended
			).toBe(false);
			expect(
				evaluateSiteHTML(
					`<main>${postList(titles, '2026-04-23T12:00:00Z')}</main>`,
					'https://active.test/'
				).recommended
			).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a focused active site with five substantial posts', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList([
				'活到宇宙破茧时',
				'Hello Theseus',
				'Gradient 03',
				'Adult Issues',
				'关于解释学的札记'
			])}<time datetime="2026-06-01"></time></main></body></html>`,
			'https://focused.test/'
		);

		expect(result.recommended).toBe(true);
		expect(result.reasons).toContain('focused_active_site');
	});

	it('does not use the focused-site exception for a small tutorial blog', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList([
				'Hexo 博客搭建教程',
				'主题配置踩坑记录',
				'城市夜行笔记',
				'最近读过的几本书',
				'周末骑行路线',
				'厨房里的失败实验',
				'夏天的声音'
			])}<time datetime="2026-06-01"></time></main></body></html>`,
			'https://small-tutorial.test/'
		);

		expect(result.recommended).toBe(false);
		expect(result.reasons).not.toContain('focused_active_site');
	});

	it('rejects a legacy document when it has no verifiable recent publication date', () => {
		const links = [
			['greatwork.html', 'How to Do Great Work'],
			['ideas.html', 'How to Get New Ideas'],
			['read.html', 'The Need to Read'],
			['users.html', "What I've Learned from Users"],
			['words.html', 'Putting Ideas into Words'],
			['taste.html', 'Is There Such a Thing as Good Taste?'],
			['hard.html', 'How to Work Hard'],
			['project.html', "A Project of One's Own"]
		];
		const result = evaluateSiteHTML(
			`<html><body><table>${links
				.map(([href, title]) => `<tr><td><a href="/${href}">${title}</a></td></tr>`)
				.join('')}</table></body></html>`,
			'https://legacy.test/'
		);

		expect(result.signals.sampledPosts).toBe(8);
		expect(result.recommended).toBe(false);
		expect(result.reasons).toContain('no_recent_publication');
	});

	it('ignores impossible future years in page decorations', () => {
		const result = evaluateSiteHTML(
			`<html><body><main>${postList(
				[
					'城市夜行笔记',
					'一次系统调查记录',
					'最近读过的几本书',
					'周末骑行路线',
					'整理旧照片',
					'厨房里的失败实验',
					'关于长期写作',
					'夏天的声音'
				],
				'2023-01-01'
			)}<time datetime="2039-01-01"></time></main></body></html>`,
			'https://future-date.test/'
		);

		expect(result.signals.latestPostYear).toBe(2023);
		expect(result.signals.historyYears).toBe(0);
		expect(result.reasons).toContain('stale_content');
	});

	it('rejects any site-wide decorative feature even below the intensive-theme threshold', () => {
		const result = evaluateSiteHTML(
			`<html><head><script src="/js/APlayer.min.js"></script></head><body><main>${postList([
				'城市夜行笔记',
				'一次系统调查记录',
				'最近读过的几本书',
				'周末骑行路线',
				'整理旧照片',
				'厨房里的失败实验',
				'关于长期写作',
				'夏天的声音'
			])}</main></body></html>`,
			'https://music.test/'
		);

		expect(result.score).toBeGreaterThanOrEqual(70);
		expect(result.signals.themeFeatures).toContain('background-music');
		expect(result.recommended).toBe(false);
	});

	it('reviews an unrendered client-side shell instead of treating it as bad content', () => {
		const result = evaluateSiteHTML(
			'<html><body><div id="app"></div><script type="module" src="/assets/index.js"></script></body></html>',
			'https://spa.test/'
		);

		expect(result.score).toBe(40);
		expect(result.recommended).toBe(false);
		expect(result.reasons).toContain('client_rendered_page_unverified');
	});

	it('evaluates the site homepage when given an inner page', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					`<main>${postList(['一篇正常文章', '另一篇正常文章', '第三篇正常文章'])}</main>`,
					{
						headers: { 'Content-Type': 'text/html' }
					}
				)
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await evaluateSite('https://source.test/links/');
		expect(fetchMock).toHaveBeenCalledWith(
			'https://source.test/',
			expect.objectContaining({ redirect: 'follow' })
		);
		expect(result.url).toBe('https://source.test/');
	});

	it('reuses a prefetched homepage without fetching it again', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const html = `<main>${postList([
			'关于城市步行的三个观察',
			'读完卡利古拉以后',
			'一次数据库迁移事故的复盘',
			'今年使用过的几种写作方法',
			'如何理解网络社区里的信任',
			'一次穿过群山的旅行',
			'给未来项目留下的设计笔记',
			'从一封旧信开始的调查'
		])}</main>`;

		const result = await evaluateSitePage(html, 'https://prefetched.test/');

		expect(result.recommended).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('accepts a recent RSS publication when the homepage omits dates', async () => {
		const titles = [
			'关于城市步行的三个观察',
			'读完卡利古拉以后',
			'一个数据库迁移事故的复盘',
			'今年使用过的几种写作方法',
			'如何理解网络社区里的信任',
			'一次穿过群山的旅行',
			'给未来项目留下的设计笔记',
			'从一封旧信开始的调查'
		];
		const homepage = `<link rel="alternate" type="application/rss+xml" href="/feed.xml"><main>${titles
			.map(
				(title, index) =>
					`<article><h2><a href="/posts/${index}">${title}</a></h2><p>${'原创内容 '.repeat(50)}</p></article>`
			)
			.join('')}</main>`;
		const feed = `<?xml version="1.0"?><rss><channel>${titles
			.map(
				(title) =>
					`<item><title>${title}</title><pubDate>Wed, 22 Jul 2026 12:00:00 GMT</pubDate></item>`
			)
			.join('')}</channel></rss>`;
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-23T12:00:00Z'));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(feed, { headers: { 'Content-Type': 'application/rss+xml' } }))
		);
		try {
			const result = await evaluateSitePage(homepage, 'https://feed-date.test/');
			expect(result.recommended).toBe(true);
			expect(result.signals.latestPostAt).toBe('2026-07-22T12:00:00.000Z');
		} finally {
			vi.useRealTimers();
		}
	});

	it('uses a same-origin feed to evaluate a broader sample of posts', async () => {
		const homepage = `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>
			<main>${postList([
				'城市夜行笔记',
				'最近读过的几本书',
				'周末骑行路线',
				'整理旧照片',
				'关于长期写作',
				'夏天的声音',
				'一封旧信',
				'厨房里的失败实验'
			])}</main></body></html>`;
		const feed = `<?xml version="1.0"?><rss><channel>
			<item><title>Docker 安装完整教程</title></item>
			<item><title>Nginx 配置踩坑指南</title></item>
			<item><title>一键部署自己的网盘</title></item>
			<item><title>HomeLab 网关搭建指南</title></item>
			<item><title>Tailscale 自建服务教程</title></item>
			<item><title>OpenWrt 安装配置</title></item>
			<item><title>如何部署家庭服务器</title></item>
			<item><title>自建 Alist 网盘</title></item>
		</channel></rss>`;
		const fetchMock = vi.fn(async (request: string | URL | Request) => {
			const requestedUrl = String(request);
			return requestedUrl.endsWith('/feed.xml')
				? new Response(feed, {
						headers: { 'Content-Type': 'application/rss+xml' }
					})
				: new Response(homepage, {
						headers: { 'Content-Type': 'text/html' }
					});
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await evaluateSite('https://feed-source.test/');

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.recommended).toBe(false);
		expect(result.signals.feedPosts).toBe(8);
		expect(result.signals.selfHostingPosts).toBeGreaterThanOrEqual(6);
	});

	it('follows an explicit same-origin article archive on a legacy homepage', async () => {
		const homepage = `<html><body><map><area href="articles.html"></map>
			<a href="/recent.html">A Recent Essay</a></body></html>`;
		const archive = `<html><body><table>${[
			['greatwork.html', 'How to Do Great Work'],
			['ideas.html', 'How to Get New Ideas'],
			['read.html', 'The Need to Read'],
			['users.html', "What I've Learned from Users"],
			['words.html', 'Putting Ideas into Words'],
			['taste.html', 'Is There Such a Thing as Good Taste?'],
			['hard.html', 'How to Work Hard'],
			['project.html', "A Project of One's Own"]
		]
			.map(([href, title]) => `<a href="/${href}">${title}</a>`)
			.join('')}</table></body></html>`;
		const fetchMock = vi.fn(async (request: string | URL | Request) => {
			const requestedUrl = String(request);
			return new Response(requestedUrl.endsWith('/articles.html') ? archive : homepage, {
				headers: { 'Content-Type': 'text/html' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await evaluateSite('https://legacy-source.test/');

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.recommended).toBe(false);
		expect(result.reasons).toContain('no_recent_publication');
		expect(result.signals.feedPosts).toBe(0);
		expect(result.signals.archivePosts).toBe(8);
	});

	it('does not fetch a cross-origin feed', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					'<link rel="alternate" type="application/rss+xml" href="https://feeds.test/site.xml"><main>文章</main>',
					{ headers: { 'Content-Type': 'text/html' } }
				)
		);
		vi.stubGlobal('fetch', fetchMock);

		await evaluateSite('https://source.test/');

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
