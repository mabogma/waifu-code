/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs');
const marker = process.env.WAIFU_API_PROBE_FILE;
exports.activate = api => {
	api.lifecycle.onDispose(() => fs.appendFileSync(marker, 'cleanup;'));
	api.commands.register('waifu.api-probe.run', async () => {
		await api.settings.set('size', 180);
		if (await api.settings.get('size') !== 180) { throw new Error('Settings round trip failed'); }
		await api.secrets.set('probe', 'temporary-probe');
		if (await api.secrets.get('probe') !== 'temporary-probe') { throw new Error('Secrets round trip failed'); }
		await api.secrets.delete('probe');
		await api.panels.create({ title: 'Waifu API Probe', html: '<h1>API Probe</h1>' });
		await api.tasks.start('Probe background task', async ({ signal, report }) => {
			await report('Running', 10);
			await new Promise(resolve => { if (signal.aborted) { resolve(); } else { signal.addEventListener('abort', resolve, { once: true }); } });
			fs.appendFileSync(marker, 'aborted;');
		});
		fs.appendFileSync(marker, 'ready;');
	});
};
