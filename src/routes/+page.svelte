<script lang="ts">
	import { onMount } from 'svelte';
	import { normalizeUrl } from '$lib/utils.js';

	type Feed = {
		title?: string;
		name?: string;
		url?: string;
		href?: string;
		link?: string;
	};

	type DiscoveredLink = {
		title: string;
		url: string;
		favicon: string | null;
		description: string | null;
		feeds: Feed[];
	};

	type SearchMode = 'feeds' | 'links';

	let urlInput = $state('');
	let isLoading = $state(false);
	let feeds = $state<Feed[]>([]);
	let links = $state<DiscoveredLink[]>([]);
	let searchMode = $state<SearchMode>('feeds');
	let error = $state('');
	let successMessage = $state(false);
	let hasSearched = $state(false);

	function clearResults() {
		feeds = [];
		links = [];
		error = '';
		hasSearched = false;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();

		const url = urlInput.trim();
		if (!url) return;

		await performSearch(url, 'feeds');
	}

	async function handleLinkSearch() {
		const url = urlInput.trim();
		if (!url) return;

		await performSearch(url, 'links');
	}

	async function performSearch(url: string, mode: SearchMode) {
		let normalizedUrl: string;
		try {
			normalizedUrl = normalizeUrl(url);
		} catch (err) {
			error = (err as Error).message;
			feeds = [];
			links = [];
			searchMode = mode;
			hasSearched = true;
			return;
		}

		isLoading = true;
		error = '';
		feeds = [];
		links = [];
		searchMode = mode;
		hasSearched = true;

		try {
			const response = await fetch(mode === 'feeds' ? '/api/find-feeds' : '/api/find-links', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ url: normalizedUrl })
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || `Failed to find ${mode}`);
			}

			if (mode === 'feeds') {
				feeds = data.feeds || [];
			} else {
				links = data.links || [];
			}
		} catch (err) {
			error = (err as Error).message;
		} finally {
			isLoading = false;
		}
	}

	function handleInputChange() {
		// Clear previous results when input changes
		feeds = [];
		links = [];
		error = '';
		hasSearched = false;
	}

	function openInNewTab(url: string) {
		window.open(url, '_blank');
	}

	function hideBrokenImage(event: Event) {
		(event.currentTarget as HTMLImageElement).style.display = 'none';
	}

	async function copyToClipboard(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			showSuccessMessage();
		} catch (err) {
			console.error('Failed to copy: ', err);
		}
	}

	function showSuccessMessage() {
		successMessage = true;
		setTimeout(() => {
			successMessage = false;
		}, 2000);
	}

	onMount(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			// Allow Escape key to clear results
			if (e.key === 'Escape') {
				clearResults();
				const input = document.getElementById('urlInput') as HTMLInputElement;
				if (input) input.focus();
			}

			// Allow Ctrl/Cmd + K to focus search
			if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
				e.preventDefault();
				const input = document.getElementById('urlInput') as HTMLInputElement;
				if (input) {
					input.focus();
					input.select();
				}
			}
		}

		document.addEventListener('keydown', handleGlobalKeyDown);

		return () => {
			document.removeEventListener('keydown', handleGlobalKeyDown);
		};
	});
</script>

