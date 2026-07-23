import { load, type CheerioAPI } from 'cheerio/slim';
import { readResponseText } from './read-response.js';

export interface SiteEvaluationSignals {
	generator: string | null;
	sampledPosts: number;
	siteBuildingPosts: number;
	tutorialPosts: number;
	selfHostingPosts: number;
	operationalPosts: number;
	repetitivePosts: number;
	themeFeatures: string[];
	historyYears: number;
	latestPostYear: number | null;
	latestPostAt: string | null;
	feedPosts: number;
	archivePosts: number;
}

export interface SiteEvaluation {
	url: string;
	recommended: boolean;
	score: number;
	reasons: string[];
	signals: SiteEvaluationSignals;
}

interface ThemeFeature {
	name: string;
	pattern: RegExp;
	weight: number;
}

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PAGE_CHARACTERS = 300_000;
const MAX_FEED_CHARACTERS = 300_000;
const MAX_SAMPLED_POSTS = 16;
const MAX_ANALYZED_POSTS = 30;

const THEME_FEATURES: ThemeFeature[] = [
	{ name: 'live2d', pattern: /live2d|l2dwidget|waifu-tips|waifu\.css/i, weight: 35 },
	{
		name: 'anzhiyu-theme',
		pattern: /hexo-theme-anzhiyu|anzhiyu-theme|theme-anzhiyu|anzhiyu(?:\.min)?\.(?:css|js)/i,
		weight: 35
	},
	{
		name: 'butterfly-theme',
		pattern: /hexo-theme-butterfly|theme-butterfly|butterfly(?:\.min)?\.(?:css|js)/i,
		weight: 35
	},
	{
		name: 'sakura-theme',
		pattern:
			/hexo-theme-sakura|sakurairo|wp-content\/themes\/sakura|wp-theme-sakura|theme[-_/]sakura|mashiro_option\./i,
		weight: 35
	},
	{
		name: 'decorative-theme',
		pattern: /hexo-theme-(?:shoka|solitude)|theme-(?:shoka|solitude)/i,
		weight: 35
	},
	{
		name: 'stellaris-theme',
		pattern: /hexo-theme-stellar(?:is)?|theme-stellar(?:is)?/i,
		weight: 35
	},
	{
		name: 'kratos-theme',
		pattern: /hexo-theme-kratos(?:-rebirth)?|kratos-rebirth/i,
		weight: 35
	},
	{
		name: 'volantis-theme',
		pattern: /hexo-theme-volantis|theme[-_/]volantis|volantis(?:\.min)?\.(?:css|js)/i,
		weight: 35
	},
	{
		name: 'handsome-theme',
		pattern: /usr\/themes\/handsome|theme[-_/]handsome|handsome_(?:aplayer|meting)/i,
		weight: 35
	},
	{
		name: 'joe-theme',
		pattern: /usr\/themes\/joe(?:\/|[-_.])|theme[-_/]joe(?:\/|[-_.])/i,
		weight: 30
	},
	{
		name: 'argon-theme',
		pattern: /argon-theme|wp-theme-argon/i,
		weight: 35
	},
	{
		name: 'mdx-theme',
		pattern: /wp-content\/themes\/mdx|theme[-_ ]mdx/i,
		weight: 35
	},
	{
		name: 'koharu-theme',
		pattern: /astro-koharu|theme[-_/]koharu/i,
		weight: 35
	},
	{
		name: 'background-music',
		pattern: /meting|aplayer|globalbgmplayer|music\.163\.com\/playlist/i,
		weight: 8
	},
	{
		name: 'cursor-effects',
		pattern:
			/cursor-effects|click-show-text|click-heart|mouse-firework|fireworks(?:\.min)?\.js|activate-power-mode/i,
		weight: 10
	},
	{
		name: 'canvas-effects',
		pattern: /canvas-nest|sakura\.js|particles(?:\.min)?\.js/i,
		weight: 8
	}
];

