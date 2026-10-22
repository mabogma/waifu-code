/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
exports.activate = api => {
	api.commands.register('waifu.photo-gallery.open', async () => {
		const panel = await api.panels.create({ title: 'Waifu Photo Gallery', html: fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8'), style: fs.readFileSync(path.join(__dirname, 'panel.css'), 'utf8'), script: fs.readFileSync(path.join(__dirname, 'panel.js'), 'utf8') });
		let images = [];
		let busy = false;
		let task;
		const subscription = api.panels.onMessage(panel, async message => {
			if (!message || typeof message.action !== 'string' || busy) { return; }
			busy = true;
			try {
				task = await api.tasks.start('Фотогалерея', async ({ signal, report }) => {
					try {
						if (message.action === 'open') {
							const selected = await api.files.pickImages();
							signal.throwIfAborted();
							for (const file of selected.slice(0, Math.max(0, 200 - images.length))) {
								signal.throwIfAborted();
								try {
									const uri = await api.panels.image(panel, file.handle);
									signal.throwIfAborted();
									const index = images.length; images.push(file);
									await api.panels.postMessage(panel, { type: 'image', index, name: file.name, uri });
									await report(file.name, 100 / Math.max(1, selected.length));
								} catch (error) { if (signal.aborted) { throw error; } await api.panels.postMessage(panel, { type: 'error', text: error.message }); }
							}
						} else if (message.action === 'save' && Number.isSafeInteger(message.index) && images[message.index]) {
							const file = images[message.index];
							const destination = await api.files.saveDialog(file.name);
							signal.throwIfAborted();
							if (destination) { const bytes = await api.files.read(file.handle); signal.throwIfAborted(); await api.files.write(destination.handle, bytes); }
						} else if (message.action === 'size' && [120, 180, 240].includes(message.value)) {
							await api.settings.set('thumbnailSize', message.value);
						} else if (message.action === 'ready') {
							await api.panels.postMessage(panel, { type: 'settings', size: await api.settings.get('thumbnailSize', 180) });
						}
					} finally { busy = false; }
				});
			} catch (error) { busy = false; api.log(error.message); }
		});
		api.panels.onDispose(panel, () => { subscription.dispose(); if (task) { api.tasks.cancel(task); } images = []; });
	});
};
