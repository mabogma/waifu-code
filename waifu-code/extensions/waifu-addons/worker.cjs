/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { createWorkerApi } = require('./worker-api.cjs');
const handlers = new Map();
const apiRequests = new Map();
let apiSequence = 0;
function requestEditor(action, value, timeout = 5000) {
	return new Promise((resolve, reject) => {
		const id = ++apiSequence;
		const timer = setTimeout(() => { apiRequests.delete(id); reject(new Error('Editor API request timed out.')); }, timeout);
		apiRequests.set(id, { resolve, reject, timer });
		parentPort.postMessage({ type: 'api-request', id, action, value });
	});
}
const services = createWorkerApi(requestEditor, message => parentPort.postMessage(message));
let addon;
let stopping = false;
const ready = Promise.resolve().then(async () => {
	addon = require(workerData.main);
	if (typeof addon.activate !== 'function') { throw new Error('Addon must export activate(api).'); }
	await addon.activate(Object.freeze({
		...services.api,
		editor: Object.freeze({
			getSelectedText() { return requestEditor('editor.getSelectedText'); },
			replaceSelection(text) {
				if (typeof text !== 'string' || text.length > 1000000) { throw new Error('Replacement must be a string of at most 1,000,000 characters.'); }
				return requestEditor('editor.replaceSelection', text);
			}
		}),
		commands: Object.freeze({ register(id, handler) { if (typeof handler !== 'function') { throw new Error('Command handler must be a function.'); } handlers.set(id, handler); } }),
		window: Object.freeze({ showInformationMessage(message) { parentPort.postMessage({ type: 'information', text: String(message).slice(0, 2000) }); } }),
		log(message) { parentPort.postMessage({ type: 'log', text: String(message).slice(0, 10000) }); }
	}));
});
// Keep activation failures attached to the command request, without unhandled rejections.
ready.catch(() => {});
parentPort.on('message', async message => {
	if (message.type === 'shutdown') {
		stopping = true;
		try { await ready.catch(() => {}); await services.dispose(addon); } finally { process.exit(0); }
		return;
	}
	if (['panel-message', 'panel-disposed', 'task-cancel'].includes(message.type)) { services.event(message); return; }
	if (message.type === 'api-result') {
		const pending = apiRequests.get(message.id);
		if (pending) { clearTimeout(pending.timer); apiRequests.delete(message.id); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value); }
		return;
	}
	const { command, request } = message;
	try {
		if (stopping) { throw new Error('Addon is stopping.'); }
		await ready;
		if (!handlers.has(command)) { throw new Error('Addon did not register this command.'); }
		await handlers.get(command)();
		parentPort.postMessage({ type: 'result', request });
	} catch (error) { parentPort.postMessage({ type: 'result', request, error: String(error.message || error) }); }
});
