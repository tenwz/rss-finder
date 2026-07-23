import { describe, expect, it } from 'vitest';
import { readResponseText } from './read-response.js';

describe('readResponseText', () => {
	it('cancels a response body that stops yielding data', async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			}
		});

		await expect(readResponseText(new Response(body), 1_000, 10)).rejects.toThrow(
			'Response body read timed out'
		);
		expect(cancelled).toBe(true);
	});
});
