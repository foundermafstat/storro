# Перевыпуск GitHub ключей для Storro production

Цель: заменить временные/локальные GitHub credentials на отдельные production credentials для `https://storro.aima.space`.

Не коммитить секреты. Все значения ниже вносятся только на сервере в `/var/www/js/storro/.env.production`.

## 1. GitHub OAuth App для входа в Storro

Это авторизация пользователя через NextAuth/Auth.js.

1. Открыть GitHub: `Settings` -> `Developer settings` -> `OAuth Apps` -> `New OAuth App`.
2. Заполнить:
   - `Application name`: `Storro Production`
   - `Homepage URL`: `https://storro.aima.space`
   - `Authorization callback URL`: `https://storro.aima.space/api/auth/callback/github`
3. Создать приложение.
4. Скопировать:
   - `Client ID` -> `AUTH_GITHUB_ID`
   - новый `Client Secret` -> `AUTH_GITHUB_SECRET`
5. На сервере обновить env:

```bash
ssh root@86.48.18.202
cd /var/www/js/storro
nano .env.production
```

Заменить:

```env
AUTH_GITHUB_ID=...
AUTH_GITHUB_SECRET=...
AUTH_URL=https://storro.aima.space
AUTH_TRUST_HOST=true
```

6. Перезапустить web app:

```bash
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

7. Проверить вход:

```bash
curl -I https://storro.aima.space/api/auth/signin
```

Затем открыть `https://storro.aima.space/sign-in` в браузере и пройти GitHub login.

## 2. GitHub App для подключения репозиториев

Это интеграция для установки GitHub App, чтения репозиториев, PR и webhook событий.

1. Открыть GitHub: `Settings` -> `Developer settings` -> `GitHub Apps` -> `New GitHub App`.
2. Заполнить:
   - `GitHub App name`: уникальное имя, например `storro-production`
   - `Homepage URL`: `https://storro.aima.space`
   - `Callback URL`: `https://storro.aima.space/api/integrations/github/callback`
   - `Setup URL`: `https://storro.aima.space/api/integrations/github/callback`
   - `Webhook URL`: `https://storro.aima.space/api/webhooks/github`
   - `Webhook secret`: сгенерировать случайную строку 32+ символа
   - `SSL verification`: enabled
3. Repository permissions:
   - `Contents`: `Read-only`
   - `Pull requests`: `Read-only`
   - `Checks`: `Read-only`
   - `Metadata`: GitHub включает автоматически
4. Subscribe to events:
   - `Push`
   - `Pull request`
   - `Release`
   - `Issues`
   - `Workflow run`
5. Создать приложение.
6. На странице GitHub App сохранить:
   - `App ID` -> `GITHUB_APP_ID`
   - URL slug из `https://github.com/apps/<slug>` -> `GITHUB_APP_SLUG`
   - `Client ID` -> `GITHUB_APP_CLIENT_ID`
   - `Client secret` -> `GITHUB_APP_CLIENT_SECRET`
   - `Webhook secret` -> `GITHUB_APP_WEBHOOK_SECRET`
7. В разделе `Private keys` нажать `Generate a private key` и скачать `.pem`.
8. Преобразовать private key в одну строку с escaped newlines:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' /path/to/downloaded-key.pem
```

Скопировать вывод в `GITHUB_APP_PRIVATE_KEY`.

9. На сервере обновить env:

```bash
ssh root@86.48.18.202
cd /var/www/js/storro
nano .env.production
```

Заменить:

```env
GITHUB_APP_ID=...
GITHUB_APP_SLUG=...
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n
GITHUB_APP_WEBHOOK_SECRET=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
```

10. Перезапустить:

```bash
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

11. Проверить install URL из UI:
   - открыть `https://storro.aima.space/settings/integrations`
   - нажать GitHub install/connect
   - GitHub должен открыть установку приложения `storro-production`

## 3. Проверки после ротации

На сервере:

```bash
cd /var/www/js/storro
pm2 status
docker ps | grep storro
curl -fsS https://storro.aima.space/api/mcp
curl -fsS https://storro.aima.space/api/integrations/chatgpt/app
```

В браузере:

1. Войти через GitHub OAuth.
2. Открыть `Settings -> Integrations`.
3. Установить GitHub App.
4. Открыть проект -> GitHub pull requests.
5. Проверить, что список репозиториев загружается без ручного ввода installation id/repo.

## 4. Что удалить после успешной проверки

1. Удалить старый GitHub OAuth App, если он больше не используется.
2. Удалить старый GitHub App или хотя бы отключить webhook/installation.
3. Убедиться, что старые значения отсутствуют в `/var/www/js/storro/.env.production`.
4. Проверить, что deploy key для сервера остается read-only в repo `foundermafstat/storro`.

## References

- GitHub OAuth callback behavior: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- GitHub App registration: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
- GitHub App webhooks and webhook secret: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps
- GitHub App private keys: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
