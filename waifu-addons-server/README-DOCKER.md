# Waifu Addons: Docker + nginx на порту 4853

## Быстрый запуск

Распакуй проект на удалённом Linux-сервере с Docker Engine и Docker Compose v2. Docker Desktop не нужен. Из папки с compose.yaml:

```sh
docker compose up -d --build
docker compose ps
curl http://localhost:4853/api/health
```

На самом сервере сайт и API доступны по http://localhost:4853. С другого компьютера открой http://IP-СЕРВЕРА:4853. Схема: интернет/браузер → порт хоста 4853 → nginx:4853 → registry:4853. Только nginx публикует порт на хосте. Сервер доступен nginx по имени сервиса registry во внутренней сети Docker. Не запускай второй nginx на том же адресе и порту хоста.

Внутри сервера HOST=0.0.0.0, PORT=4853. Для запуска без nginx:

```sh
docker build -t waifu-addons-server:local .
docker run -d --name waifu-addons-registry -p 4853:4853 -v waifu-addons-data:/data waifu-addons-server:local
```

Эти варианты альтернативные: одновременно один порт хоста занимать нельзя. Если до этого запущен Compose, сначала выполни docker compose down. Для одиночного docker run используется отдельный том waifu-addons-data; данные Compose находятся в другом томе.

## Доступ из интернета и HTTPS

На VPS разреши входящий TCP 4853 в firewall провайдера и ОС. Для домашнего сервера дополнительно нужен проброс TCP 4853 на роутере; при CGNAT требуется публичный IP либо туннель. Сам конфиг nginx не создаёт публичный IP, DNS и сертификат.

HTTP-адрес: `http://IP-СЕРВЕРА:4853`. Для публикации с ключом и подключения удалённого каталога в Waifu Code используй HTTPS. Редактор разрешает HTTP только для localhost.

Направь DNS своего домена на сервер. Помести действующий сертификат этого домена и ключ в отдельную папку certs:

```text
certs/
  fullchain.pem
  privkey.pem
```

Сертификат получи у своего провайдера/ACME-клиента, например через DNS-проверку. Самоподписанный сертификат не подходит для обычного публичного подключения. При использовании symlink-файлов Certbot скопируй фактические PEM-файлы либо смонтируй полное дерево с доступными целями ссылок. Не помещай сертификаты и ключи в образ.

```sh
docker compose -f compose.yaml -f compose.tls.yaml up -d --build
docker compose exec nginx nginx -t
curl https://addons.example.com:4853/api/health
```

Вместо addons.example.com подставь свой домен. HTTPS использует тот же внешний порт 4853. После переключения HTTP на этом порту больше не используется. Чтобы указать другую папку сертификатов, задай WAIFU_CERT_DIR в .env либо окружении; по умолчанию ./certs. После обновления PEM-файлов:

```sh
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

В настройках Waifu Code задай `waifuAddons.registryUrl` равным `https://твой-домен:4853`. Перезапусти/обнови каталог. Для локальной проверки подходит `http://localhost:4853`.

## Издатели и данные

При первом старте автоматически создаётся издатель waifu и его ключ. Посмотреть свой ключ в своём терминале:

```sh
docker compose exec registry cat /data/waifu-token.txt
```

Введи ключ в форму публикации на своём сайте. Дополнительный издатель:

```sh
docker compose exec registry node cli.mjs publisher my-publisher
docker compose exec registry cat /data/my-publisher-token.txt
```

Не публикуй ключи в Git и не отправляй их нейросетям. В Docker-образ копируются только файлы приложения: локальная .private, Git, сертификаты и токены исключены.

Пакеты и ключи сохраняются в именованном томе registry-data, на пути /data контейнера. Обычный down/up сохраняет данные. Не используй `docker compose down -v`, если данные нужны. У сервера одна реплика: локальное файловое хранилище не предназначено для одновременной записи из нескольких экземпляров.

Это самостоятельный новый каталог. Данные работающего сайта chatgpt.site и его ключи автоматически не переносятся. Для переноса публикаций их нужно скачать и опубликовать в новом каталоге своим новым ключом. Публикации примеров из папки examples также выполняются через форму сайта.

## Резервная копия и обновление

Останови сервер перед копированием, чтобы получить согласованную копию пакетов и записей:

```sh
docker compose stop registry
docker compose cp registry:/data ./waifu-addons-backup
docker compose start registry
```

Копия содержит ключи издателей; храни её приватно. Для восстановления в уже созданный новый том останови registry, скопируй содержимое резервной папки в /data и верни владельца UID/GID 1000:1000. Не копируй базу в работающий сервер.

Обновление приложения: замени файлы проекта и выполни ту же команду up -d --build, сохраняя использованные -f для HTTPS. Том при пересборке не изменяется. Логи:

```sh
docker compose logs --tail=100 registry nginx
docker compose exec nginx nginx -t
```

nginx принимает пакеты до 12 МиБ — столько же, сколько API; ключ Authorization передаётся серверу. Контейнер registry работает без root, с read-only файловой системой приложения и записью только в том /data и временную /tmp. Токен в образ не встраивается.

## Если nginx уже установлен на сервере

Вместо обычного compose.yaml используй самостоятельный compose.host-nginx.yaml:

```sh
docker compose -f compose.host-nginx.yaml up -d --build
sudo cp deploy/nginx/waifu-addons-host.conf /etc/nginx/conf.d/waifu-addons.conf
sudo nginx -t
sudo systemctl reload nginx
```

В этом варианте контейнер слушает 4853, Docker публикует его только на 127.0.0.1:4854, а установленный на хосте nginx принимает внешний порт 4853. Так оба процесса не пытаются занять один сокет. Конфиг содержит комментарии для включения HTTPS с сертификатом. Для последующих exec/logs/stop/up в этом варианте всегда добавляй `-f compose.host-nginx.yaml`; его том отличается от тома основного Compose-проекта.

Конфиги nginx: deploy/nginx/waifu-addons.conf (HTTP внутри Docker), deploy/nginx/waifu-addons-tls.conf (HTTPS внутри Docker), deploy/nginx/waifu-addons-host.conf (nginx на Linux-хосте). Это альтернативные способы запуска.

## Предупреждение при скачивании

В собственной установке сайт и пакет скачиваются напрямую с одного домена, без посредничества Sites. Предупреждения самого браузера сайт отключать не может. Здесь нет подмены расширения файла, отключения браузерной защиты или изменения проверок установки в редакторе.

Официальные справочники: [публикация портов Docker](https://docs.docker.com/engine/network/port-publishing/) и [nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).
