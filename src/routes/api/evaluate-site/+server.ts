import { json } from '@sveltejs/kit';
import { evaluateSite } from '$lib/server/evaluate-site.js';
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
		if (protocol !== 'http:' && protocol !== 'https:') {
			throw new Error('Only HTTP(S) URLs are supported');
		}
	} catch (error) {
		return json({ error: `Invalid URL: ${(error as Error).message}` }, { status: 400 });
	}

	try {
		return json(await evaluateSite(normalizedUrl));
	} catch (error) {
		console.error(`Error evaluating site ${normalizedUrl}:`, error);
		return json({ error: 'Failed to evaluate target website' }, { status: 502 });
	}
};
