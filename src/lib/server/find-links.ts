import { load, type CheerioAPI } from 'cheerio/slim';
import {
	deduplicateFeeds,
	isEmptyFeed,
	parseHTMLContent,
	parseRSSContent,
	type Feed
} from 'feedfinder-ts';
import { getDomain } from 'tldts';
import { evaluateSitePage } from './evaluate-site.js';
import { readResponseText } from './read-response.js';

export interface DiscoveredLink {
	title: string;
	url: string;
}

export interface DiscoveredLinkWithFeeds extends DiscoveredLink {
	favicon: string | null;
	description: string | null;
	feeds: Feed[];
}

export interface LinkDiscoveryResult {
	links: DiscoveredLinkWithFeeds[];
}

interface FetchedPage {
	url: string;
	html: string;
}

interface FeedDiscovery {
	page: FetchedPage;
	feeds: Feed[];
}

interface CandidatePage {
	url: string;
	score: number;
	order: number;
}

interface LinkCandidate extends DiscoveredLink {
	quality: number;
	order: number;
}

const REQUEST_TIMEOUT_MS = 8_000;
const FEED_CHECK_TIMEOUT_MS = 5_000;
const MAX_PAGE_CHARACTERS = 600_000;
const MAX_FEED_PAGE_CHARACTERS = 250_000;
const MAX_CANDIDATE_PAGES = 2;
const MAX_FEED_CHECKS = 12;
const FEED_CHECK_CONCURRENCY = 3;
const EVALUATION_CONCURRENCY = 2;
const MAX_RESULTS = 100;

const RECOMMENDATION_PATTERNS = [
	/\bblog\s*roll\b/i,
	/\blink\s*roll\b/i,
	/\bfriends?(?:\s+(?:links?|blogs?))?\b/i,
	/\bblogs?\s+(?:i|we)\s+(?:follow|read|like)\b/i,
	/\bresources?\b/i,
	/\btools?\b/i,
	/\brecommend(?:ed|ations?)?\b/i,
	/\breading\s*list\b/i,
	/\bbookmarks?\b/i,
	/\bfavou?rites?\b/i,
	/\bcurated\s+(?:links?|sites?|resources?)\b/i,
	/\b(?:my|our)\s+picks?\b/i,
	/^\/?uses?\/?$/i,
	/友(?:情)?链|友站|博友|博客圈|朋友们?|联盟链接/i,
	/资源|工具|推荐|精选|收藏|书签|阅读清单|爱用|愛用/i,
	/(?:常看|常读|常讀|关注|關注).*(?:博客|部落格)/i,
	/(?:个人|個人).*(?:博客|部落格)/i
];
const NETWORK_RECOMMENDATION_PATTERN =
	/\b(?:blog\s*roll|link\s*roll|friends?(?:\s+(?:links?|blogs?))?)\b|友(?:情)?链|友站|博友|博客圈|联盟链接/i;
const FOCUSED_BLOG_COLLECTION_PATTERN =
	/\bblogs?\s+(?:i|we)\s+(?:follow|read|like)\b|(?:常看|常读|常讀|关注|關注).*(?:博客|部落格)|\b(?:blog\s*roll|link\s*roll|friends?(?:\s+(?:links?|blogs?))?)\b|友(?:情)?链|友站|博友|博客圈|联盟链接/i;

const SIMPLE_CANDIDATE_LABEL_PATTERN =
	/^(?:blog\s*roll|link\s*roll|friends?|friend(?:ship)? links?|links?|resources?|recommend(?:ed|ations?)?|reading list|bookmarks?|favou?rites?|picks?|uses?|友链|友情链接|友站|朋友们?|联盟链接|链接|资源|推荐|精选|收藏|书签|阅读清单|爱用|愛用)$/i;
const CANDIDATE_PATH_PATTERN =
	/^(?:blogroll|linkroll|friends?|friend-links?|friendship-links?|links?|resources?|recommendations?|recommended-reading|reading-list|bookmarks?|favorites?|favourites?|picks?|uses?|友链|友情链接|友站|资源|推荐|精选|收藏|书签)$/i;
