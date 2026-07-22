import { json } from '@sveltejs/kit';
import { findLinks } from '$lib/server/find-links.js';
import { normalizeUrl } from '$lib/utils.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const url = typeof body === 'object' && body !== null && 'url' in body ? body.url : null;
	if (typeof url !== 'string' || !url.trim()) {
		return json({ error: 'URL is required' }, { status: 400 });
	}

	let normalizedUrl: string;
	try {
		normalizedUrl = normalizeUrl(url);
		const protocol = new URL(normalizedUrl).protocol;
		if (protocol !== 'http:' && protocol !== 'https:')
			throw new Error('Only HTTP(S) URLs are supported');
	} catch (error) {
		return json({ error: `Invalid URL: ${(error as Error).message}` }, { status: 400 });
	}

	try {
		return json(await findLinks(normalizedUrl));
	} catch (error) {
		console.error(`Error finding links for ${normalizedUrl}:`, error);
		return json({ error: 'Failed to find links from target website' }, { status: 502 });
	}
};
