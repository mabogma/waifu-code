# Waifu Addons 0.4: расширенный API

Совместим с манифестами apiVersion: 1 и старыми аддонами. Новые методы требуют менеджер Waifu Addons 0.4+. Указанные разрешения нужно добавить в `permissions`. Они регулируют вызовы API менеджера; доверенный Node.js-код не изолирован от системы.

## Панели и сообщения — ui.panels

```js
const panel = await api.panels.create({
  title: 'Мои фотографии',
  html: '<h1>Галерея</h1><button id="choose">Выбрать фото</button>',
  style: 'body { font-family: var(--vscode-font-family); }',
  script: `const waifu = acquireVsCodeApi();
    document.getElementById('choose').onclick = () =>
      waifu.postMessage({ action: 'choose' });
    window.addEventListener('message', event => {
      // event.data — JSON от api.panels.postMessage.
    });`
});
const subscription = api.panels.onMessage(panel, message => {
  // Проверяй структуру и допустимые action. Содержимое панели не является командой редактора.
});
await api.panels.postMessage(panel, { type: 'status', text: 'Готово' });
const closed = api.panels.onDispose(panel, () => subscription.dispose());
// await api.panels.dispose(panel);
```

`create` возвращает `Promise<string>` — непрозрачный ID панели. До 5 панелей на аддон. `html`, `script`, `style` — строки до 200 000 символов каждая. Передавай тело HTML, а скрипт и стили — отдельными полями. Менеджер добавляет оболочку и CSP с nonce. Inline onclick, внешние скрипты, сетевой fetch, формы и произвольные локальные ресурсы заблокированы. Используй addEventListener и текстовые DOM-операции для пользовательских данных. Не вставляй токены в панель.

`onMessage` и `onDispose` возвращают `{dispose()}` для удаления подписки. JSON-сообщения ограничены 64 КиБ. Обработчики могут быть async; ошибки попадают в лог. Для действий, требующих ожидания диалога или долгой работы, из обработчика запускай `api.tasks.start`.

## Выбранные файлы — files.read / files.write

```js
const folder = await api.files.pickFolder(); // {handle, name, directory:true} | null
if (folder) {
  const entries = await api.files.list(folder.handle); // [{name, directory, image}]
  const bytes = await api.files.read(folder.handle, 'photo.jpg'); // Uint8Array
}
const photos = await api.files.pickImages(); // [{handle, name, directory:false}], [] при отмене
const destination = await api.files.saveDialog('photo.jpg'); // объект handle | null
if (destination && photos.length) {
  const bytes = await api.files.read(photos[0].handle);
  await api.files.write(destination.handle, bytes); // true после успешного сохранения
}
```

`pickFolder`, `pickImages`, `list`, `read` требуют files.read. `saveDialog` и `write` требуют files.write. Выбор папки даёт только чтение. Запись возможна исключительно в точный путь, подтверждённый пользователем через «Сохранить как», с заменой существующего файла, если путь был выбран. API удаления файлов и рекурсивной записи в папку отсутствует.

Путь передаётся относительно выбранной папки, с `/`, без `..`, `\\`, абсолютных путей и выхода через символические ссылки. Идентификаторы не содержат реального пути, действуют только в текущем сеансе аддона и не подходят для сохранения в settings. Чужой handle не принимается. `list` перечисляет один каталог, до 2000 записей; подкаталог можно указать вторым аргументом. `read/write` — до 20 МиБ. `write` принимает Uint8Array, не base64.

Диалоги выбора ожидаются до 120 секунд. На время такого диалога обычный 10-секундный таймер команды продлевается; после ответа снова действует лимит обычной команды. Отмена задачи не закрывает системный диалог: обязательно проверь signal после его завершения, прежде чем сохранять результат.

## Изображения в панели — ui.panels + files.read

```js
const files = await api.files.pickImages();
if (files.length) {
  const uri = await api.panels.image(panel, files[0].handle);
  await api.panels.postMessage(panel, { type: 'image', uri });
}
```

`panels.image(panelId, handle, relativePath = '')` возвращает `Promise<string>` с webview URI. Только PNG, JPEG, WebP, GIF, BMP, до 20 МиБ. SVG и HTML не поддерживаются. Менеджер копирует разрешённое изображение в отдельный кэш панели; исходная папка не становится localResourceRoot. На панель максимум 200 изображений и 64 МиБ кэша. Повторный запрос того же файла возвращает тот же снимок; чтобы увидеть изменения на диске, открой новую панель. Кэш удаляется при закрытии панели или остановке аддона.

В панели назначь URI в `img.src`. Для настоящей миниатюры загрузи изображение и уменьши через canvas, затем используй `canvas.toBlob` и `URL.createObjectURL`. Освобождай blob-URL через `URL.revokeObjectURL`. Пример photo-gallery создаёт WebP-миниатюры до 360px; оригинал открывается отдельно. Для повреждённых файлов/недоступного canvas обрабатывай ошибку или показывай исходный локальный ресурс. Менеджер не выполняет перекодирование на стороне Node.js.