const ASSET_PATH_PATTERN =
	/\.(?:avif|bmp|css|gif|ico|jpe?g|js|map|mp3|mp4|pdf|png|svg|webm|webp|woff2?|ttf|eot)$/i;
const FEED_LABEL_PATTERN = /^(?:rss|atom|feeds?|订阅|訂閱)(?:\s*(?:feed|源))?$/i;
const AUXILIARY_LABEL_PATTERN =
	/^(?:home|homepage|website|visit|blog|notes?|source|more|主页|首頁|首页|网站|網站|博客|部落格|笔记|筆記|源码|源碼|更多|详情|詳情)$/i;
const RELAY_LABEL_PATTERN =
	/^(?:previous|next|random|prev|webring|上一站|下一站|随机|隨機|←|→|↔)$/i;
const TRACKING_PARAMETERS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);
const EXCLUDED_HOSTS = new Set([
	'bilibili.com',
	'bsky.app',
	'buymeacoffee.com',
	'discord.com',
	'discord.gg',
	'discordapp.com',
	'facebook.com',
	'feedly.com',
	'instagram.com',
	'ko-fi.com',
	'linkedin.com',
	'mastodon.social',
	'matrix.to',
	'patreon.com',
	'qm.qq.com',
	't.me',
	'tiktok.com',
	'twitter.com',
	'weibo.com',
	'x.com',
	'youtube.com',
	'youtu.be'
]);
const CARD_SELECTOR = [
	'li',
	'tr',
	'[data-card]',
	'[data-link-card]',
	'[class~="card"]',
	'[class*="-card"]',
	'[class*="card-"]',
	'[class*="friend-item"]',
	'[class*="link-item"]',
	'[class*="resource-item"]',
	'[class*="bookmark-item"]'
].join(', ');
const STRUCTURE_SELECTOR = [
	CARD_SELECTOR,
	'ul',
	'ol',
	'table',
	'[class~="grid"]',
	'[class*="grid-"]',
	'[class*="grid-cols"]'
].join(', ');

function cleanText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function cleanHeadingText(value: string): string {
	return cleanText(value)
		.replace(/^[^\p{L}\p{N}]+/u, '')
		.replace(/[^\p{L}\p{N}]+$/u, '');
}

function normalizedHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^www\./, '');
}

function registrableDomain(hostname: string): string {
	return (
		getDomain(normalizedHostname(hostname), { allowPrivateDomains: true }) ||
		normalizedHostname(hostname)
	);
}

function isSameSite(left: string, right: string): boolean {
	return registrableDomain(left) === registrableDomain(right);
}

function matchesRecommendation(value: string): boolean {
	const text = cleanHeadingText(value);
	return RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(text));
}

function hasCandidatePath(url: URL): boolean {
	let pathname = url.pathname;
	try {
		pathname = decodeURIComponent(pathname);
	} catch {
		// Keep the encoded path if it cannot be decoded.
	}
	const lastSegment = pathname.split('/').filter(Boolean).at(-1) || '';
	return CANDIDATE_PATH_PATTERN.test(lastSegment.replace(/\.html?$/i, ''));
}

function canonicalizeURL(rawUrl: string, baseUrl: string): URL | null {
	try {
		const url = new URL(rawUrl, baseUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

		url.hash = '';
		for (const key of [...url.searchParams.keys()]) {
			if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key.toLowerCase())) {
				url.searchParams.delete(key);
			}
		}
		url.searchParams.sort();

		return url;
	} catch {
		return null;
	}
}

function extractSiteMetadata(html: string, pageUrl: string) {
	const $ = load(html);
	const description = cleanText(
		$('meta[name="description"]').first().attr('content') ||
			$('meta[property="og:description"]').first().attr('content') ||
			$('meta[name="twitter:description"]').first().attr('content') ||
			''
	);
	let favicon: string | null = null;

	$('link[rel][href]').each((_, element) => {
		if (favicon) return false;
		const rel = ($(element).attr('rel') || '').toLowerCase().split(/\s+/);
		if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) return;
		favicon = canonicalizeURL($(element).attr('href') || '', pageUrl)?.href || null;
	});

	return {
		favicon,
		description: description ? description.slice(0, 300) : null
	};
}