const SITE_BUILDING_PATTERN =
	/(?:博客|部落格|网站|網站|主题|主題).{0,12}(?:搭建|配置|設定|美化|魔改|装修|裝修|部署|迁移|遷移)|(?:搭建|配置|美化|魔改|部署).{0,12}(?:博客|部落格|网站|網站|主题|主題)|友链申请|友鏈申請|图床|圖床|域名备案|網域備案|评论系统|評論系統|hexo|butterfly|anzhiyu|waline|twikoo|blog\s+(?:setup|theme|deployment)|build(?:ing)?\s+(?:a\s+)?blog|static\s+site\s+theme/i;
const TUTORIAL_PATTERN =
	/(?:教程|指南|指引|踩坑|折腾|折騰|搭建|部署|自建|安装|安裝|配置|設定|设置|迁移|遷移|升级|升級|修复|修復|解决|解決|优化|優化|破解|绕过|繞過|魔改|美化|开箱|開箱|评测|評測|测评|測評|一键|一鍵|setup|install(?:ing|ation)?|configur(?:e|ing|ation)|deploy(?:ing|ment)?|self[- ]host)/i;
const SELF_HOSTING_PATTERN =
	/(?:部署|自建|网关|網關|home\s*lab|homelab|家里云|家裏雲|nas\b|docker|podman|kubernetes|k8s|tailscale|headscale|nginx|caddy|vps|服务器|伺服器|网盘|網盤|宝塔|寶塔|校园网|校園網|光猫|光貓|alist|immich|grafana|prometheus|minio|vnc|反向代理|反代|内网穿透|內網穿透|软路由|軟路由|openwrt|群晖|群暉|飞牛|飛牛|self[- ]host)/i;
const OPERATIONAL_TECH_PATTERN =
	/(?:反编译|反編譯|逆向工程|源码编译|源碼編譯|从源码|從源碼|使用文档|使用文檔|接口文档|接口文檔|api\b|爬虫|爬蟲|爬取|自动(?:切换|切換|备份|備份)|动态域名|動態域名|ddns\b|隧道|旁路网关|旁路網關|网关|網關|路由(?:器|优先级|優先級)?|ipv[46]\b|容器|刷机|刷機|固件|系统镜像|系統鏡像|armbian|openwrt|catwrt|arch(?:\s+linux)?.{0,12}(?:安装|安裝|配置|踩坑)|服务器.{0,10}(?:状态|狀態|监测|監測|配置|安装|安裝)|cloudflare.{0,12}(?:代理|配置|重定向)|git.{0,8}配置|备份|備份|反向代理|反代|内网穿透|內網穿透|compile.{0,12}(?:source|library|framework)|reverse\s+engineer|api\s+(?:reference|documentation)|gateway|router|firmware|flashing|ddns)/i;
