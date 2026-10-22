# Waifu Code

Отдельный portable-редактор на базе Code OSS/VSCodium с темой Waifu Midnight, маскотом и собственной системой Waifu Addons. Исходные лицензии сохранены.

## Запуск готового приложения

Откройте `../WaifuCode-Windows-x64/Waifu Code.exe`. Node.js и Visual Studio для запуска portable-версии не нужны. Сохраняйте всю папку приложения целиком: настройки, обычные расширения и Waifu Addons находятся в её папке `data`.

## Waifu Addons 0.2

Нажмите сердце в боковой панели или вызовите `Waifu Addons: Manage Installed Addons` из палитры команд.

- Поиск фильтрует аддоны по имени, описанию, издателю и идентификатору.
- Installed показывает установленные аддоны; Available — встроенный каталог.
- Нажатие на строку открывает страницу подробностей с описанием, версией, издателем, командами и разрешениями.
- Install устанавливает аддон из встроенного каталога. Enable / Disable включают и отключают его; Uninstall удаляет после подтверждения.
- Install from Folder или кнопка + устанавливает аддон из папки с `waifu-addon.json`.
- Кнопка Run на странице аддона выполняет его команду. Для Uppercase выделите текст в редакторе, откройте аддон и нажмите Run. Ctrl+Z отменяет изменение.

В portable-версии уже установлены Hello, Waifu! и Waifu Uppercase. Каталог Waifu Addons пока локальный; собственный сетевой Marketplace не подключён. Обычные расширения VSCodium/Open VSX доступны отдельно.

Если приложение было открыто во время обновления, перезапустите его или выполните `Developer: Reload Window`.

## Разработка аддонов

Примеры: `extensions/waifu-addons/examples/hello` и `extensions/waifu-addons/examples/uppercase`. Формат: `waifu-addon.json`, `apiVersion: 1`, точка входа `.cjs`, список команд с префиксом `waifu.<id-аддона>.`.

API: `commands.register(id, handler)`, `window.showInformationMessage(text)`, `log(text)`, `await editor.getSelectedText()`, `await editor.replaceSelection(text)`. Для редакторских методов задайте `editor.read` / `editor.write` в `permissions`. Это разрешения на API менеджера, а не изоляция Node.js от файловой системы. Аддоны выполняют доверенный код с правами пользователя. В недоверенных рабочих пространствах установка, управление и выполнение заблокированы. Папки node_modules и .git не копируются; внешние зависимости следует объединять в готовый .cjs.

## Исходники и проверки

Текущая папка содержит отдельно изменённый dev-снимок microsoft/vscode версии 1.144.0. Готовая portable-версия основана на официальном VSCodium 1.140.06880. Полная локальная компиляция dev-снимка не завершена. Для её продолжения сохранены `Build-Waifu.cmd`, `Start-Waifu.cmd` и `scripts/waifu-doctor.cjs`; нужен Node.js из .nvmrc и Visual Studio C++ Build Tools с Spectre-библиотеками.

Проверки: `npm run waifu:test`; `node extensions/waifu-addons/test/gallery-browser.cjs` проверяет интерфейс в установленном Chrome; `node scripts/waifu-smoke.cjs ../WaifuCode-Windows-x64` проверяет готовую сборку в отдельном тестовом профиле. Последняя проверка включает встроенный менеджер, страницу аддона, редактирование, отмену, отключение, включение и установку.

Подробный статус: BUILD-STATUS.md. Оригинальное описание Code OSS: README-UPSTREAM.md.
