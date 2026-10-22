/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
/** Worker-facing optional APIs. Background work is detached from the command deadline. */
function createWorkerApi(request, send) {
	const messageHandlers = new Map(), closeHandlers = new Map(), tasks = new Map(), cleanup = new Set();
	let sequence = 0, stopping = false;
	const emitError = error => send({ type: 'log', text: `Addon callback failed: ${String(error.message || error)}` });
	const invoke = (handler, value) => { Promise.resolve().then(() => handler(value)).catch(emitError); };
	function subscribe(map, id, handler) {
		if (typeof handler !== 'function') { throw new Error('Expected a callback.'); }
		let handlers = map.get(id);
		if (!handlers) { handlers = new Set(); map.set(id, handlers); }
		handlers.add(handler);
		return { dispose() { handlers.delete(handler); } };
	}
	const api = {
		panels: Object.freeze({
			create(options) { return request('panels.create', options, 120000); },
			postMessage(id, message) { return request('panels.postMessage', { id, message }); },
			dispose(id) { return request('panels.dispose', { id }); },
			image(id, handle, path = '') { return request('panels.image', { id, handle, path }); },
			onMessage(id, handler) { return subscribe(messageHandlers, id, handler); },
			onDispose(id, handler) { return subscribe(closeHandlers, id, handler); }
		}),
		files: Object.freeze({
			pickFolder() { return request('files.pickFolder', {}, 120000); },
			pickImages() { return request('files.pickImages', {}, 120000); },
			saveDialog(name) { return request('files.saveDialog', { name }, 120000); },
			list(handle, path = '') { return request('files.list', { handle, path }); },
			read(handle, path = '') { return request('files.read', { handle, path }); },
			write(handle, bytes) { return request('files.write', { handle, bytes }); }
		}),
		settings: Object.freeze({
			get(key, fallback) { return request('settings.get', { key, fallback }); },
			set(key, value) { return request('settings.set', { key, value }); }
		}),
		secrets: Object.freeze({
			get(key) { return request('secrets.get', { key }); },
			set(key, value) { return request('secrets.set', { key, value }); },
			delete(key) { return request('secrets.delete', { key }); }
		}),
		tasks: Object.freeze({
			async start(title, run) {
				if (stopping || typeof run !== 'function') { throw new Error('Task cannot start.'); }
				const id = `task-${++sequence}`;
				const controller = new AbortController();
				const task = { controller };
				tasks.set(id, task);
				try { await request('tasks.begin', { id, title }); } catch (error) { tasks.delete(id); throw error; }
				if (stopping) { controller.abort(); }
				task.completion = Promise.resolve().then(() => {
					return run({ signal: controller.signal, report: (message, increment) => request('tasks.report', { id, message, increment }) });
				}).catch(error => {
					if (!controller.signal.aborted) { send({ type: 'information', text: `Background task failed: ${String(error.message || error)}`.slice(0, 2000) }); emitError(error); }
				}).finally(async () => { tasks.delete(id); try { await request('tasks.end', { id }); } catch {} });
				return id;
			},
			cancel(id) { const task = tasks.get(id); if (task) { task.controller.abort(); } return Boolean(task); }
		}),
		lifecycle: Object.freeze({
			onDispose(handler) { if (typeof handler !== 'function') { throw new Error('Expected a callback.'); } cleanup.add(handler); return { dispose() { cleanup.delete(handler); } }; }
		})
	};
	function event(message) {
		if (message.type === 'task-cancel') { tasks.get(message.id)?.controller.abort(); }
		if (message.type === 'panel-message') { for (const handler of messageHandlers.get(message.panel) || []) { invoke(handler, message.value); } }
		if (message.type === 'panel-disposed') {
			for (const handler of closeHandlers.get(message.panel) || []) { invoke(handler); }
			messageHandlers.delete(message.panel); closeHandlers.delete(message.panel);
		}
	}
	async function dispose(addon) {
		stopping = true;
		for (const task of tasks.values()) { task.controller.abort(); }
		const hooks = [...cleanup];
		if (typeof addon?.deactivate === 'function') { hooks.push(() => addon.deactivate()); }
		await Promise.allSettled(hooks.map(handler => Promise.resolve().then(handler)));
		await Promise.allSettled([...tasks.values()].map(task => task.completion));
		messageHandlers.clear(); closeHandlers.clear(); cleanup.clear();
	}
	return { api, event, dispose };
}
module.exports = { createWorkerApi };
