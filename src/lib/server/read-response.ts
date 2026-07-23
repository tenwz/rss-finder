export async function readResponseText(response: Response, maxCharacters: number): Promise<string> {
	if (!response.body) return (await response.text()).slice(0, maxCharacters);

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = '';

	try {
		while (text.length < maxCharacters) {
			const { done, value } = await reader.read();
			if (done) {
				text += decoder.decode();
				break;
			}
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		if (text.length >= maxCharacters) await reader.cancel();
	}

	return text.slice(0, maxCharacters);
}
