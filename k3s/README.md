# Деплой в k3s

Манифесты — по одному файлу на сервис (Deployment + Service, где сервису нужен
входящий трафик). `waha.yaml`, `redis.yaml` и `postgres.yaml`
дополнительно содержат постоянные тома (сессии WhatsApp / данные Redis /
PostgreSQL) — без них данные пропадут при пересоздании пода.

MinIO в кластере не разворачивается: фича «Бэкап CRM» ходит напрямую во
внешний S3 (сейчас — Яндекс.Облако, эндпоинт настраивается в UI), а MinIO —
это заглушка только для локальной разработки (`docker-compose.yml`).

Образы для tg-bot/max-bot/tg-userbot-worker/hatchet-worker/bitrix-webhook/dashboard/clients
собираются и катятся в кластер через GitHub Actions ([.github/workflows/deploy-k3s.yml](../.github/workflows/deploy-k3s.yml)),
в свой реестр (`registry.yaml`), поднятый в этом же кластере. Разделы ниже —
разовая настройка перед первым деплоем.

## 0. k3s и Traefik на новый сервер

Установка с нуля, когда k3s на сервере ещё нет вообще. Встроенный `traefik`
в k3s отключён — вместо него ставится отдельный Traefik через Helm с ACME
`certResolver: letsencrypt`, на который опираются все `IngressRoute` в этом
репозитории (см. "Домены" ниже). Встроенный `servicelb` (klipper-lb) не
трогаем — для одной ноды он и так делает то же самое, что MetalLB на
multi-node bare metal: сам вешает внешний IP ноды на `Service type:
LoadBalancer`, без отдельного L2Advertisement/IPAddressPool.

1. Установить k3s. Этот шаг выполняется по SSH прямо на сервере — там
   всегда bash/sh, PowerShell тут ни при чём:

   ```bash
   curl -sfL https://get.k3s.io | sh -s - --disable=traefik
   sudo k3s kubectl get nodes
   ```

   Дальше все команды — уже с локальной машины (PowerShell), через
   `kubectl`/`helm`, указывающие на этот кластер через `$env:KUBECONFIG`.
   Kubeconfig для GitHub Actions — тоже из `/etc/rancher/k3s/k3s.yaml`
   (см. "Настройка GitHub Actions" ниже, там `server:` переписывается на
   реальный адрес).

2. Поставить Traefik с ACME resolver `letsencrypt` (HTTP-01 challenge + TLS,
   сертификаты хранятся на PVC — `persistence.enabled: true` в
   `k3s/traefik-values.yaml` — переживают пересоздание пода). Статичные
   аргументы, включая email для Let's Encrypt, — в `k3s/traefik-values.yaml`.

   Требуется Helm CLI версии 3.9.0 или новее. Проверьте установленную версию:

   ```powershell
   helm version --short

   helm repo add traefik https://traefik.github.io/charts
   helm repo update

   helm install traefik traefik/traefik --values k3s/traefik-values.yaml

   kubectl get svc traefik -w   # дождаться EXTERNAL-IP == внешний IP ноды
   ```

   На firewall сервера должны быть открыты `80` и `443` (ACME HTTP-01
   челлендж и сам HTTPS-трафик), а также `6443` — для GitHub Actions и
   удалённого `kubectl` (см. "Настройка GitHub Actions" ниже).

Если хостер прописывает в `/etc/resolv.conf` ноды свой search-домен (как
описано в `k3s/coredns-custom.yaml`) — проверьте, актуальна ли эта проблема
на новом сервере, и примените `kubectl apply -f k3s/coredns-custom.yaml`
(поправив домен хостера), иначе поды могут не резолвить внешние адреса.

Дальше — обычные шаги деплоя приложений: 1) свой реестр, 2) образы, 3) namespace и секреты, 4) Hatchet, 5) манифесты.

## 1. Свой реестр (registry.yaml, zot)