## Долгие задачи — tasks.background

```js
const taskId = await api.tasks.start('Скачивание', async ({signal, report}) => {
  signal.throwIfAborted();
  const response = await fetch('https://example.com/photo.jpg', {signal});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Для больших ответов читай поток и ограничивай количество байтов.
  // Не скачивай без ограничения весь ответ через arrayBuffer().
  await report('Данные получены', 80);
  signal.throwIfAborted();
  // Обработай/сохрани данные через API файлов после выбора пути пользователем.
});
// api.tasks.cancel(taskId); // true, если задача найдена
```

start возвращает Promise ID после регистрации задачи, а не после её завершения. Callback работает отдельно от 10-секундного лимита команды. До 8 активных задач на аддон. В редакторе появляется уведомление с прогрессом и кнопкой отмены. `report(message, increment?)` возвращает Promise; increment — прибавка от 0 до 100, не абсолютный процент. Завершение callback закрывает прогресс; необработанная ошибка отображается пользователю и пишется в лог.

Отмена кооперативная: прокидывай AbortSignal в fetch и проверяй его в циклах и после диалогов. cancel лишь подаёт сигнал; callback должен закончиться самостоятельно. При отключении аддона менеджер подаёт отмену всем задачам и принудительно завершает Worker после срока очистки. Не запускай дочерние процессы и не используй внешние сервисы в примере без требования пользователя. Ограничивай размер ответов, проверяй MIME/status, задавай тайм-ауты, не пиши токены в URL/логи. Внешние обращения явно описывай в README.

## Настройки — storage.settings

```js
const size = await api.settings.get('thumbnailSize', 180);
await api.settings.set('thumbnailSize', 240);
await api.settings.set('obsolete', undefined); // удалить
```

Настройки сохраняются между включениями и перезапусками в globalState, отдельно по ID аддона. Ключ: 1–100 латинских букв, цифр, `_`, `.`, `-`. JSON-значение до 64 КиБ; до 100 ключей на аддон. Это обычные локальные настройки, не секретное хранилище и не автоматически создаваемая страница Settings. Пользовательский интерфейс настроек делает сам аддон. Удаление аддона сохраняет настройки для переустановки.

## Токены — storage.secrets

```js
await api.secrets.set('accountToken', token);
const token = await api.secrets.get('accountToken'); // string | undefined
await api.secrets.delete('accountToken');
```

Используется SecretStorage редактора с его системным механизмом защиты, отдельное пространство ключей каждого аддона. Строка до 16 000 символов, непустая. Не заменяй secrets обычными settings, файлами или webview state. Для выхода из аккаунта вызови delete. Секреты сохраняются при отключении и удалении аддона, пока их явно не удалили. Это разделение на уровне API, а не изоляция от другого доверенного Node.js-кода с правами пользователя.

## Жизненный цикл

```js
exports.activate = api => {
  api.lifecycle.onDispose(async () => {
    // Освободить свои ресурсы: clearInterval, закрыть соединения и т.п.
  });
  api.commands.register('waifu.my-addon.open', async () => { /* ... */ });
};
exports.deactivate = async () => {
  // Необязательный второй способ очистки ресурсов модуля.
};
```

При включении в доверенном рабочем пространстве запускается Worker, activate вызывается один раз на сеанс. При отключении/удалении/перезагрузке менеджера закрываются панели, отзываются файловые handles, задачи получают AbortSignal. Вызываются зарегистрированные onDispose и экспортированный deactivate; на добровольное завершение Worker отводится до 1,5 секунды, затем принудительное завершение. При аварийном выходе Worker панели и прогресс тоже очищаются. При убийстве всего приложения/системном сбое гарантии выполнения JS-хуков нет.

Обычные команды по-прежнему ограничены 10 секундами, обычные RPC — 5 секундами, диалоги — 120 секундами. CPU-цикл внутри Worker может помешать обработке отмены, поэтому разбивай вычисления на порции и отдавай управление event loop. Текущий менеджер при refresh/изменении установленных аддонов перезапускает все активные сеансы: не рассчитывай на сохранение фоновой задачи после такого изменения. Сохраняй только безопасные восстанавливаемые настройки; handles и panelId не переживают сеанс.

## Готовый пример

`extensions/waifu-addons/examples/photo-gallery` содержит manifest, main.cjs и три файла панели. Установи папку через Install from Folder. Галерея показывает все основные UI/файловые возможности без сети. Для секретов используй отдельный явно запрошенный сценарий аккаунта; демонстрационная галерея этого разрешения не запрашивает.

Проверки разработчика: закрыть панель во время предзагрузки; отменить задачу в уведомлении; отключить аддон во время загрузки; проверить отсутствие оставшихся панелей/прогресса; проверить отказ чужому handle и пути `../`; сохранить копию через диалог; убедиться, что секретов нет в settings и логах. Не утверждай, что ручные сценарии выполнены, если проверены лишь автоматические тесты.
