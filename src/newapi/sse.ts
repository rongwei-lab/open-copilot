import { isRecord, stringAt } from './guards';
import type { SseEvent } from './types';

/**
 * Incremental Server-Sent Events decoder.
 *
 * SSE frames end at a blank line. Network chunks are not frame boundaries, so
 * this class keeps both an incomplete line and the current event fields until
 * a complete delimiter arrives. It supports LF, CRLF, comments, multi-line
 * data fields, and an EOF flush for gateways that omit the final blank line.
 */
export class SseDecoder {
	private textBuffer = '';
	private dataLines: string[] = [];
	private eventName: string | undefined;
	private eventId: string | undefined;
	private lastEventId: string | undefined;
	private retry: number | undefined;
	private readonly textDecoder = new TextDecoder();

	push(chunk: string | Uint8Array): SseEvent[] {
		const text =
			typeof chunk === 'string' ? chunk : this.textDecoder.decode(chunk, { stream: true });
		if (text.length === 0) {
			return [];
		}
		this.textBuffer += text;
		return this.drainCompleteLines();
	}

	/** Flush decoder/partial line and dispatch a final event at EOF. */
	finish(): SseEvent[] {
		const tail = this.textDecoder.decode();
		if (tail) {
			this.textBuffer += tail;
		}
		const events = this.drainCompleteLines(true);
		const final = this.dispatchEvent();
		if (final) {
			events.push(final);
		}
		return events;
	}

	private drainCompleteLines(flushPartial = false): SseEvent[] {
		const events: SseEvent[] = [];
		let start = 0;
		while (start < this.textBuffer.length) {
			let newlineIndex = -1;
			let newlineLength = 1;
			for (let index = start; index < this.textBuffer.length; index += 1) {
				const code = this.textBuffer.charCodeAt(index);
				if (code === 10 /* LF */) {
					newlineIndex = index;
					newlineLength = 1;
					break;
				}
				if (code === 13 /* CR */) {
					// A CR at the end of a network chunk may be the first half of CRLF.
					if (index + 1 >= this.textBuffer.length && !flushPartial) {
						break;
					}
					newlineIndex = index;
					newlineLength = this.textBuffer.charCodeAt(index + 1) === 10 ? 2 : 1;
					break;
				}
			}
			if (newlineIndex < 0) {
				break;
			}

			const line = this.textBuffer.slice(start, newlineIndex);
			start = newlineIndex + newlineLength;
			const event = this.processLine(line);
			if (event) {
				events.push(event);
			}
		}

		if (start > 0) {
			this.textBuffer = this.textBuffer.slice(start);
		}
		if (flushPartial && this.textBuffer.length > 0) {
			const event = this.processLine(this.textBuffer);
			this.textBuffer = '';
			if (event) {
				events.push(event);
			}
		}
		return events;
	}

	private processLine(line: string): SseEvent | undefined {
		if (line.length === 0) {
			return this.dispatchEvent();
		}
		if (line.startsWith(':')) {
			return undefined;
		}

		const separator = line.indexOf(':');
		const field = separator < 0 ? line : line.slice(0, separator);
		let value = separator < 0 ? '' : line.slice(separator + 1);
		if (value.startsWith(' ')) {
			value = value.slice(1);
		}

		switch (field) {
			case 'data':
				this.dataLines.push(value);
				break;
			case 'event':
				this.eventName = value;
				break;
			case 'id':
				// SSE ignores ids containing a NUL character.
				if (!value.includes('\u0000')) {
					this.eventId = value;
				}
				break;
			case 'retry': {
				const parsed = Number(value);
				if (/^\d+$/u.test(value) && Number.isSafeInteger(parsed)) {
					this.retry = parsed;
				}
				break;
			}
			default:
				// Unknown SSE fields are explicitly ignored by the SSE spec.
				break;
		}
		return undefined;
	}

	private dispatchEvent(): SseEvent | undefined {
		if (this.dataLines.length === 0) {
			// An event/id field without data is discarded by the SSE algorithm.
			this.eventName = undefined;
			this.eventId = undefined;
			this.retry = undefined;
			return undefined;
		}

		const data = this.dataLines.join('\n');
		const event = this.eventName;
		if (this.eventId !== undefined) {
			this.lastEventId = this.eventId;
		}
		const id = this.lastEventId;
		const retry = this.retry;
		this.dataLines = [];
		this.eventName = undefined;
		this.eventId = undefined;
		this.retry = undefined;

		const done = data.trim() === '[DONE]';
		let json: unknown;
		let jsonParseError: Error | undefined;
		if (!done && data.trim().length > 0) {
			try {
				json = JSON.parse(data);
			} catch (error) {
				jsonParseError = error instanceof Error ? error : new Error(String(error));
			}
		}
		const type = stringAt(json, 'type') ?? event;
		return {
			event,
			id,
			retry,
			data,
			json,
			jsonParseError,
			type,
			done,
		};
	}
}

/** Decode a response body into complete SSE events. */
export async function* decodeSseStream(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<SseEvent, void, undefined> {
	const reader = body.getReader();
	const decoder = new SseDecoder();
	let abortListener: (() => void) | undefined;
	try {
		if (signal) {
			abortListener = () => {
				void reader.cancel(signal.reason);
			};
			if (signal.aborted) {
				abortListener();
			} else {
				signal.addEventListener('abort', abortListener, { once: true });
			}
		}
		while (true) {
			if (signal?.aborted) {
				throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
			}
			const { done, value } = await reader.read();
			if (done) {
				for (const event of decoder.finish()) {
					yield event;
				}
				return;
			}
			for (const event of decoder.push(value)) {
				yield event;
			}
		}
	} finally {
		if (signal && abortListener) {
			signal.removeEventListener('abort', abortListener);
		}
		reader.releaseLock();
	}
}

export function isSseErrorPayload(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) {
		return false;
	}
	return 'error' in value && value.error !== undefined && value.error !== null;
}
