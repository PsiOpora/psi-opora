# Как получить Refresh Token для Яндекс.Директа

Refresh token нужен для `YANDEX_REFRESH_TOKEN` (см. [.env.example](../.env.example))
или для поля «Refresh Token» в дашборде (`/settings/ads`, см.
[credentials-form.tsx](../apps/dashboard/src/app/(dashboard)/settings/ads/credentials-form.tsx)).
Токен привязан к учётке Яндекса, у которой есть доступ к нужным рекламным
кабинетам Директа — получайте его именно под этой учёткой.

Шаги 1–6 одинаковые для любой ОС, разница только в команде обмена кода на
токен на шаге 7 — там отдельно даны варианты для Windows (PowerShell, cmd) и
для bash (Linux/macOS/Git Bash).

## 1. Создайте приложение в Яндекс OAuth

Откройте [oauth.yandex.ru/client/new](https://oauth.yandex.ru/client/new) и
создайте приложение (или откройте уже существующее в
[списке приложений](https://oauth.yandex.ru/)).

## 2. Настройте платформу

В разделе «Платформы» выберите «Веб-сервисы» и укажите Redirect URI:

```
https://oauth.yandex.ru/verification_code
```

Это значение по умолчанию — подходит для ручного получения токена (без
собственного сервера-редиректа).

## 3. Добавьте права доступа

В разделе «Доступ к данным» добавьте право Яндекс.Директа:

```
direct:api
```

## 4. Сохраните приложение и скопируйте ключи

После сохранения на странице приложения будут доступны **ClientID** и
**Client Secret** — они понадобятся на следующих шагах и в поля
`YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` (или в дашборде).

## 5. Получите код подтверждения

Под учёткой, у которой есть доступ к нужным рекламным кабинетам Директа,
откройте в браузере ссылку (подставив свой `client_id`):

```
https://oauth.yandex.ru/authorize?response_type=code&client_id=ВАШ_CLIENT_ID
```

Разрешите доступ приложению — Яндекс покажет одноразовый код подтверждения
(живёт несколько минут, использовать нужно сразу).

## 6. Обменяйте код на токены

Дальше код нужно обменять на `access_token` + `refresh_token` запросом
`POST https://oauth.yandex.ru/token`. Подставьте свои `КОД`, `CLIENT_ID` и
`CLIENT_SECRET` в один из вариантов ниже — результат одинаковый, выбирайте
по тому, где выполняете команду.

### Windows — PowerShell

Обычная команда `curl` в PowerShell — это алиас `Invoke-WebRequest` с другим
набором параметров, поэтому `-d` в ней не сработает так, как в примерах для
bash. Используйте `Invoke-RestMethod`:

```powershell
Invoke-RestMethod -Method Post -Uri "https://oauth.yandex.ru/token" -Body @{
    grant_type    = "authorization_code"
    code          = "КОД"
    client_id     = "ВАШ_CLIENT_ID"
    client_secret = "ВАШ_CLIENT_SECRET"
}
```

Ответ выводится сразу в виде объекта — нужное поле называется `refresh_token`.

Если предпочитаете именно curl — в Windows 10/11 есть настоящий `curl.exe`
(не алиас), обращайтесь к нему явно:

```powershell
curl.exe -X POST https://oauth.yandex.ru/token -d "grant_type=authorization_code&code=КОД&client_id=ВАШ_CLIENT_ID&client_secret=ВАШ_CLIENT_SECRET"
```

### Windows — cmd.exe

```bat
curl -X POST https://oauth.yandex.ru/token -d "grant_type=authorization_code&code=КОД&client_id=ВАШ_CLIENT_ID&client_secret=ВАШ_CLIENT_SECRET"
```

### macOS / Linux / Git Bash

```bash
curl -X POST https://oauth.yandex.ru/token -d "grant_type=authorization_code&code=КОД&client_id=ВАШ_CLIENT_ID&client_secret=ВАШ_CLIENT_SECRET"
```

## 7. Сохраните refresh_token

В ответе (JSON) будет поле `refresh_token` — скопируйте его целиком в
`YANDEX_REFRESH_TOKEN` или в поле «Refresh Token» в дашборде. `access_token`
из этого же ответа сохранять не нужно — сервис получает свежий access-токен
по refresh-токену автоматически при каждом запросе к Директу.

## Токен перестал работать

Refresh token у Яндекса не бессрочный. Если отчёты по рекламе перестанут
обновляться с ошибкой `invalid_grant` — повторите шаги 5–7.