const EDITORIAL_SERIES_PATTERN =
	/(?:#\s*\d+\b|\b(?:vol|iss(?:ue)?|weekly)\.?\s*#?\s*\d+\b|20\d{2}\s*年\s*\d{1,2}\s*月|(?:周|月|季)刊|季度(?:总结|總結))/i;
const GENERIC_TITLE_PATTERN =
	/^(?:home|about|archive|archives|categories|category|tags?|links?|friends?|resources?|首页|首頁|关于|關於|归档|歸檔|分类|分類|标签|標籤|友链|友情链接|资源|推薦|推荐)$/i;
const GENERIC_CONTENT_PATH_PATTERN =
	/^\/(?:about|now|archives?|categories?|tags?|links?|friends?|resources?|rss|feed)(?:\/|$)/i;

function cleanText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function collectPostTitles($: CheerioAPI, pageUrl: string): string[] {
	const titles: string[] = [];
	const seen = new Set<string>();
	const selectors = [
		'article h1',
		'article h2',
		'article h3',
		'main article h1',
		'main article h2',
		'main article h3',
		'main [class*="post-title"]',
		'main [class*="article-title"]',
		'main [class*="recent-post"] [class*="title"]',
		'[class*="post-list"] [class*="post-title"]',
		'[class*="post-card"] [class*="post-title"]',
		'[class*="recent-post"] [class*="article-title"]',
		'article [class~="title"] a[href]',
		'[role="article"] [class~="title"] a[href]',
		'main a[href] h1',
		'main a[href] h2',
		'main a[href] h3',
		'main h2 a[href]',
		'main h3 a[href]'
	].join(', ');

	$(selectors).each((_, element) => {
		if (titles.length >= MAX_SAMPLED_POSTS) return false;
		if ($(element).closest('nav, footer, aside, form').length) return;
		const title = cleanText($(element).text());
		if (
			title.length < 3 ||
			title.length > 160 ||
			GENERIC_TITLE_PATTERN.test(title) ||
			seen.has(title)
		) {
			return;
		}
		seen.add(title);
		titles.push(title);
	});

	$('h1, h2, h3').each((_, element) => {
		if (titles.length >= MAX_SAMPLED_POSTS) return false;
		const heading = cleanText($(element).text());
		if (!/^(?:articles?|posts?|writing|文章|博客文章|博文)$/i.test(heading)) return;

		$(element)
			.nextUntil('h1, h2, h3')
			.filter('ul, ol')
			.find('li a[href]')
			.each((_, anchor) => {
				if (titles.length >= MAX_SAMPLED_POSTS) return false;
				const title = cleanText($(anchor).text());
				if (
					title.length < 3 ||
					title.length > 160 ||
					GENERIC_TITLE_PATTERN.test(title) ||
					seen.has(title)
				) {
					return;
				}
				seen.add(title);
				titles.push(title);
			});
	});

	$('main a[href]').each((_, element) => {
		if (titles.length >= MAX_SAMPLED_POSTS) return false;
		const $anchor = $(element);
		if ($anchor.closest('nav, footer, aside, form').length) return;
		if (/meta|tag|categor|more|unvisited/i.test($anchor.attr('class') || '')) return;

		const rawHref = $anchor.attr('href');
		if (!rawHref) return;
		let url: URL;
		try {
			url = new URL(rawHref, pageUrl);
		} catch {
			return;
		}
		if (url.origin !== new URL(pageUrl).origin || url.pathname === '/') return;
		if (
			GENERIC_CONTENT_PATH_PATTERN.test(url.pathname) ||
			/\.(?:atom|rss|xml)$/i.test(url.pathname)
		) {
			return;
		}

		const title = cleanText($anchor.attr('title') || $anchor.text());
		if (
			title.length < 3 ||
			title.length > 160 ||
			GENERIC_TITLE_PATTERN.test(title) ||
			seen.has(title)
		) {
			return;
		}
		seen.add(title);
		titles.push(title);
	});

	const hasModernContentRoot = $('main, article, [role="main"], #content, .content').length > 0;
	const looksLikeLegacyDocument =
		!hasModernContentRoot &&
		$('table').length > 0 &&
		$('script[type="module"], script[src*="/assets/"], [class*="post"], [class*="article"]')
			.length === 0;
	if (titles.length < 8 && looksLikeLegacyDocument) {
		const pageHostname = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
		$('body a[href]').each((_, element) => {
			if (titles.length >= MAX_SAMPLED_POSTS) return false;
			const $anchor = $(element);
			if ($anchor.closest('header, nav, footer, aside, form').length) return;

			const rawHref = $anchor.attr('href');
			if (!rawHref) return;
			let url: URL;
			try {
				url = new URL(rawHref, pageUrl);
			} catch {
				return;
			}
			if (
				url.hostname.toLowerCase().replace(/^www\./, '') !== pageHostname ||
				url.pathname === '/'
			) {
				return;
			}
			if (GENERIC_CONTENT_PATH_PATTERN.test(url.pathname)) return;

			const title = cleanText($anchor.attr('title') || $anchor.text());
			if (
				title.length < 4 ||
				title.length > 160 ||
				GENERIC_TITLE_PATTERN.test(title) ||
				seen.has(title)
			) {
				return;
			}
			seen.add(title);
			titles.push(title);
		});
	}

	return titles;
}

function mainTextLength($: CheerioAPI): number {
	const scopes = $(
		'main, [role="main"], #content, .content, .column-main, .l_main, #recent-posts, .post-list, .markdown-body'
	).toArray();
	const roots = scopes.length > 0 ? scopes : $('body').toArray();
	return roots.reduce((longest, element) => {
		const root = $(element).clone();
		root.find('script, style, header, nav, footer, aside, form').remove();
		return Math.max(longest, cleanText(root.text()).length);
	}, 0);
}

function parsePublishedDate(value: string, currentYear: number): Date | null {
	const normalized = cleanText(value);
	const chineseDate = normalized.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
	const timestamp = chineseDate
		? Date.UTC(Number(chineseDate[1]), Number(chineseDate[2]) - 1, Number(chineseDate[3]))
		: Date.parse(normalized);
	if (!Number.isFinite(timestamp)) return null;

	const date = new Date(timestamp);
	if (date.getUTCFullYear() < 1990 || date.getUTCFullYear() > currentYear) return null;
	return date;
}

function historySignals($: CheerioAPI): {
	span: number;
	latest: number | null;
	latestAt: Date | null;
} {
	const currentYear = new Date().getUTCFullYear();
	const dates = $('time[datetime], [class*="date"], [class*="time"]')
		.map((_, element) => {
			const value = `${$(element).attr('datetime') || ''} ${$(element).text()}`;
			return parsePublishedDate(value, currentYear);
		})
		.get()
		.filter((date): date is Date => date instanceof Date);
	const years = dates.map((date) => date.getUTCFullYear());

	if (years.length === 0) return { span: 0, latest: null, latestAt: null };
	const latestAt = new Date(Math.max(...dates.map((date) => date.getTime())));
	return {
		span: years.length < 2 ? 0 : Math.max(...years) - Math.min(...years),
		latest: latestAt.getUTCFullYear(),
		latestAt
	};
}

function titleBigrams(title: string): Set<string> {
	const normalized = title.toLowerCase().replace(/[\p{P}\p{S}\s\d_]+/gu, '');
	const characters = Array.from(normalized);
	const bigrams = new Set<string>();
	for (let index = 0; index < characters.length - 1; index += 1) {
		bigrams.add(`${characters[index]}${characters[index + 1]}`);
	}
	return bigrams;
}

function similarity(left: Set<string>, right: Set<string>): number {
	if (left.size === 0 || right.size === 0) return 0;
	let intersection = 0;
	for (const value of left) {
		if (right.has(value)) intersection += 1;
	}
	return intersection / (left.size + right.size - intersection);
}

function repetitiveTitleCount(titles: string[]): number {
	const grams = titles.map(titleBigrams);
	return titles.filter(
		(title, index) =>
			!EDITORIAL_SERIES_PATTERN.test(title) &&
			grams.some((candidate, otherIndex) =>
				otherIndex === index || EDITORIAL_SERIES_PATTERN.test(titles[otherIndex])
					? false
					: similarity(grams[index], candidate) >= 0.5
			)
	).length;
}

function themeSignals($: CheerioAPI, html: string): { features: string[]; risk: number } {
	const assets = $('script[src], link[href], footer a[href], [class*="footer"] a[href]')
		.map((_, element) => $(element).attr('src') || $(element).attr('href') || '')
		.get()
		.join('\n');
	const inlineScripts = $('script:not([src])')
		.map((_, element) => $(element).html() || '')
		.get()
		.join('\n')
		.slice(0, 100_000);
	const themeMetadata = $('meta[name*="theme"], body, html[data-theme], [theme-info]')
		.map(
			(_, element) =>
				$(element).attr('content') ||
				$(element).attr('data-type') ||
				$(element).attr('data-theme') ||
				$(element).attr('theme-info') ||
				$(element).attr('class') ||
				''
		)
		.get()
		.join('\n');
	const fingerprints = `${assets}\n${inlineScripts}\n${themeMetadata}`;
	const matched = THEME_FEATURES.filter((feature) => feature.pattern.test(fingerprints));
	const hasBackgroundCarousel =
		$('[data-background-image]').length >= 6 &&
		/carousel|slide-list|carouselAnimationTime/i.test(html);
	const structuralRisk = hasBackgroundCarousel ? 30 : 0;
	const features = matched.map((feature) => feature.name);
	if (hasBackgroundCarousel) features.push('background-carousel');
	return {
		features,
		risk: Math.min(
			35,
			matched.reduce((total, feature) => total + feature.weight, structuralRisk)
		)
	};
}

function isClientRenderedShell($: CheerioAPI, titles: string[], textLength: number): boolean {
	if (titles.length > 0 || textLength >= 250) return false;
	const hasEmptyAppRoot = $('#app, #root, #__next')
		.toArray()
		.some((element) => $(element).children().length === 0 && cleanText($(element).text()) === '');
	const hasApplicationBundle = $('script[src*="/assets/"], script[type*="module"]').length > 0;
	return hasEmptyAppRoot && hasApplicationBundle;
}

function generatorName($: CheerioAPI): string | null {
	const generator = cleanText($('meta[name="generator"]').attr('content') || '');
	return generator ? generator.slice(0, 80) : null;
}

export function evaluateSiteHTML(
	html: string,
	url: string,
	additionalTitles: string[] = [],
	additionalSignals: {
		feedPosts?: number;
		archivePosts?: number;
		latestPublishedAt?: Date | null;
	} = {}
): SiteEvaluation {
	// DOM parsing dominates this evaluator's CPU use. Keep one parsed document
	// per page and share it across all signals instead of reparsing the same HTML.
	const $ = load(html);
	const pageTitles = collectPostTitles($, url);
	const titles = Array.from(new Set([...pageTitles, ...additionalTitles])).slice(
		0,
		MAX_ANALYZED_POSTS
	);
	const buildingPosts = titles.filter((title) => SITE_BUILDING_PATTERN.test(title));
	const tutorialPosts = titles.filter((title) => TUTORIAL_PATTERN.test(title));
	const selfHostingPosts = titles.filter((title) => SELF_HOSTING_PATTERN.test(title));
	const operationalPosts = titles.filter((title) => OPERATIONAL_TECH_PATTERN.test(title));
	const repetitivePosts = repetitiveTitleCount(titles);
	const nonBuildingPosts = titles.length - buildingPosts.length;
	const buildingRatio = titles.length > 0 ? buildingPosts.length / titles.length : 0;
	const tutorialRatio = titles.length > 0 ? tutorialPosts.length / titles.length : 0;
	const selfHostingRatio = titles.length > 0 ? selfHostingPosts.length / titles.length : 0;
	const operationalRatio = titles.length > 0 ? operationalPosts.length / titles.length : 0;
	const repetitiveRatio = titles.length > 0 ? repetitivePosts / titles.length : 0;
	const textLength = mainTextLength($);
	const history = historySignals($);
	const theme = themeSignals($, html);
	const generator = generatorName($);
	const clientRenderedShell = isClientRenderedShell($, titles, textLength);
	const latestPostAt = [history.latestAt, additionalSignals.latestPublishedAt]
		.filter((date): date is Date => date instanceof Date)
		.reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null);
	const recentPublicationThreshold = new Date();
	recentPublicationThreshold.setUTCMonth(recentPublicationThreshold.getUTCMonth() - 3);
	const hasRecentPublication =
		latestPostAt !== null && latestPostAt.getTime() >= recentPublicationThreshold.getTime();
	const reasons: string[] = [];
	let score = 50;

	if (titles.length >= 8) {
		score += 15;
		reasons.push('many_content_entries');
	} else if (titles.length >= 3) {
		score += 5;
	} else {
		score -= 10;
		reasons.push('limited_visible_content');
	}

	if (nonBuildingPosts >= 6) {
		score += 15;
		reasons.push('original_content_variety');
	} else if (titles.length >= 3 && nonBuildingPosts === 0) {
		score -= 15;
		reasons.push('no_visible_non_building_content');
	}

	if (textLength >= 2_000) {
		score += 10;
		reasons.push('substantial_homepage_content');
	} else if (textLength >= 700) {
		score += 5;
	} else if (textLength < 250) {
		score -= 10;
		reasons.push('thin_homepage_content');
	}

	if (history.span >= 2) {
		score += 10;
		reasons.push('long_running_archive');
	} else if (history.span >= 1) {
		score += 5;
	}

	if (history.latest !== null && history.latest < new Date().getUTCFullYear() - 1) {
		score -= 25;
		reasons.push('stale_content');
	}
	if (!hasRecentPublication) reasons.push('no_recent_publication');

	if (
		titles.length >= 5 &&
		titles.length < 8 &&
		nonBuildingPosts === titles.length &&
		tutorialRatio < 0.2 &&
		selfHostingPosts.length === 0 &&
		operationalPosts.length === 0 &&
		history.latest !== null &&
		history.latest >= new Date().getUTCFullYear() - 1
	) {
		score += 10;
		reasons.push('focused_active_site');
	}

	if (clientRenderedShell) {
		score = Math.max(score, 40);
		reasons.push('client_rendered_page_unverified');
	}

	if (theme.risk > 0) {
		score -= theme.risk;
		reasons.push('decorative_theme_features');
	}
	if (theme.risk >= 30) {
		score -= 30;
		reasons.push('intensive_decorative_theme');
		reasons.push('recommendation_blocked_by_theme');
	}

	if (titles.length >= 4 && buildingRatio >= 0.6) {
		score -= 40;
		reasons.push('site_building_content_dominates');
	} else if (titles.length >= 4 && buildingRatio >= 0.4) {
		score -= 25;
		reasons.push('site_building_content_is_prominent');
	} else if (titles.length >= 4 && buildingRatio >= 0.25) {
		score -= 12;
		reasons.push('site_building_content_is_common');
	}

	if (theme.risk >= 20 && titles.length >= 4 && buildingRatio >= 0.25) {
		score -= 10;
		reasons.push('theme_showcase_pattern');
	}

	if (titles.length >= 6 && tutorialRatio >= 0.55) {
		score -= 35;
		reasons.push('tutorial_content_dominates');
	} else if (titles.length >= 6 && tutorialRatio >= 0.3) {
		score -= 25;
		reasons.push('tutorial_content_is_prominent');
	}

	if (titles.length >= 6 && selfHostingRatio >= 0.4) {
		score -= 30;
		reasons.push('self_hosting_content_dominates');
	} else if (titles.length >= 6 && selfHostingRatio >= 0.2) {
		score -= 18;
		reasons.push('self_hosting_content_is_prominent');
	}

	if (titles.length >= 6 && operationalRatio >= 0.5) {
		score -= 30;
		reasons.push('operational_tech_content_dominates');
	} else if (titles.length >= 6 && operationalRatio >= 0.3) {
		score -= 20;
		reasons.push('operational_tech_content_is_prominent');
	}

	if (titles.length >= 8 && repetitiveRatio >= 0.55) {
		score -= 35;
		reasons.push('repetitive_content_dominates');
	}

	score = Math.max(0, Math.min(100, Math.round(score)));
	const enoughContent =
		titles.length >= 8 ||
		(titles.length >= 5 &&
			nonBuildingPosts === titles.length &&
			tutorialRatio < 0.2 &&
			selfHostingPosts.length === 0 &&
			operationalPosts.length === 0 &&
			history.latest !== null &&
			history.latest >= new Date().getUTCFullYear() - 1);
	const recommended =
		score >= 70 &&
		enoughContent &&
		theme.risk === 0 &&
		!clientRenderedShell &&
		buildingRatio < 0.25 &&
		tutorialRatio < 0.3 &&
		selfHostingRatio < 0.2 &&
		operationalRatio < 0.3 &&
		repetitiveRatio < 0.55 &&
		hasRecentPublication;

	return {
		url,
		recommended,
		score,
		reasons,
		signals: {
			generator,
			sampledPosts: titles.length,
			siteBuildingPosts: buildingPosts.length,
			tutorialPosts: tutorialPosts.length,
			selfHostingPosts: selfHostingPosts.length,
			operationalPosts: operationalPosts.length,
			repetitivePosts,
			themeFeatures: theme.features,
			historyYears: history.span,
			latestPostYear: latestPostAt?.getUTCFullYear() || history.latest,
			latestPostAt: latestPostAt?.toISOString() || null,
			feedPosts: additionalSignals.feedPosts ?? additionalTitles.length,
			archivePosts: additionalSignals.archivePosts ?? 0
		}
	};
}

