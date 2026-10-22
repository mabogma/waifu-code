'use strict';
const vscode = acquireVsCodeApi();
const grid = document.getElementById('grid');
const preview = document.getElementById('preview');
const filter = document.getElementById('filter');
const images = new Map();
const thumbnails = new Set();
let selected;
const send = message => vscode.postMessage(message);
function resize(size) { grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${size}px,1fr))`; document.getElementById('size').value = String(size); }
function applyFilter() { for (const card of grid.children) { card.hidden = !card.dataset.name.includes(filter.value.toLocaleLowerCase()); } }
document.getElementById('open').onclick = () => send({ action: 'open' });
document.getElementById('close').onclick = () => preview.close();
document.getElementById('save').onclick = () => send({ action: 'save', index: selected });
document.getElementById('size').onchange = event => { const value = Number(event.target.value); resize(value); send({ action: 'size', value }); };
filter.oninput = applyFilter;
window.addEventListener('message', async event => {
	const message = event.data;
	if (message.type === 'settings') { if ([120, 180, 240].includes(message.size)) { resize(message.size); } return; }
	if (message.type === 'error') { document.getElementById('status').textContent = message.text; return; }
	if (message.type !== 'image') { return; }
	images.set(message.index, message);
	const card = document.createElement('button'); card.className = 'card'; card.dataset.name = message.name.toLocaleLowerCase();
	const image = document.createElement('img'); image.alt = message.name; image.loading = 'lazy'; image.src = message.uri;
	// Generate a real 360px thumbnail inside the panel. Canvas never sends pixels outside this webview.
	image.onload = () => {
		if (image.dataset.thumbnail) { return; }
		try {
			const scale = Math.min(1, 360 / Math.max(image.naturalWidth, image.naturalHeight));
			const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
			canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
			canvas.toBlob(blob => { if (!blob) { return; } const url = URL.createObjectURL(blob); thumbnails.add(url); image.dataset.thumbnail = 'true'; image.src = url; }, 'image/webp', .8);
		} catch { /* Keep the local image URI if canvas conversion is unavailable. */ }
	};
	const label = document.createElement('span'); label.textContent = message.name; card.append(image, label);
	card.onclick = () => { selected = message.index; document.getElementById('full').src = message.uri; document.getElementById('full').alt = message.name; document.getElementById('caption').textContent = message.name; preview.showModal(); };
	grid.append(card); applyFilter(); document.getElementById('status').textContent = `Фотографий: ${images.size}`;
});
window.addEventListener('pagehide', () => { for (const url of thumbnails) { URL.revokeObjectURL(url); } });
send({ action: 'ready' });