function anchorLabel($anchor: ReturnType<CheerioAPI>): string {
	const nestedTitle = $anchor
		.find('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"], strong, b')
		.first()
		.text();
	const imageAlt = $anchor.find('img[alt]').first().attr('alt') || '';
	return cleanText(
		nestedTitle || $anchor.attr('title') || $anchor.attr('aria-label') || $anchor.text() || imageAlt
	);
}

function linkTitle($anchor: ReturnType<CheerioAPI>, url: URL): string {
	const label = anchorLabel($anchor);
	if (!label || !/[\p{L}\p{N}]/u.test(label)) return normalizedHostname(url.hostname);
	return label.slice(0, 120);
}

function isFeedLink(url: URL, label: string): boolean {
	if (FEED_LABEL_PATTERN.test(label)) return true;
	if (/\.(?:atom|rss|xml)$/i.test(url.pathname)) return true;
	if (/(?:^|\/)(?:atom|feed|feeds|rss)(?:\/|$)/i.test(url.pathname)) return true;
	return [...url.searchParams.entries()].some(
		([key, value]) => /^(?:alt|format|output)$/i.test(key) && /^(?:atom|feed|rss)$/i.test(value)
	);
}

function isExcludedHost(hostname: string): boolean {
	const normalized = normalizedHostname(hostname);
	return [...EXCLUDED_HOSTS].some(
		(excluded) => normalized === excluded || normalized.endsWith(`.${excluded}`)
	);
}

function isBareCodeProfile(url: URL): boolean {
	const hostname = normalizedHostname(url.hostname);
	if (!['github.com', 'gitlab.com'].includes(hostname)) return false;
	return url.pathname.split('/').filter(Boolean).length < 2;
}

function isExcludedLink(
	url: URL,
	label: string,
	$anchor: ReturnType<CheerioAPI>,
	targetHostname: string
): boolean {
	if (isSameSite(url.hostname, targetHostname)) return true;
	if (ASSET_PATH_PATTERN.test(url.pathname) || isFeedLink(url, label)) return true;
	if (isExcludedHost(url.hostname) || isBareCodeProfile(url)) return true;
	if (RELAY_LABEL_PATTERN.test(label)) return true;

	const rel = new Set(($anchor.attr('rel') || '').toLowerCase().split(/\s+/).filter(Boolean));
	if (rel.has('me') || rel.has('license') || rel.has('sponsored')) return true;
	if (
		normalizedHostname(url.hostname) === 'creativecommons.org' ||
		(normalizedHostname(url.hostname) === 'gnu.org' && url.pathname.startsWith('/licenses/'))
	) {
		return true;
	}
	if (
		$anchor.closest('[class*="advert"], [id*="advert"], [class*="sponsor"], [id*="sponsor"]').length
	) {
		return true;
	}

	return false;
}

function hasCuratedStructure($anchor: ReturnType<CheerioAPI>): boolean {
	return (
		$anchor.is('[data-card], [data-link-card], [class~="card"], [class~="block"]') ||
		$anchor.closest(STRUCTURE_SELECTOR).length > 0
	);
}

function candidateQuality($anchor: ReturnType<CheerioAPI>, title: string, url: URL): number {
	let quality = 0;
	if (!AUXILIARY_LABEL_PATTERN.test(title)) quality += 20;
	if (url.pathname === '/' || url.pathname === '') quality += 5;
	if ($anchor.find('h1, h2, h3, h4, h5, h6, strong, b').length > 0) quality += 4;
	if ($anchor.is('[data-card], [data-link-card], [class~="card"], [class~="block"]')) {
		quality += 3;
	}
	return quality;
}

