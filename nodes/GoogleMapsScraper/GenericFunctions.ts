import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const APIFY_API_URL = 'https://api.apify.com';

// Apify caps `waitForFinish` at 60 s, so every status call is a long-poll of up to a minute.
const WAIT_FOR_FINISH_SECS = 60;
const LONG_POLL_TIMEOUT_MS = (WAIT_FOR_FINISH_SECS + 30) * 1000;
const MIN_POLL_INTERVAL_MS = 2000;
const DATASET_PAGE_SIZE = 1000;
const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'];

export interface ApifyRequest {
	method: IHttpRequestMethods;
	endpoint: string;
	integrationAppId: string;
	body?: IDataObject;
	qs?: IDataObject;
	timeout?: number;
	abortSignal?: AbortSignal;
}

export interface ActorRunOptions {
	actorId: string;
	integrationAppId: string;
	input: IDataObject;
	itemIndex: number;
	timeoutSecs?: number;
}

export interface ActorRunResult {
	run: IDataObject;
	items: IDataObject[];
}

/**
 * Sends an authenticated request to the Apify API with the `apifyApi` credential.
 */
export async function apifyApiRequest(
	this: IExecuteFunctions,
	request: ApifyRequest,
): Promise<IDataObject | IDataObject[]> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${APIFY_API_URL}${request.endpoint}`,
		headers: {
			// Lets Apify attribute runs to this n8n integration.
			'x-apify-integration-platform': 'n8n',
			'x-apify-integration-app-id': request.integrationAppId,
		},
		qs: request.qs,
		json: true,
		timeout: request.timeout,
		abortSignal: request.abortSignal,
	};
	if (request.body !== undefined) {
		options.body = request.body;
	}

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'apifyApi', options)) as
			| IDataObject
			| IDataObject[];
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * Accepts a list typed as text (split on `separator`) or an array from an expression,
 * and returns its trimmed, non-empty entries.
 */
export function parseList(value: unknown, separator: RegExp = /[\n,]+/): string[] {
	const parts = Array.isArray(value) ? value.map(String) : String(value ?? '').split(separator);
	return parts.map((part) => part.trim()).filter((part) => part !== '');
}

export type OptionKind = 'value' | 'list' | 'newlineList' | 'upper' | 'nonZero';

export interface OptionField {
	key: string;
	kind?: OptionKind;
}

const NEWLINE_SEPARATOR = /\n+/;

/**
 * Reads a required text parameter and fails the item with a clear message when it is empty.
 */
export function requireString(
	this: IExecuteFunctions,
	parameterName: string,
	displayName: string,
	itemIndex: number,
): string {
	const value = String(this.getNodeParameter(parameterName, itemIndex) ?? '').trim();
	if (value === '') {
		throw new NodeOperationError(this.getNode(), `Enter a value for "${displayName}"`, {
			itemIndex,
		});
	}
	return value;
}

/**
 * Reads a required list parameter (text or array) and fails the item when it has no entries.
 */
export function requireList(
	this: IExecuteFunctions,
	parameterName: string,
	displayName: string,
	itemIndex: number,
	newlineOnly = false,
): string[] {
	const list = parseList(
		this.getNodeParameter(parameterName, itemIndex),
		newlineOnly ? NEWLINE_SEPARATOR : undefined,
	);
	if (list.length === 0) {
		throw new NodeOperationError(this.getNode(), `Enter at least one value for "${displayName}"`, {
			itemIndex,
		});
	}
	return list;
}

/**
 * Copies the options the user added to the Actor input under the Actor's own input keys.
 * Empty values are skipped, so the Actor falls back to its defaults for them.
 */
export function applyOptions(
	input: IDataObject,
	options: IDataObject,
	fields: Record<string, OptionField>,
): void {
	for (const [name, value] of Object.entries(options)) {
		const field = fields[name];
		if (!field || value === undefined || value === null || value === '') {
			continue;
		}
		switch (field.kind) {
			case 'list':
			case 'newlineList': {
				const list = parseList(value, field.kind === 'newlineList' ? NEWLINE_SEPARATOR : undefined);
				if (list.length > 0) {
					input[field.key] = list;
				}
				break;
			}
			case 'upper':
				input[field.key] = String(value).trim().toUpperCase();
				break;
			case 'nonZero':
				// 0 means "no limit" in the node, so the Actor gets no value at all.
				if (Number(value) !== 0) {
					input[field.key] = value;
				}
				break;
			default:
				input[field.key] = typeof value === 'string' ? value.trim() : value;
		}
	}
}

async function getDatasetItems(
	this: IExecuteFunctions,
	datasetId: string,
	integrationAppId: string,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	for (let offset = 0; ; offset += DATASET_PAGE_SIZE) {
		const page = (await apifyApiRequest.call(this, {
			method: 'GET',
			endpoint: `/v2/datasets/${datasetId}/items`,
			integrationAppId,
			qs: { clean: true, format: 'json', offset, limit: DATASET_PAGE_SIZE },
		})) as IDataObject[];
		items.push(...page);
		if (page.length < DATASET_PAGE_SIZE) {
			return items;
		}
	}
}

// A run that stops early may already have saved (and charged for) some results; point the
// user at them instead of silently dropping them.
async function describeSavedResults(
	this: IExecuteFunctions,
	datasetId: string,
	integrationAppId: string,
): Promise<string> {
	try {
		const dataset = (await apifyApiRequest.call(this, {
			method: 'GET',
			endpoint: `/v2/datasets/${datasetId}`,
			integrationAppId,
		})) as IDataObject;
		const itemCount = Number((dataset.data as IDataObject | undefined)?.itemCount ?? 0);
		if (itemCount > 0) {
			return ` ${itemCount} result(s) saved before the run stopped are in its dataset: https://console.apify.com/storage/datasets/${datasetId}`;
		}
	} catch {
		// Optional detail for the error message only.
	}
	return '';
}

