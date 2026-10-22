/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
exports.activate = api => {
	api.commands.register('waifu.uppercase.selection', async () => {
		const text = await api.editor.getSelectedText();
		if (!text) { return api.window.showInformationMessage('Select some text first.'); }
		await api.editor.replaceSelection(text.toUpperCase());
	});
};
