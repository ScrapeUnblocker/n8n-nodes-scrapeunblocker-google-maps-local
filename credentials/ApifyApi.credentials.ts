import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// Name, property and auth scheme match the official Apify n8n credential, so an
// "Apify API" credential a user already has in n8n works with this node as-is.
export class ApifyApi implements ICredentialType {
	name = 'apifyApi';

	displayName = 'Apify API';

	icon: Icon = { light: 'file:apify.svg', dark: 'file:apify.dark.svg' };

	documentationUrl =
		'https://github.com/ScrapeUnblocker/n8n-nodes-scrapeunblocker-google-maps-local#credentials';

	properties: INodeProperties[] = [
		{
			displayName:
				'Runs are billed to this Apify account at the Actor\'s pay-per-result price. Get your token in Apify Console under <a href="https://console.apify.com/settings/integrations" target="_blank">Settings → API &amp; Integrations</a>. No Apify account yet? <a href="https://console.apify.com/sign-up" target="_blank">Sign up for free</a>.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Your Apify API token (starts with "apify_api_")',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.apify.com',
			url: '/v2/users/me',
		},
	};
}
