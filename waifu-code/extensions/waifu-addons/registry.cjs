/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { installAddon } = require('./runtime.cjs');
const codec = () => import(pathToFileURL(path.join(__dirname, 'package-codec.mjs')).href);
const DEFAULT_REGISTRY = 'http://132.243.115.51:4853';
function registryUrl(value) {
	const url = new URL(value);
	if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.origin !== DEFAULT_REGISTRY)) { throw new Error('Use HTTPS, localhost HTTP, or the configured Waifu server at 132.243.115.51:4853.'); }
	return url.href.replace(/\/$/, '');
}
async function fetchBytes(url, limit, timeout = 10000) {
	const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json, application/vnd.waifu.addon+json' } });
	if (!response.ok) { throw new Error(`Registry request failed (${response.status}).`); }
	const { readBoundedBody } = await codec();
	return readBoundedBody(response, limit);
}
async function fetchCatalog(base) {
	base = registryUrl(base);
	const { validateManifest } = await codec();
	const records = new Map();
	const cursors = new Set();
	let cursor;
	do {
		const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fetchBytes(base + '/api/addons' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), 2 * 1024 * 1024)));
		if (!Array.isArray(data.addons) || data.addons.length > 100) { throw new Error('Invalid registry catalog.'); }
		for (const item of data.addons) {
			const manifest = validateManifest(item);
			if (typeof item.publisher !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(item.publisher) || !/^[a-f0-9]{64}$/.test(item.sha256)) { throw new Error('Invalid registry package metadata.'); }
			manifest.publisher = item.publisher;
			records.set(manifest.id, { manifest, source: base, sha256: item.sha256, size: item.size });
		}
		cursor = data.nextCursor;
		if (cursor) {
			if (typeof cursor !== 'string' || cursor.length > 2048 || cursors.has(cursor) || cursors.size >= 100) { throw new Error('Invalid registry pagination.'); }
			cursors.add(cursor);
		}
	} while (cursor);
	return records;
}
async function inspectPackage(bytes) {
	const { MAX_PACKAGE_BYTES, validatePackage } = await codec();
	if (bytes.length > MAX_PACKAGE_BYTES) { throw new Error('Addon package exceeds 12 MB.'); }
	return validatePackage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
async function installPackage(bytes, storage, expected) {
	if (expected && createHash('sha256').update(bytes).digest('hex') !== expected.sha256) { throw new Error('Package SHA-256 does not match the registry.'); }
	const validated = await inspectPackage(bytes);
	if (expected && (validated.manifest.id !== expected.manifest.id || validated.manifest.version !== expected.manifest.version || validated.manifest.publisher !== expected.manifest.publisher)) { throw new Error('Downloaded addon identity does not match the registry.'); }
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waifu-package-'));
	try {
		const { base64ToBytes } = await codec();
		for (const file of validated.bundle.files) {
			const destination = path.join(directory, ...file.path.split('/'));
			const relative = path.relative(directory, destination);
			if (relative.startsWith('..') || path.isAbsolute(relative)) { throw new Error('Invalid package file path.'); }
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.writeFile(destination, base64ToBytes(file.data), { flag: 'wx' });
		}
		return await installAddon(directory, storage);
	} finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function installRegistryAddon(entry, storage) {
	const base = registryUrl(entry.source);
	const bytes = await fetchBytes(`${base}/api/addons/${entry.manifest.id}/${entry.manifest.version}/package`, 12 * 1024 * 1024, 30000);
	return installPackage(bytes, storage, entry);
}
module.exports = { DEFAULT_REGISTRY, registryUrl, fetchCatalog, inspectPackage, installPackage, installRegistryAddon };