function collectScopeLinks(
	$: CheerioAPI,
	scope: ReturnType<CheerioAPI>,
	pageUrl: string,
	targetUrl: string,
	allowUnstructured: boolean
): DiscoveredLink[] {
	const targetHostname = new URL(targetUrl).hostname;
	const groups = new Map<object, LinkCandidate[]>();
	let order = 0;

	scope
		.filter('a[href]')
		.add(scope.find('a[href]'))
		.each((_, element) => {
			const $anchor = $(element);
			if ($anchor.closest('header, nav, footer, aside, form').length) return;
			if (!allowUnstructured && !hasCuratedStructure($anchor)) return;

			const rawHref = $anchor.attr('href');
			if (!rawHref) return;
			const url = canonicalizeURL(rawHref, pageUrl);
			if (!url) return;

			const label = anchorLabel($anchor);
			if (isExcludedLink(url, label, $anchor, targetHostname)) return;

			const $card = $anchor.closest(CARD_SELECTOR).first();
			const cardElement = $card.get(0);
			const key = (cardElement || element) as object;
			const title = linkTitle($anchor, url);
			const candidate: LinkCandidate = {
				title,
				url: url.href,
				quality: candidateQuality($anchor, title, url),
				order: order++
			};
			const existing = groups.get(key) || [];
			existing.push(candidate);
			groups.set(key, existing);
		});

	return [...groups.values()]
		.map(
			(group) =>
				group.sort((left, right) => right.quality - left.quality || left.order - right.order)[0]
		)
		.sort((left, right) => left.order - right.order)
		.map(({ title, url }) => ({ title, url }));
}

function contentScope($: CheerioAPI): ReturnType<CheerioAPI> {
	const content = $('main, [role="main"], article, #content, .content, .post-content').first();
	return content.length ? content : $('body');
}

function recommendationScopes(
	$: CheerioAPI,
	root: ReturnType<CheerioAPI>
): Array<ReturnType<CheerioAPI>> {
	const scopes: Array<ReturnType<CheerioAPI>> = [];
	const firstH1 = root.find('h1').first().get(0);

	root.find('h1, h2, h3, h4, h5, h6').each((_, element) => {
		if (element === firstH1 || !matchesRecommendation($(element).text())) return;

		const $heading = $(element);
		const level = Number(element.tagName.slice(1));
		const nextSectionSelector = Array.from({ length: level }, (_, index) => `h${index + 1}`).join(
			', '
		);
		const $container = $heading.closest('[data-main-group], [data-group], section');
		const containerHasSinglePeerHeading =
			$container.length > 0 && $container.find(nextSectionSelector).length === 1;
		scopes.push(
			containerHasSinglePeerHeading ? $container : $heading.nextUntil(nextSectionSelector)
		);
	});

	return scopes;
}

function pageHasRecommendationIdentity(html: string, pageUrl: string): boolean {
	const $ = load(html);
	return (
		hasCandidatePath(new URL(pageUrl)) ||
		matchesRecommendation($('title').first().text()) ||
		matchesRecommendation($('h1').first().text())
	);
}

function mergeLinks(target: DiscoveredLink[], additions: DiscoveredLink[]) {
	const indexes = new Map(target.map((link, index) => [link.url, index]));

	for (const link of additions) {
		if (target.length >= MAX_RESULTS) break;
		const index = indexes.get(link.url);
		if (index === undefined) {
			indexes.set(link.url, target.length);
			target.push(link);
			continue;
		}

		const current = target[index];
		if (
			(current.title === normalizedHostname(new URL(current.url).hostname) ||
				AUXILIARY_LABEL_PATTERN.test(current.title)) &&
			!AUXILIARY_LABEL_PATTERN.test(link.title)
		) {
			target[index] = link;
		}
	}
}

function extractRecommendedLinks(
	html: string,
	pageUrl: string,
	targetUrl: string,
	isCandidatePage: boolean
): DiscoveredLink[] {
	const $ = load(html);
	const root = contentScope($);
	const result: DiscoveredLink[] = [];
	const scopes = recommendationScopes($, root);
	const firstH1 = root.find('h1').first().get(0);
	const hasFocusedBlogScope = root
		.find('h1, h2, h3, h4, h5, h6')
		.toArray()
		.some(
			(element) =>
				element !== firstH1 && FOCUSED_BLOG_COLLECTION_PATTERN.test(cleanText($(element).text()))
		);

	for (const scope of scopes) {
		mergeLinks(result, collectScopeLinks($, scope, pageUrl, targetUrl, true));
	}

	const hasIdentity = pageHasRecommendationIdentity(html, pageUrl);
	if ((isCandidatePage || hasIdentity) && !hasFocusedBlogScope) {
		mergeLinks(
			result,
			collectScopeLinks($, root, pageUrl, targetUrl, hasIdentity && scopes.length === 0)
		);
	}

	return result;
}