Реестр — [zot](https://zotregistry.dev) внутри кластера: в отличие от
классического `registry:2` конфигурируется JSON-файлом (`registry-config`
ConfigMap), а не переменными окружения. Авторизация — htpasswd. Наружу
торчит доменом `registry.orixon.ru` через `IngressRoute` (Traefik CRD, см.
`k3s/registry.yaml`) с TLS через уже настроенный в кластере ACME
`certResolver: letsencrypt` — тот же, что используют остальные сервисы
(шаг "Домены" ниже). Отдельного cert-manager не нужно, docker/containerd
доверяют сертификату по умолчанию.

В `registry-config` в `accessControl` захардкожен пользователь `deploy` с
правами на чтение/запись (остальным — только чтение). Если нужен другой
логин, поменяйте имя в `k3s/registry.yaml` (`accessControl.repositories."**".policies[0].users`)
на своё.

1. Направить DNS A-запись `registry.orixon.ru` на IP сервера с k3s.

2. Создать namespace psi-opora (если ещё не создан):

   ```powershell
   kubectl apply -f k3s/namespace.yaml
   ```

3. Создать htpasswd-секрет с пользователем `deploy` (файл с паролем в git не
   попадает — секрет создаётся вручную, один раз). Утилиты `htpasswd` в
   Windows нет — используем образ `httpd` в Docker, хэш сразу уходит в
   Secret без временного файла на диске:

   ```powershell
   $HtpasswdLine = docker run --rm httpd:2.4-alpine htpasswd -Bbn deploy '<пароль>'
   kubectl create secret generic registry-htpasswd --from-literal=htpasswd="$HtpasswdLine" --namespace psi-opora
   ```

   На Linux/macOS с установленным `apache2-utils`/`httpd-tools` подойдёт и
   исходный вариант без Docker: `htpasswd -Bbn deploy '<пароль>' > /tmp/htpasswd`.

Тег `:latest` в манифестах — только для самого первого `kubectl apply`.
Дальнейшие деплои катит GitHub Actions через `kubectl set image` (см. ниже),
не трогая сами файлы — если применить манифест заново вручную, образ
откатится на `:latest`, после чего просто перезапустите workflow.

## 2. Собрать и загрузить образы (первый раз — вручную)

Перед первым `kubectl apply -f k3s/` реестр и сами приложения ещё не
задеплоены — собрать образы и запушить в свой реестр можно локально:

```powershell
$Registry = "registry.orixon.ru"
docker login $Registry -u deploy -p '<пароль>'
foreach ($app in "tg-bot","max-bot","tg-userbot-worker","hatchet-worker","bitrix-webhook","dashboard","clients") {
  docker build -t "$Registry/psi-opora-${app}:latest" -f "apps/$app/Dockerfile" .
  docker push "$Registry/psi-opora-${app}:latest"
}
```

Если реестр ещё не поднят (курица и яйцо: registry.yaml тоже применяется
через `kubectl apply -f k3s/`) — примените сначала `namespace.yaml` и
`registry.yaml`, дождитесь, пока под реестра станет Ready, и только потом
собирайте и пушьте остальные образы.

`waha` и `redis` используют публичные образы — k3s подтянет их сам.

## 3. Создать namespace и секрет с переменными окружения

```powershell
kubectl apply -f k3s/namespace.yaml
# Перед созданием секрета добавьте в .env:
# REDIS_PASSWORD=<случайный-длинный-пароль>
kubectl create secret generic psi-opora-env --from-env-file=.env --namespace psi-opora
```

### PostgreSQL 18.4

PostgreSQL хранит данные на PVC 20 Gi и доступен приложениям по адресу
`postgres:5432`. Для внешнего администрирования открыт `SERVER_IP:30432`;
внешние подключения без TLS отклоняются.

До первого `kubectl apply` создайте отдельный пароль и TLS-сертификат.
Сертификат должен содержать IP или DNS-имя сервера в `subjectAltName`.
Пароль генерируем средствами .NET (openssl не нужен), а для сертификата
`openssl` всё же нужен — Git for Windows ставит его, но не кладёт в PATH,
поэтому при отсутствии команды подхватываем его оттуда автоматически:

```powershell
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
  $env:PATH += ";C:\Program Files\Git\usr\bin"
}

$POSTGRES_USER = "psi_opora"
$POSTGRES_DB = "psi_opora"
$PasswordBytes = New-Object byte[] 36
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($PasswordBytes)
$POSTGRES_PASSWORD = [Convert]::ToBase64String($PasswordBytes)
$SERVER_IP = "178.212.14.126"

$KeyPath = Join-Path $env:TEMP "postgres-tls.key"
openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes `
  -keyout $KeyPath -out k3s/postgres-ca.crt `
  -subj "/CN=$SERVER_IP" `
  -addext "subjectAltName=IP:$SERVER_IP"

kubectl create secret generic postgres-tls -n psi-opora `
  --from-file=tls.crt=k3s/postgres-ca.crt `
  --from-file=tls.key=$KeyPath
Remove-Item $KeyPath

$EncodedPassword = [System.Uri]::EscapeDataString($POSTGRES_PASSWORD)
$InternalUrl = "postgresql://${POSTGRES_USER}:${EncodedPassword}@postgres:5432/${POSTGRES_DB}?sslmode=disable"
kubectl create secret generic postgres-credentials -n psi-opora `
  --from-literal=POSTGRES_USER="$POSTGRES_USER" `
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" `
  --from-literal=POSTGRES_DB="$POSTGRES_DB" `
  --from-literal=POSTGRES_URL="$InternalUrl"

kubectl apply -f k3s/postgres.yaml
kubectl rollout status statefulset/postgres -n psi-opora --timeout=180s
```

Публичный URL для клиента:

```text
postgresql://psi_opora:<URL_ENCODED_PASSWORD>@178.212.14.126:30432/psi_opora?sslmode=verify-full
```

Передавайте `k3s/postgres-ca.crt` клиенту как root certificate. Сам порт
лучше дополнительно ограничить в firewall списком доверенных IP.

### Одноразовый перенос из Neon

На короткое окно финального переноса остановите приложения, которые пишут
в БД. Исходный URL хранится только во временном Secret и после миграции
удаляется:

```powershell
kubectl scale deployment -n psi-opora `
  tg-bot max-bot tg-userbot-worker hatchet-worker bitrix-webhook dashboard clients `
  --replicas=0

$NEON_POSTGRES_URL = "<строка подключения к Neon>"
kubectl create secret generic neon-migration-source -n psi-opora `
  --from-literal=POSTGRES_URL="$NEON_POSTGRES_URL"
kubectl delete job neon-to-postgres -n psi-opora --ignore-not-found
kubectl apply -f k3s/migrations/neon-to-postgres-job.yaml
kubectl wait --for=condition=complete job/neon-to-postgres `
  -n psi-opora --timeout=10m
kubectl logs job/neon-to-postgres -n psi-opora
kubectl delete secret neon-migration-source -n psi-opora
```

После проверки замените `POSTGRES_URL` в `psi-opora-env` на значение
`POSTGRES_URL` из `postgres-credentials`, верните реплики приложений и
обновите одноимённый GitHub Actions Secret (для сборки dashboard/clients).
Neon не удаляйте до проверки таблиц, авторизации и работы всех ботов.

Все поды получают секретные переменные через `envFrom.secretRef` — секрет
общий, как `env_file: .env` в docker-compose. Адрес `redis:6379` приложения
получают из `redis-connection` ConfigMap. Сам Redis доступен только внутри
кластера через ClusterIP и требует `REDIS_PASSWORD`. NodePort, Ingress и
публичный DNS для Redis не создаются.

При обновлении `.env` примените секрет заново и перезапустите приложения.
Если менялся пароль Redis, также перезапустите StatefulSet:

```powershell
kubectl create secret generic psi-opora-env `
  --from-env-file=.env --namespace psi-opora `
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment -n psi-opora
kubectl rollout restart statefulset/redis -n psi-opora
```

## 4. Подключить Hatchet Cloud

Сейчас control plane работает в Hatchet Cloud, а `hatchet-worker` — внутри
k3s рядом с приложениями и их Redis. Создайте API token в Hatchet Cloud
(`Settings → API Tokens`) и добавьте его в общий `.env`:

```dotenv
HATCHET_CLIENT_TOKEN=eyJhbGciOi...
```

Затем обновите общий Secret. Дополнительные `HATCHET_CLIENT_HOST_PORT`,
`HATCHET_CLIENT_API_URL` и `HATCHET_CLIENT_TLS_STRATEGY` для Cloud не нужны:
адреса подключения содержатся в выданном токене.

```powershell
kubectl create secret generic psi-opora-env `
  --from-env-file=.env --namespace psi-opora `
  --dry-run=client -o yaml | kubectl apply -f -
```

### Self-hosted Hatchet в k3s (заготовка)

Конфигурация собственного control plane сохранена в
`k3s/hatchet/values.yaml`, но в текущем деплое она не применяется. Когда
решите уйти с Cloud, control plane можно поставить официальным Helm chart в
тот же namespace. Values используют отдельный PostgreSQL на PVC 10 Gi как
очередь сообщений и не поднимают RabbitMQ.

```powershell
helm repo add hatchet https://hatchet-dev.github.io/hatchet-charts
helm repo update

$HATCHET_ADMIN_EMAIL = "admin@example.com"
$HATCHET_ADMIN_PASSWORD = "<длинный-случайный-пароль>"

helm upgrade --install hatchet-stack hatchet/hatchet-stack `
  --version 0.11.0 `
  --namespace psi-opora `
  --values k3s/hatchet/values.yaml `
  --set-string sharedConfig.defaultAdminEmail="$HATCHET_ADMIN_EMAIL" `
  --set-string sharedConfig.defaultAdminPassword="$HATCHET_ADMIN_PASSWORD" `
  --wait --timeout=15m

kubectl get secret hatchet-client-config -n psi-opora
```

Chart сам выполняет миграции БД и создаёт `hatchet-client-config` с
`HATCHET_CLIENT_TOKEN`. При переключении на self-hosted нужно подключить этот
Secret к dashboard, clients и hatchet-worker и задать им внутренние адреса
`hatchet-stack-engine:7070`, `http://hatchet-stack-api:8080` и TLS strategy
`none` вместо облачного токена из `psi-opora-env`.

Для просмотра UI без публичного Ingress:

```powershell
kubectl port-forward -n psi-opora svc/hatchet-stack-frontend 8080:8080
# открыть http://localhost:8080
```

Версия chart закреплена намеренно: перед её обновлением проверьте release
notes и миграции на тестовом окружении.

## 5. Применить манифесты приложений

```powershell
# Применить манифесты напрямую (traefik-values.yaml — это Helm values, не k8s манифест,
# поэтому исключаем его из списка; hatchet/values.yaml и migrations/* применяются отдельно)
kubectl apply -f k3s/namespace.yaml
kubectl apply -f k3s/middleware.yaml
kubectl apply -f k3s/regcred.yaml
kubectl apply -f k3s/registry.yaml
kubectl apply -f k3s/redis.yaml
kubectl apply -f k3s/postgres.yaml
kubectl apply -f k3s/waha.yaml
kubectl apply -f k3s/tg-bot.yaml
kubectl apply -f k3s/max-bot.yaml
kubectl apply -f k3s/tg-userbot-worker.yaml
kubectl apply -f k3s/max-userbot-worker.yaml
kubectl apply -f k3s/hatchet-worker.yaml
kubectl apply -f k3s/bitrix-webhook.yaml
kubectl apply -f k3s/dashboard.yaml
kubectl apply -f k3s/clients.yaml
kubectl apply -f k3s/logging.yaml
kubectl rollout status statefulset/postgres -n psi-opora --timeout=180s
kubectl rollout status statefulset/redis -n psi-opora --timeout=120s
kubectl rollout status deployment/hatchet-worker -n psi-opora --timeout=180s
```

Redis 8.8.1 работает в одном экземпляре с AOF (`appendfsync everysec`) и
PVC `data-redis-0` на 2 Gi. Это сохраняет данные при пересоздании пода, но
не заменяет внешний backup PVC.

### Перенос данных и отключение облачного Redis

До переключения приложений экспортируйте облачную базу в RDB и восстановите
её в новый Redis. Для Upstash экспорт создаётся в `Backups → Backup & Export`;
официальная инструкция: <https://upstash.com/docs/redis/howto/importexport>.
На время финального экспорта остановите записи либо предусмотрите короткое
окно обслуживания, иначе изменения после снимка потеряются. Облачную базу
не удаляйте, пока не проверены OAuth-токены, активные сессии ботов и очереди.

Фоновые и периодические задачи выполняет `hatchet-worker` внутри k3s. Он
получает `REDIS_HOST=redis` из того же `redis-connection` ConfigMap, поэтому
доступ к Redis снаружи кластера ему не нужен. Очередь, состояние и история
запусков пока хранятся в Hatchet Cloud.

## Важно: tg-userbot-worker — только 1 реплика

`tg-userbot-worker` держит постоянное MTProto-соединение с одной и той же
сессией. Два одновременно работающих пода приведут к рвущимся сессиям.
Поэтому у него `replicas: 1` и `strategy: Recreate` — не увеличивайте реплики
и не меняйте стратегию на RollingUpdate.

`tg-bot` и `max-bot` работают через webhook (не long polling), поэтому этого
ограничения на них уже нет.

## Бесшовный rollout HTTP-сервисов

`bitrix-webhook`, `clients`, `dashboard`, `tg-bot`, `max-bot` — за `Service`,
принимают входящий HTTP-трафик, поэтому при `kubectl set image` (деплой через
GitHub Actions) новый под должен полностью подняться и начать отвечать
раньше, чем старый уйдёт, иначе часть запросов/вебхуков теряется на время
простоя. Это обеспечивают три вещи вместе, у каждого своя роль:

- `strategy.rollingUpdate: {maxSurge: 1, maxUnavailable: 0}` — новый под
  стартует рядом со старым, старый не убивается, пока новый не станет Ready.
- `readinessProbe` — под считается Ready (и попадает в `Service` endpoints)
  только когда реально отвечает на HTTP, а не сразу после старта процесса.
- `preStop` (`sleep 5`) + `terminationGracePeriodSeconds: 20` — при
  остановке старого пода даём Traefik/kube-proxy время убрать его из
  endpoints, прежде чем ему придёт `SIGTERM`; сами Hono-сервисы (tg-bot,
  max-bot, bitrix-webhook) по `SIGTERM` дожидаются завершения активных
  запросов (`server.close()` в `src/server.ts`), Next.js (`clients`,
  `dashboard`) делает это самостоятельно.

`registry` и `grafana` (в `logging.yaml`) — с `strategy: Recreate` (общий
диск `ReadWriteOnce`, два пода не могут монтировать его одновременно),
поэтому им добавлены только `readinessProbe`/`livenessProbe` — они не убирают
секундный простой при пересоздании пода, а лишь не пускают трафик в под,
который ещё не успел подняться.

`waha`, `tg-userbot-worker` — тоже `Recreate`, уже осознанно: держат по одному
живому MTProto/WhatsApp-соединению на аккаунт, поднять второй под рядом со
старым нельзя технически (см. раздел выше). Сообщения, пришедшие в короткое
окно простоя при их рестарте, не теряются — Telegram/WhatsApp хранят их на
своей стороне и доставляют после переподключения.

## Порты (NodePort)

| Сервис         | NodePort | Порт в контейнере |
| -------------- | -------- | ----------------- |
| clients        | 30005    | 3000              |
| dashboard      | 30010    | 3000              |
| bitrix-webhook | 30020    | 3000              |
| waha           | 30050    | 3000              |
| postgres (TLS) | 30432    | 5432              |

Grafana торчит через `IngressRoute` (см. "Домены" ниже), без NodePort.

`tg-userbot-worker` без Service — ему не нужен входящий трафик (MTProto
исходящий).

`registry` — без NodePort, доступен через `IngressRoute` (см. шаг 1 и
раздел "Домены" ниже).

## Домены (IngressRoute)

Наружу торчат через Traefik `IngressRoute` (не стандартный `networking.k8s.io/v1
Ingress` — CRD, специфичный для Traefik) с TLS через ACME `certResolver:
letsencrypt`, уже настроенный в кластере. Для каждого домена — пара
IngressRoute: на `web` (порт 80) с редиректом на https через общий
`Middleware` `redirect-to-https` (`k3s/middleware.yaml`), и на `websecure`
(порт 443) с `tls.certResolver: letsencrypt`.

| Сервис         | Домен                              |
| -------------- | ---------------------------------- |
| registry       | registry.orixon.ru                 |
| clients        | psi-opora-clients.orixon.ru        |
| dashboard      | psi-opora-dashboard.orixon.ru      |
| bitrix-webhook | psi-opora-bitrix-webhook.orixon.ru |
| tg-bot         | psi-opora-tg.orixon.ru             |
| max-bot        | psi-opora-max.orixon.ru            |
| grafana        | psi-opora-grafana.orixon.ru        |

Для каждого — направить DNS A-запись на IP сервера с k3s.

## Логи (Grafana + Loki + Promtail)

`k3s/logging.yaml` — стек сбора логов со всех подов namespace `psi-opora`:

- **Promtail** — DaemonSet, читает логи подов с диска каждой ноды
  (`/var/log/pods`, `/var/log/containers`) и шлёт в Loki. Собирает только
  namespace `psi-opora` (см. `regex: psi-opora` в `promtail-config`
  ConfigMap) — чтобы расширить на весь кластер, уберите этот `relabel_config`.
- **Loki** — хранилище логов, локальный PVC (`loki-data`, 10Gi), retention
  30 дней (`limits_config.retention_period` в `loki-config` ConfigMap).
- **Grafana** — просмотр: датасорс Loki подключается автоматически через
  `grafana-datasources` ConfigMap. Логи ищите в Explore по лейблам `app`,
  `pod`, `container`, `namespace`, например: `{app="dashboard"} |= "error"`.
- **Дашборд "psi-opora — Ошибки и логи"** — заводится автоматически через
  провижининг (`grafana-dashboards-provider` + `grafana-dashboard-errors`
  ConfigMap'ы, папка `psi-opora` в Grafana), импортировать вручную не нужно.
  Содержит: панель "Все логи" (весь поток логов без фильтра — для общего
  наблюдения и отладки), график ошибок/мин по сервисам, по одному счётчику
  ошибок за выбранный период на каждый из 6 сервисов и отдельную панель
  логов с ошибками (фильтр по regex `(?i)error|exception|fatal|panic`).
  Все панели с логами сужаются через переменную `service` вверху дашборда.
  Чтобы поменять паттерн ошибок или
  добавить панели — правьте JSON прямо в `grafana-dashboard-errors` в
  `k3s/logging.yaml` и переприменяйте (провижининг подхватывает изменения
  раз в 30 секунд без рестарта пода).

Перед первым `kubectl apply` нужно завести пароль администратора Grafana
(в git не попадает, аналогично `registry-htpasswd`):

```powershell
kubectl create secret generic grafana-admin `
  --from-literal=password='<пароль>' --namespace psi-opora
```

## Проверка

```powershell
kubectl get pods -n psi-opora
kubectl logs -n psi-opora deploy/tg-bot -f
```

## Настройка GitHub Actions (deploy-k3s.yml)

Workflow [.github/workflows/deploy-k3s.yml](../.github/workflows/deploy-k3s.yml)
на пуш в `main` (или вручную, `workflow_dispatch`, с выбором конкретного
сервиса) собирает образ, пушит в свой реестр и обновляет запущенный Deployment
через `kubectl set image` + `kubectl rollout status`. Раннер — обычный
`ubuntu-latest`, подключается к API k3s напрямую по сети.

**ВАЖНО: Не используйте `/etc/rancher/k3s/k3s.yaml` и админский KUBECONFIG
напрямую.** Вместо этого создайте отдельный ServiceAccount с минимальными
RBAC-правами (deploy, get, list pods/deployments в namespace psi-opora).
Доступ к API на порту 6443 ограничьте через VPN, SSH-туннель или используйте
self-hosted runner.

В репозитории (Settings → Secrets and variables → Actions) нужно завести:

**Variables:**

- `REGISTRY` — `registry.orixon.ru`, тот же адрес, что и в манифестах.

**Secrets:**

- `REGISTRY_USER`, `REGISTRY_PASSWORD` — логин/пароль из шага 1 выше (htpasswd).
- `KUBECONFIG` — содержимое `/etc/rancher/k3s/k3s.yaml` в base64, с полем
  `server:` переписанным на реальный адрес сервера (по умолчанию там
  `https://127.0.0.1:6443`, что снаружи не резолвится). Скопируйте файл на
  локальную машину и правьте/кодируйте уже в PowerShell:

  ```powershell
  scp root@<IP сервера>:/etc/rancher/k3s/k3s.yaml k3s\k3s.yml
  (Get-Content k3s\k3s.yml) -replace '127\.0\.0\.1', '<реальный адрес сервера>' |
    Set-Content k3s\k3s.yml

  [Convert]::ToBase64String([IO.File]::ReadAllBytes('k3s\k3s.yml'))
  ```

  Если `k3s/k3s.yml` в репозитории уже содержит нужный `server:` (как сейчас
  для текущего кластера) — первые две команды не нужны, сразу берите
  последнюю строку.

  Вывод команды целиком — значение секрета `KUBECONFIG`.

После первого успешного прогона workflow образы в манифестах на диске
(`:latest`) и реально запущенные в кластере (тег — git SHA коммита) начнут
расходиться — это ожидаемо, см. предупреждение в шаге 0.
