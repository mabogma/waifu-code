/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
(() => {
	const api = acquireVsCodeApi();
	const saved = api.getState() || {};
	let tab = saved.tab === 'available' ? 'available' : 'installed';
	let query = typeof saved.query === 'string' ? saved.query : '';
	let selected = saved.selected;
	let state;
	let busy = false;
	let toolbar;
	let list;
	const app = document.getElementById('app');
	const detail = document.body.dataset.mode === 'detail';
	const label = text => state?.labels?.[text] || text;
	function element(tag, className, text) {
		const node = document.createElement(tag);
		if (className) { node.className = className; }
		if (text !== undefined) { node.textContent = text; }
		return node;
	}
	function save() { api.setState({ tab, query, selected }); }
	function send(action, id, command) {
		if (busy) { return; }
		if (!['details', 'installFolder', 'website', 'publish', 'installPackage'].includes(action)) { busy = true; render(); }
		api.postMessage({ action, id, command });
	}
	function button(text, action, addon, secondary = false, command) {
		const node = element('button', secondary ? 'secondary' : '', label(text));
		node.type = 'button';
		node.disabled = busy || !state.trusted;
		node.setAttribute('aria-label', addon ? `${label(text)}: ${addon.name}` : label(text));
		node.addEventListener('click', event => { event.stopPropagation(); send(action, addon?.id, command); });
		return node;
	}
	function actions(addon, includeUninstall) {
		const node = element('div', includeUninstall ? 'detail-actions' : 'card-actions');
		if (!addon.installed) { node.append(button('Install', 'install', addon)); }
		else {
			node.append(button(addon.enabled ? 'Disable' : 'Enable', addon.enabled ? 'disable' : 'enable', addon, true));
			if (includeUninstall) { node.append(button('Uninstall', 'uninstall', addon, true)); }
		}
		return node;
	}
	function icon(addon) {
		const node = element('div', 'addon-icon', addon.id === 'uppercase' ? 'Aa' : '♡');
		node.setAttribute('aria-hidden', 'true');
		return node;
	}
	function status(addon) { return !state.trusted ? label('Workspace Restricted') : label(addon.enabled ? 'Enabled' : 'Disabled'); }
	function open(addon) { selected = addon.id; save(); renderList(); send('details', addon.id); }
	function card(addon) {
		const row = element('article', 'card');
		row.tabIndex = 0;
		row.setAttribute('aria-label', `${addon.name}, ${addon.version}`);
		row.setAttribute('aria-current', String(selected === addon.id));
		row.addEventListener('click', () => open(addon));
		row.addEventListener('keydown', event => {
			if (event.target === row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(addon); }
		});
		const body = element('div', 'card-body');
		const title = element('div', 'card-title');
		title.append(element('strong', '', addon.name), element('span', 'version', addon.version));
		const footer = element('div', 'card-footer');
		footer.append(element('span', 'publisher', addon.publisher), actions(addon, false));
		body.append(title, element('p', 'description', addon.description), footer);
		if (addon.installed) { body.append(element('div', 'status', status(addon))); }
		row.append(icon(addon), body);
		return row;
	}
	function empty(title, description) {
		const node = element('div', 'empty');
		node.setAttribute('role', 'status');
		node.append(element('strong', '', label(title)), element('span', '', label(description)));
		return node;
	}
	function renderList() {
		if (!list) { return; }
		list.replaceChildren();
		if (state.registry?.error) { list.append(element('p', 'notice', label('Registry unavailable') + ': ' + state.registry.error)); }
		if (!state.trusted) { list.append(element('p', 'notice', label('This workspace is restricted. Trust it to run or install addons.'))); }
		const heading = element('div', 'section-label');
		heading.append(element('span', '', label(tab === 'installed' ? 'Installed' : state.registry?.url && !state.registry.error ? 'Marketplace' : 'Bundled Catalog')));
		const folder = button('Install from Folder', 'installFolder');
		folder.className = 'folder';
		heading.append(folder);
		list.append(heading);
		const normalized = query.toLocaleLowerCase().trim();
		const addons = state.addons.filter(addon => (tab === 'installed' ? addon.installed : addon.catalog) && [addon.name, addon.description, addon.publisher, addon.id].join(' ').toLocaleLowerCase().includes(normalized));
		for (const addon of addons) { list.append(card(addon)); }
		if (!addons.length) { list.append(empty('No Addons Found', 'Try a different search or install an addon from a folder.')); }
	}
	function renderSidebar() {
		if (!toolbar) {
			toolbar = element('header', 'toolbar');
			const search = element('input', 'search');
			search.type = 'search'; search.value = query;
			search.placeholder = label('Search Waifu Addons');
			search.setAttribute('aria-label', label('Search Waifu Addons'));
			search.addEventListener('input', () => { query = search.value; save(); renderList(); });
			const filters = element('div', 'filters');
			for (const [id, text] of [['installed', 'Installed'], ['available', 'Available']]) {
				const filter = element('button', 'filter'); filter.type = 'button'; filter.dataset.tab = id;
				filter.addEventListener('click', () => { tab = id; save(); render(); });
				filters.append(filter);
			}
			const tools = element('div', 'marketplace-tools');
			for (const [text, action] of [['Marketplace', 'website'], ['Publish Addon', 'publish'], ['Install Package', 'installPackage']]) {
				const control = element('button', 'folder', label(text)); control.type = 'button';
				control.addEventListener('click', () => send(action)); tools.append(control);
			}
			toolbar.append(search, filters, tools);
			list = element('section', 'addon-list'); list.setAttribute('aria-label', label('Waifu Addons'));
			app.replaceChildren(toolbar, list);
		}
		for (const filter of toolbar.querySelectorAll('[data-tab]')) {
			const installed = filter.dataset.tab === 'installed';
			filter.setAttribute('aria-pressed', String(filter.dataset.tab === tab));
			filter.replaceChildren(document.createTextNode(label(installed ? 'Installed' : 'Available')), element('span', 'count', String(state.addons.filter(addon => installed ? addon.installed : addon.catalog).length)));
		}
		renderList();
	}
	function renderDetail() {
		app.replaceChildren();
		const addon = state.addons.find(item => item.id === state.detailId);
		if (!addon) { app.append(empty('No addon selected.', 'Select an addon from Waifu Addons.')); return; }
		const content = element('article', 'detail');
		const header = element('header', 'detail-header');
		const heading = element('div', 'detail-heading');
		heading.append(element('h1', '', addon.name), element('div', 'publisher', `${addon.publisher}  ·  ${addon.version}`), element('p', 'summary', addon.description), actions(addon, true));
		if (addon.installed) { heading.append(element('div', 'status', status(addon))); }
		header.append(icon(addon), heading);
		const tabs = element('nav', 'detail-tabs'); tabs.append(element('span', '', label('Details')));
		const columns = element('div', 'detail-content');
		const info = element('section');
		info.append(element('h2', '', addon.name), element('p', '', addon.description));
		if (addon.readme) { info.append(element('pre', 'readme', addon.readme)); }
		info.append(element('h3', '', label('Commands')));
		for (const command of addon.commands) {
			const row = element('div', 'command-row');
			const run = button('Run', 'run', addon, true, command.id);
			run.disabled ||= !addon.installed || !addon.enabled;
			row.append(element('span', '', command.title), run);
			info.append(row);
		}
		info.append(element('h3', '', label('Permissions')));
		if (!addon.permissions.length) { info.append(element('p', 'permission', label('No additional editor API permissions.'))); }
		for (const permission of addon.permissions) { info.append(element('code', 'permission', permission)); }
		const metadata = element('aside', 'metadata');
		const data = element('dl');
		for (const [key, value] of [['Identifier', addon.id], ['Version', addon.version], ['Publisher', addon.publisher]]) { data.append(element('dt', '', label(key)), element('dd', '', value)); }
		data.append(element('dt', '', label(addon.registry ? 'Source' : addon.catalog ? 'Bundled Catalog' : 'Local addon')), element('dd', '', addon.registry ? addon.source : label(addon.catalog ? 'Built into Waifu Code' : 'Installed locally')));
		metadata.append(data); columns.append(info, metadata); content.append(header, tabs, columns);
		if (!state.trusted) { content.prepend(element('p', 'notice', label('This workspace is restricted. Trust it to run or install addons.'))); }
		app.append(content);
	}
	function render() {
		if (!state) { return; }
		app.setAttribute('aria-busy', String(busy));
		if (detail) { renderDetail(); } else { renderSidebar(); }
	}
	window.addEventListener('message', event => {
		if (event.data?.type !== 'state' || !Array.isArray(event.data.addons)) { return; }
		state = event.data; busy = false; render();
	});
	api.postMessage({ action: 'ready' });
})();