async function fetchPage(url: string): Promise<{ url: string; html: string }> {
	let response: Response | null = null;
	let lastError: unknown;

	for (let attempt = 0; attempt < 2; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			response = await fetch(url, {
				headers: {
					Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
					'User-Agent': 'rss-finder/2.0'
				},
				redirect: 'follow',
				signal: controller.signal
			});
			break;
		} catch (error) {
			lastError = error;
		} finally {
			clearTimeout(timeout);
		}
	}

	if (!response) throw lastError;
	if (!response.ok) throw new Error(`Target returned HTTP ${response.status}`);
	const contentType = response.headers.get('content-type');
	if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
		throw new Error(`Target returned unsupported content type: ${contentType}`);
	}

	return {
		url: response.url || url,
		html: await readResponseText(response, MAX_PAGE_CHARACTERS, REQUEST_TIMEOUT_MS)
	};
}

function discoverSameOriginFeed(html: string, pageUrl: string): string | null {
	const $ = load(html);
	const page = new URL(pageUrl);
	let discovered: string | null = null;

	$('link[rel~="alternate"][href]').each((_, element) => {
		if (discovered) return false;
		const type = ($(element).attr('type') || '').toLowerCase();
		if (!/(?:rss|atom|feed\+json|application\/json)/i.test(type)) return;

		try {
			const candidate = new URL($(element).attr('href') || '', page);
			if (
				candidate.origin === page.origin &&
				(candidate.protocol === 'http:' || candidate.protocol === 'https:')
			) {
				discovered = candidate.href;
			}
		} catch {
			// Ignore malformed feed links; the homepage result remains usable.
		}
	});

	return discovered;
}