function findCandidatePages(html: string, pageUrl: string): CandidatePage[] {
	const $ = load(html);
	const page = new URL(pageUrl);
	const candidates = new Map<string, CandidatePage>();
	let order = 0;

	$('a[href]').each((_, element) => {
		const $anchor = $(element);
		const rawHref = $anchor.attr('href');
		if (!rawHref) return;
		const url = canonicalizeURL(rawHref, pageUrl);
		if (!url || !isSameSite(url.hostname, page.hostname) || url.href === page.href) return;

		const label = cleanText(
			`${$anchor.text()} ${$anchor.attr('title') || ''} ${$anchor.attr('aria-label') || ''}`
		);
		const pathIsCandidate = hasCandidatePath(url);
		const simpleLabel = SIMPLE_CANDIDATE_LABEL_PATTERN.test(cleanHeadingText(label));
		const strongLabel = matchesRecommendation(label);
		const inSiteChrome =
			$anchor.closest('header, nav, footer, aside, [role="navigation"]').length > 0;

		if (!pathIsCandidate && !simpleLabel && !(inSiteChrome && strongLabel)) return;
		const score =
			(NETWORK_RECOMMENDATION_PATTERN.test(`${label} ${url.pathname}`) ? 12 : 0) +
			(pathIsCandidate ? 6 : 0) +
			(simpleLabel ? 5 : 0) +
			(inSiteChrome ? 3 : 0) +
			(strongLabel ? 2 : 0);
		const existing = candidates.get(url.href);
		if (!existing || score > existing.score) {
			candidates.set(url.href, { url: url.href, score, order: order++ });
		}
	});

	return [...candidates.values()]
		.sort((left, right) => right.score - left.score || left.order - right.order)
		.slice(0, MAX_CANDIDATE_PAGES);
}

function combineSources(sources: DiscoveredLink[][]): DiscoveredLink[] {
	const nonEmptySources = sources.filter((source) => source.length > 0);
	if (nonEmptySources.length === 0) return [];

	const result: DiscoveredLink[] = [];
	const quota = Math.floor(MAX_RESULTS / nonEmptySources.length);
	for (const source of nonEmptySources) mergeLinks(result, source.slice(0, quota));
	for (const source of nonEmptySources) mergeLinks(result, source);
	return result;
}

function looksLikeMissingPage(html: string, pageUrl: string): boolean {
	const $ = load(html);
	const title = cleanText(`${$('title').first().text()} ${$('h1').first().text()}`);
	const pathname = new URL(pageUrl).pathname;
	return (
		/\b(?:404|not found|page not found)\b|页面不存在|頁面不存在|找不到页面|找不到頁面/i.test(
			title
		) || /^\/(?:404|error)\/?$/i.test(pathname)
	);
}

async function fetchWithRetry(url: string): Promise<Response> {
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
	return response;
}

async function fetchPage(url: string): Promise<FetchedPage> {
	const response = await fetchWithRetry(url);
	if (!response.ok) throw new Error(`Target returned HTTP ${response.status}`);
	const contentType = response.headers.get('content-type');
	if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
		throw new Error(`Target returned unsupported content type: ${contentType}`);
	}

	const html = await readResponseText(response, MAX_PAGE_CHARACTERS);
	return { url: response.url || url, html };
}