/**
 * Starts an Actor run, waits until it reaches a terminal status and returns the run
 * together with every item of its default dataset.
 *
 * Cancelling the n8n execution only stops the waiting: n8n aborts every authenticated
 * request of a cancelled execution, so the node cannot send the abort call to Apify.
 */
export async function runActorAndGetItems(
	this: IExecuteFunctions,
	options: ActorRunOptions,
): Promise<ActorRunResult> {
	const { actorId, integrationAppId, input, itemIndex, timeoutSecs } = options;
	const cancelSignal = this.getExecutionCancelSignal?.();

	const startQs: IDataObject = { waitForFinish: WAIT_FOR_FINISH_SECS };
	if (timeoutSecs) {
		startQs.timeout = timeoutSecs;
	}
	const started = (await apifyApiRequest.call(this, {
		method: 'POST',
		endpoint: `/v2/acts/${actorId}/runs`,
		integrationAppId,
		body: input,
		qs: startQs,
		timeout: LONG_POLL_TIMEOUT_MS,
		abortSignal: cancelSignal,
	})) as IDataObject;
	let run = started.data as IDataObject;
	const runUrl = `https://console.apify.com/view/runs/${String(run.id)}`;

	while (!TERMINAL_STATUSES.includes(run.status as string)) {
		if (cancelSignal?.aborted) {
			throw new NodeOperationError(this.getNode(), 'Execution cancelled', {
				itemIndex,
				description: `The Apify run keeps going. Abort it in Apify Console if you no longer need it: ${runUrl}`,
			});
		}
		const polledAt = Date.now();
		const polled = (await apifyApiRequest.call(this, {
			method: 'GET',
			endpoint: `/v2/actor-runs/${String(run.id)}`,
			integrationAppId,
			qs: { waitForFinish: WAIT_FOR_FINISH_SECS },
			timeout: LONG_POLL_TIMEOUT_MS,
			abortSignal: cancelSignal,
		})) as IDataObject;
		run = polled.data as IDataObject;
		const elapsed = Date.now() - polledAt;
		if (elapsed < MIN_POLL_INTERVAL_MS && !TERMINAL_STATUSES.includes(run.status as string)) {
			await sleep(MIN_POLL_INTERVAL_MS - elapsed);
		}
	}

	if (run.status !== 'SUCCEEDED') {
		const reason = run.statusMessage ? `: ${String(run.statusMessage)}` : '';
		const savedResults = await describeSavedResults.call(
			this,
			run.defaultDatasetId as string,
			integrationAppId,
		);
		throw new NodeOperationError(this.getNode(), `Actor run ${String(run.status)}${reason}`, {
			itemIndex,
			description: `See the run log in Apify Console: ${runUrl}.${savedResults}`,
		});
	}

	const items = await getDatasetItems.call(this, run.defaultDatasetId as string, integrationAppId);
	return { run, items };
}