function discoverSameOriginArchive(html: string, pageUrl: string): string | null {
	const $ = load(html);
	const page = new URL(pageUrl);
	const pageHostname = page.hostname.toLowerCase().replace(/^www\./, '');
	let discovered: string | null = null;

	$('a[href], area[href]').each((_, element) => {
		if (discovered) return false;
		try {
			const candidate = new URL($(element).attr('href') || '', page);
			const hostname = candidate.hostname.toLowerCase().replace(/^www\./, '');
			if (
				hostname === pageHostname &&
				(candidate.protocol === 'http:' || candidate.protocol === 'https:') &&
				/(?:^|\/)(?:articles?|essays?|writing|posts?|archives?)(?:\.html?|\/)?$/i.test(
					candidate.pathname
				)
			) {
				discovered = candidate.href;
			}
		} catch {
			// Ignore malformed archive links.
		}
	});

	return discovered;
}

interface FeedSummary {
	titles: string[];
	latestPublishedAt: Date | null;
}

function parseFeedSummary(body: string, contentType: string): FeedSummary {
	const titles: string[] = [];
	const seen = new Set<string>();
	const dates: Date[] = [];
	const currentYear = new Date().getUTCFullYear();
	const addTitle = (value: unknown) => {
		if (typeof value !== 'string' || titles.length >= MAX_ANALYZED_POSTS) return;
		const title = cleanText(value);
		if (title.length < 3 || title.length > 160 || seen.has(title)) return;
		seen.add(title);
		titles.push(title);
	};
	const addDate = (value: unknown) => {
		if (typeof value !== 'string') return;
		const date = parsePublishedDate(value, currentYear);
		if (date) dates.push(date);
	};
	const summary = (): FeedSummary => ({
		titles,
		latestPublishedAt:
			dates.length > 0 ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null
	});

	if (/json/i.test(contentType) || /^\s*\{/.test(body)) {
		try {
			const feed = JSON.parse(body) as {
				items?: Array<{ title?: unknown; date_published?: unknown; date_modified?: unknown }>;
			};
			for (const item of feed.items || []) {
				addTitle(item.title);
				addDate(item.date_published);
				addDate(item.date_modified);
			}
			return summary();
		} catch {
			return summary();
		}
	}

	const $ = load(body, { xmlMode: true });
	$('item > title, entry > title').each((_, element) => addTitle($(element).text()));
	$(
		'item > pubDate, item > date, item > updated, item > published, entry > updated, entry > published'
	).each((_, element) => addDate($(element).text()));
	return summary();
}

async function fetchFeedSummary(url: string): Promise<FeedSummary> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				Accept:
					'application/atom+xml,application/rss+xml,application/feed+json,application/json;q=0.9,application/xml;q=0.8,text/xml;q=0.8,*/*;q=0.1',
				'User-Agent': 'rss-finder/2.0'
			},
			redirect: 'follow',
			signal: controller.signal
		});
		if (!response.ok) return { titles: [], latestPublishedAt: null };

		const finalUrl = new URL(response.url || url);
		if (finalUrl.origin !== new URL(url).origin) return { titles: [], latestPublishedAt: null };
		const contentType = response.headers.get('content-type') || '';
		const body = await readResponseText(response, MAX_FEED_CHARACTERS, REQUEST_TIMEOUT_MS);
		return parseFeedSummary(body, contentType);
	} catch {
		return { titles: [], latestPublishedAt: null };
	} finally {
		clearTimeout(timeout);
	}
}

export async function evaluateSitePage(html: string, url: string): Promise<SiteEvaluation> {
	const feedUrl = discoverSameOriginFeed(html, url);
	const feed = feedUrl ? await fetchFeedSummary(feedUrl) : { titles: [], latestPublishedAt: null };
	let archiveTitles: string[] = [];
	if (feed.titles.length < 8) {
		const archiveUrl = discoverSameOriginArchive(html, url);
		if (archiveUrl) {
			try {
				const archive = await fetchPage(archiveUrl);
				archiveTitles = collectPostTitles(load(archive.html), archive.url);
			} catch {
				// The homepage evaluation remains usable when an archive page fails.
			}
		}
	}
	return evaluateSiteHTML(html, url, [...feed.titles, ...archiveTitles], {
		feedPosts: feed.titles.length,
		archivePosts: archiveTitles.length,
		latestPublishedAt: feed.latestPublishedAt
	});
}

export async function evaluateSite(url: string): Promise<SiteEvaluation> {
	const page = await fetchPage(new URL('/', url).href);
	return evaluateSitePage(page.html, page.url);
}
