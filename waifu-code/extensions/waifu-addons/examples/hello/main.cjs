/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
exports.activate = api => {
	api.commands.register('waifu.hello-waifu.greet', () => {
		api.window.showInformationMessage('Welcome to Waifu Code ♡ Your first Waifu Addon is running!');
	});
};