async function discoverFeeds(url: string): Promise<FeedDiscovery | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FEED_CHECK_TIMEOUT_MS);

	try {
		const homepageUrl = new URL('/', url).href;
		const response = await fetch(homepageUrl, {
			headers: {
				Accept:
					'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.1',
				'User-Agent': 'rss-finder/2.0'
			},
			redirect: 'follow',
			signal: controller.signal
		});
		if (!response.ok) return null;

		const body = await readResponseText(response, MAX_FEED_PAGE_CHARACTERS);
		const pageUrl = response.url || homepageUrl;
		const page = { url: pageUrl, html: body };
		const advertisedFeeds = deduplicateFeeds(
			parseHTMLContent(body, pageUrl).filter((feed) => Boolean(feed.link))
		);
		if (advertisedFeeds.length > 0) return { page, feeds: advertisedFeeds };

		const directFeed = parseRSSContent(body);
		if (isEmptyFeed(directFeed)) return null;
		return { page, feeds: [{ title: directFeed.title, link: pageUrl }] };
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function createLimiter(concurrency: number) {
	let active = 0;
	const queue: Array<() => void> = [];

	function startNext() {
		if (active >= concurrency) return;
		queue.shift()?.();
	}

	return function run<T>(operation: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			queue.push(async () => {
				active += 1;
				try {
					resolve(await operation());
				} catch (error) {
					reject(error);
				} finally {
					active -= 1;
					startNext();
				}
			});
			startNext();
		});
	};
}

interface DiscoveryStats {
	scannedCandidates: number;
	feedCandidates: number;
	evaluatedCandidates: number;
}

async function discoverQualifiedLinks(
	links: DiscoveredLink[]
): Promise<{ links: DiscoveredLinkWithFeeds[]; stats: DiscoveryStats }> {
	const candidates = links.slice(0, MAX_FEED_CHECKS);
	const results = new Array<DiscoveredLinkWithFeeds | null>(candidates.length).fill(null);
	const stats: DiscoveryStats = {
		scannedCandidates: candidates.length,
		feedCandidates: 0,
		evaluatedCandidates: 0
	};
	const evaluate = createLimiter(EVALUATION_CONCURRENCY);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < candidates.length) {
			const index = nextIndex++;
			const candidate = candidates[index];
			const discovery = await discoverFeeds(candidate.url);
			if (!discovery) continue;
			stats.feedCandidates += 1;

			try {
				stats.evaluatedCandidates += 1;
				const evaluation = await evaluate(() =>
					evaluateSitePage(discovery.page.html, discovery.page.url)
				);
				if (evaluation.recommended) {
					results[index] = {
						...candidate,
						...extractSiteMetadata(discovery.page.html, discovery.page.url),
						feeds: discovery.feeds
					};
				}
			} catch {
				// A failed evaluation excludes this candidate without failing the whole request.
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(FEED_CHECK_CONCURRENCY, candidates.length) }, () => worker())
	);
	return {
		links: results.filter((result): result is DiscoveredLinkWithFeeds => result !== null),
		stats
	};
}

export async function findLinks(targetUrl: string): Promise<LinkDiscoveryResult> {
	const startedAt = Date.now();
	const homePage = await fetchPage(targetUrl);
	const sources: DiscoveredLink[][] = [
		extractRecommendedLinks(homePage.html, homePage.url, targetUrl, false)
	];

	const candidatePages = findCandidatePages(homePage.html, homePage.url);
	const fetchedCandidates = await Promise.allSettled(
		candidatePages.map(async (candidate) => ({ candidate, page: await fetchPage(candidate.url) }))
	);

	for (const fetched of fetchedCandidates) {
		if (fetched.status !== 'fulfilled') continue;
		const { page } = fetched.value;
		if (!isSameSite(new URL(page.url).hostname, new URL(targetUrl).hostname)) continue;
		if (page.url !== homePage.url && page.html === homePage.html) continue;
		if (looksLikeMissingPage(page.html, page.url)) continue;
		sources.push(extractRecommendedLinks(page.html, page.url, targetUrl, true));
	}

	const candidates = combineSources(sources);
	const discovered = await discoverQualifiedLinks(candidates);
	console.info('find-links completed', {
		sourcePages: sources.length,
		candidateCount: candidates.length,
		...discovered.stats,
		resultCount: discovered.links.length,
		durationMs: Date.now() - startedAt
	});
	return { links: discovered.links };
}
