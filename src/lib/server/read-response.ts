function readChunkWithTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Response body read timed out')), timeoutMs);
		operation.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timeout);
				reject(error);
			}
		);
	});
}

export async function readResponseText(
	response: Response,
	maxCharacters: number,
	timeoutMs?: number
): Promise<string> {
	if (!response.body) return (await response.text()).slice(0, maxCharacters);

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = '';
	const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
	let finished = false;

	try {
		while (text.length < maxCharacters) {
			const remaining = deadline === null ? null : deadline - Date.now();
			if (remaining !== null && remaining <= 0) {
				throw new Error('Response body read timed out');
			}
			const { done, value } = await (remaining === null
				? reader.read()
				: readChunkWithTimeout(reader.read(), remaining));
			if (done) {
				text += decoder.decode();
				finished = true;
				break;
			}
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		if (!finished) await reader.cancel();
	}

	return text.slice(0, maxCharacters);
}