<main class="mx-auto flex min-h-screen max-w-4xl flex-col px-4 sm:px-6 lg:px-8">
	<section
		class="flex min-h-screen flex-1 flex-col items-center justify-start pt-24 sm:pt-32 lg:pt-40"
	>
		<header class="mb-6 text-center sm:mb-8">
			<h1 class="gradient-text mb-2 text-3xl font-medium sm:mb-3 sm:text-4xl">RSS Finder</h1>
			<p class="text-sm text-muted-foreground sm:text-base">Discover RSS feeds from any website</p>
		</header>

		<form
			class="mb-8 w-full max-w-xl sm:mb-12"
			id="searchForm"
			role="search"
			aria-label="RSS feed search"
			onsubmit={handleSubmit}
		>
			<div
				class="flex flex-col gap-2 rounded-lg border border-border bg-white p-1 sm:flex-row sm:items-stretch sm:gap-3"
			>
				<label for="urlInput" class="sr-only">Website URL</label>
				<input
					id="urlInput"
					name="url"
					placeholder="Enter a website URL..."
					aria-describedby="url-help"
					required
					autocomplete="url"
					class="flex-1 rounded-md border-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground sm:px-4 sm:py-3 sm:text-base"
					bind:value={urlInput}
					oninput={handleInputChange}
				/>
				<div class="flex gap-2">
					<button
						type="submit"
						id="searchBtn"
						aria-describedby="search-help"
						disabled={!urlInput.trim() || isLoading}
						class="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50 sm:flex-none sm:px-5 sm:py-3 sm:text-base"
					>
						<span class="button-text"
							>{isLoading && searchMode === 'feeds' ? 'Finding...' : 'Find RSS'}</span
						>
					</button>
					<button
						type="button"
						onclick={handleLinkSearch}
						disabled={!urlInput.trim() || isLoading}
						class="flex-1 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50 sm:flex-none sm:px-5 sm:py-3 sm:text-base"
					>
						{isLoading && searchMode === 'links' ? 'Discovering...' : 'Discover Links'}
					</button>
				</div>
			</div>
			<small
				id="url-help"
				class="mt-2 block text-center text-xs text-muted-foreground sm:mt-3 sm:text-sm"
			>
				Find RSS feeds or discover curated, RSS-enabled websites recommended by a site
			</small>
		</form>

		<section class="w-full max-w-2xl" id="results" aria-live="polite" aria-label="Search results">
			{#if isLoading}
				<div class="flex flex-col gap-4" role="status" aria-live="polite">
					<div class="flex items-center rounded-2xl border border-border bg-white p-7">
						<div
							class="mr-4 h-5 flex-1 animate-pulse rounded bg-gradient-to-r from-border via-muted to-border bg-[length:200%_100%]"
						></div>
						<div class="flex gap-2">
							<div
								class="h-8 w-16 animate-pulse rounded-lg bg-gradient-to-r from-border via-muted to-border bg-[length:200%_100%]"
							></div>
							<div
								class="h-8 w-16 animate-pulse rounded-lg bg-gradient-to-r from-border via-muted to-border bg-[length:200%_100%]"
							></div>
						</div>
					</div>
					<div class="flex items-center rounded-2xl border border-border bg-white p-7">
						<div
							class="mr-4 h-5 flex-1 animate-pulse rounded bg-gradient-to-r from-border via-muted to-border bg-[length:200%_100%]"
						></div>
						<div class="flex gap-2">
							<div
								class="h-8 w-16 animate-pulse rounded-lg bg-gradient-to-r from-border via-muted to-border bg-[length:200%_100%]"
							></div>
							<div
								class="h-8 w-16 animate-pulse rounded-lg bg-gradient-to-r from-border via-muted to-border bg-[length:200%_100%]"
							></div>
						</div>
					</div>
				</div>
			{:else if error}
				<div
					class="rounded-lg border border-destructive bg-destructive/5 px-3 py-2.5 text-center text-xs text-destructive sm:px-4 sm:py-3 sm:text-sm"
					role="alert"
				>
					Error: {error}
				</div>
			{:else if searchMode === 'feeds' && feeds.length === 0 && hasSearched && urlInput.trim()}
				<div
					class="rounded-lg border border-destructive bg-destructive/5 px-3 py-2.5 text-center text-xs text-destructive sm:px-4 sm:py-3 sm:text-sm"
					role="alert"
				>
					No RSS feeds found for this URL.
				</div>
			{:else if searchMode === 'links' && links.length === 0 && hasSearched && urlInput.trim()}
				<div
					class="rounded-lg border border-destructive bg-destructive/5 px-3 py-2.5 text-center text-xs text-destructive sm:px-4 sm:py-3 sm:text-sm"
					role="alert"
				>
					No recommended RSS-enabled websites found for this URL.
				</div>
			{:else if feeds.length > 0}
				<div class="flex flex-col gap-4" role="list" aria-label="Found RSS feeds">
					<h2 class="mb-3 text-center text-base font-medium sm:mb-4 sm:text-lg">
						Found {feeds.length} RSS feed{feeds.length !== 1 ? 's' : ''}
					</h2>
					{#each feeds as feed, index (index)}
						{@const feedObj = feed as {
							title?: string;
							name?: string;
							url?: string;
							href?: string;
							link?: string;
						}}
						{@const title = feedObj.title || feedObj.name || 'Untitled Feed'}
						{@const url =
							feedObj.url || feedObj.href || feedObj.link || (typeof feed === 'string' ? feed : '')}
						<article
							class="flex flex-col gap-3 rounded-lg border border-border bg-white p-3 hover:border-primary sm:flex-row sm:items-center sm:gap-0 sm:p-4"
						>
							<div class="flex-1 sm:mr-3">
								<h3 class="mb-1 text-sm font-medium sm:text-base">{title}</h3>
								<div class="text-xs break-all text-muted-foreground sm:text-sm">{url}</div>
							</div>
							<div class="flex gap-2 self-start sm:self-center">
								<button
									class="min-h-[44px] rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover sm:min-h-0 sm:px-3 sm:py-1.5"
									onclick={() => openInNewTab(url)}
									aria-label="Open {title} in new tab"
								>
									Open
								</button>
								<button
									class="min-h-[44px] rounded border border-border px-4 py-2 text-sm font-medium hover:bg-muted sm:min-h-0 sm:px-3 sm:py-1.5"
									onclick={() => copyToClipboard(url)}
									aria-label="Copy {title} URL"
								>
									Copy
								</button>
							</div>
						</article>
					{/each}
				</div>
			{:else if links.length > 0}
				<div class="flex flex-col gap-4" role="list" aria-label="Discovered websites">
					<h2 class="mb-3 text-center text-base font-medium sm:mb-4 sm:text-lg">
						Discovered {links.length} recommended website{links.length !== 1 ? 's' : ''}
					</h2>
					{#each links as site (site.url)}
						<article
							class="rounded-lg border border-border bg-white p-4 hover:border-primary"
							role="listitem"
						>
							<div class="flex gap-3">
								<div
									class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-sm font-medium text-muted-foreground"
								>
									{#if site.favicon}
										<img
											src={site.favicon}
											alt=""
											class="h-full w-full object-cover"
											onerror={hideBrokenImage}
										/>
									{:else}
										{site.title.slice(0, 1).toUpperCase()}
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
										<div class="min-w-0">
											<h3 class="text-sm font-medium sm:text-base">{site.title}</h3>
											<a
												href={site.url}
												target="_blank"
												rel="noopener noreferrer"
												class="mt-1 block text-xs break-all text-muted-foreground hover:text-primary sm:text-sm"
											>
												{site.url}
											</a>
										</div>
										<div class="flex gap-2 self-start">
											<button
												class="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
												onclick={() => openInNewTab(site.url)}
											>
												Open
											</button>
											<button
												class="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
												onclick={() => copyToClipboard(site.url)}
											>
												Copy
											</button>
										</div>
									</div>
									{#if site.description}
										<p class="mt-2 text-sm leading-6 text-muted-foreground">{site.description}</p>
									{/if}
								</div>
							</div>
							<div class="mt-4 border-t border-border pt-3">
								<h4 class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
									RSS feeds
								</h4>
								<div class="flex flex-col gap-2">
									{#each site.feeds as feed, index (feed.link || index)}
										{@const feedTitle = feed.title || 'RSS Feed'}
										{@const feedUrl = feed.link || feed.url || feed.href || ''}
										<div
											class="flex flex-col gap-2 rounded bg-muted px-3 py-2 sm:flex-row sm:items-center"
										>
											<div class="min-w-0 flex-1">
												<div class="text-xs font-medium sm:text-sm">{feedTitle}</div>
												<div class="text-xs break-all text-muted-foreground">{feedUrl}</div>
											</div>
											<div class="flex gap-2 self-start sm:self-center">
												<button
													class="rounded border border-border px-2.5 py-1 text-xs font-medium hover:bg-white"
													onclick={() => openInNewTab(feedUrl)}
												>
													Open
												</button>
												<button
													class="rounded border border-border px-2.5 py-1 text-xs font-medium hover:bg-white"
													onclick={() => copyToClipboard(feedUrl)}
												>
													Copy
												</button>
											</div>
										</div>
									{/each}
								</div>
							</div>
						</article>
					{/each}
				</div>
			{/if}
		</section>
	</section>

	<footer class="py-8 text-center">
		<a
			href="https://github.com/0x2E/rss-finder"
			target="_blank"
			rel="noopener noreferrer"
			class="text-sm text-muted-foreground hover:text-primary"
		>
			GitHub Project
		</a>
	</footer>

	<div
		class="success-message fixed top-4 right-4 z-50 rounded bg-black px-3 py-2 text-xs text-white sm:text-sm"
		class:show={successMessage}
	>
		Copied to clipboard!
	</div>
</main>
