# Деплой в k3s

Манифесты — по одному файлу на сервис (Deployment + Service, где сервису нужен
входящий трафик). `waha.yaml`, `minio.yaml`, `redis.yaml` и `postgres.yaml`
дополнительно содержат постоянные тома (сессии WhatsApp / файлы MinIO /
данные Redis / PostgreSQL) —
без них данные пропадут при пересоздании пода.

Образы для tg-bot/max-bot/tg-userbot-worker/hatchet-worker/bitrix-webhook/dashboard/clients
собираются и катятся в кластер через GitHub Actions ([.github/workflows/deploy-k3s.yml](../.github/workflows/deploy-k3s.yml)),
в свой реестр (`registry.yaml`), поднятый в этом же кластере. Разделы ниже —
разовая настройка перед первым деплоем.

## 0. Свой реестр (registry.yaml, zot)

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

2. Создать htpasswd-секрет с пользователем `deploy` (файл с паролем в git не
   попадает — секрет создаётся вручную, один раз):

   ```bash
   htpasswd -Bbn deploy '<пароль>' > /tmp/htpasswd
   kubectl create secret generic registry-htpasswd --from-file=htpasswd=/tmp/htpasswd --namespace psi-opora
   rm /tmp/htpasswd
   ```

Тег `:latest` в манифестах — только для самого первого `kubectl apply`.
Дальнейшие деплои катит GitHub Actions через `kubectl set image` (см. ниже),
не трогая сами файлы — если применить манифест заново вручную, образ
откатится на `:latest`, после чего просто перезапустите workflow.

## 1. Собрать и загрузить образы (первый раз — вручную)

Перед первым `kubectl apply -f k3s/` реестр и сами приложения ещё не
задеплоены — собрать образы и запушить в свой реестр можно локально:

```bash
REGISTRY=registry.orixon.ru
docker login "$REGISTRY" -u deploy -p '<пароль>'
for app in tg-bot max-bot tg-userbot-worker hatchet-worker bitrix-webhook dashboard clients; do
  docker build -t "$REGISTRY/psi-opora-$app:latest" -f "apps/$app/Dockerfile" .
  docker push "$REGISTRY/psi-opora-$app:latest"
done
```

Если реестр ещё не поднят (курица и яйцо: registry.yaml тоже применяется
через `kubectl apply -f k3s/`) — примените сначала `namespace.yaml` и
`registry.yaml`, дождитесь, пока под реестра станет Ready, и только потом
собирайте и пушьте остальные образы.

`waha`, `minio` и `redis` используют публичные образы — k3s подтянет их сам.

## 2. Создать namespace и секрет с переменными окружения

```bash
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
Сертификат должен содержать IP или DNS-имя сервера в `subjectAltName`:

```bash
export POSTGRES_USER=psi_opora
export POSTGRES_DB=psi_opora
export POSTGRES_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"
export SERVER_IP=38.49.213.197

openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
  -keyout /tmp/postgres-tls.key -out k3s/postgres-ca.crt \
  -subj "/CN=$SERVER_IP" \
  -addext "subjectAltName=IP:$SERVER_IP"

kubectl create secret generic postgres-tls -n psi-opora \
  --from-file=tls.crt=k3s/postgres-ca.crt \
  --from-file=tls.key=/tmp/postgres-tls.key
rm /tmp/postgres-tls.key

ENCODED_PASSWORD="$(printf '%s' "$POSTGRES_PASSWORD" | jq -sRr @uri)"
INTERNAL_URL="postgresql://$POSTGRES_USER:$ENCODED_PASSWORD@postgres:5432/$POSTGRES_DB?sslmode=disable"
kubectl create secret generic postgres-credentials -n psi-opora \
  --from-literal=POSTGRES_USER="$POSTGRES_USER" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=POSTGRES_DB="$POSTGRES_DB" \
  --from-literal=POSTGRES_URL="$INTERNAL_URL"

kubectl apply -f k3s/postgres.yaml
kubectl rollout status statefulset/postgres -n psi-opora --timeout=180s
```

Публичный URL для клиента:

```text
postgresql://psi_opora:<URL_ENCODED_PASSWORD>@38.49.213.197:30432/psi_opora?sslmode=verify-full
```

Передавайте `k3s/postgres-ca.crt` клиенту как root certificate. Сам порт
лучше дополнительно ограничить в firewall списком доверенных IP.

### Одноразовый перенос из Neon

На короткое окно финального переноса остановите приложения, которые пишут
в БД. Исходный URL хранится только во временном Secret и после миграции
удаляется:

```bash
kubectl scale deployment -n psi-opora \
  tg-bot max-bot tg-userbot-worker hatchet-worker bitrix-webhook dashboard clients \
  --replicas=0

kubectl create secret generic neon-migration-source -n psi-opora \
  --from-literal=POSTGRES_URL="$NEON_POSTGRES_URL"
kubectl delete job neon-to-postgres -n psi-opora --ignore-not-found
kubectl apply -f k3s/migrations/neon-to-postgres-job.yaml
kubectl wait --for=condition=complete job/neon-to-postgres \
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

```bash
kubectl create secret generic psi-opora-env \
  --from-env-file=.env --namespace psi-opora \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment -n psi-opora
kubectl rollout restart statefulset/redis -n psi-opora
```

## 3. Подключить Hatchet Cloud

Сейчас control plane работает в Hatchet Cloud, а `hatchet-worker` — внутри
k3s рядом с приложениями и их Redis/MinIO. Создайте API token в Hatchet Cloud
(`Settings → API Tokens`) и добавьте его в общий `.env`:

```dotenv
HATCHET_CLIENT_TOKEN=eyJhbGciOi...
```

Затем обновите общий Secret. Дополнительные `HATCHET_CLIENT_HOST_PORT`,
`HATCHET_CLIENT_API_URL` и `HATCHET_CLIENT_TLS_STRATEGY` для Cloud не нужны:
адреса подключения содержатся в выданном токене.

```bash
kubectl create secret generic psi-opora-env \
  --from-env-file=.env --namespace psi-opora \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Self-hosted Hatchet в k3s (заготовка)

Конфигурация собственного control plane сохранена в
`k3s/hatchet/values.yaml`, но в текущем деплое она не применяется. Когда
решите уйти с Cloud, control plane можно поставить официальным Helm chart в
тот же namespace. Values используют отдельный PostgreSQL на PVC 10 Gi как
очередь сообщений и не поднимают RabbitMQ.

```bash
helm repo add hatchet https://hatchet-dev.github.io/hatchet-charts
helm repo update

export HATCHET_ADMIN_EMAIL=admin@example.com
export HATCHET_ADMIN_PASSWORD='<длинный-случайный-пароль>'

helm upgrade --install hatchet-stack hatchet/hatchet-stack \
  --version 0.11.0 \
  --namespace psi-opora \
  --values k3s/hatchet/values.yaml \
  --set-string sharedConfig.defaultAdminEmail="$HATCHET_ADMIN_EMAIL" \
  --set-string sharedConfig.defaultAdminPassword="$HATCHET_ADMIN_PASSWORD" \
  --wait --timeout=15m

kubectl get secret hatchet-client-config -n psi-opora
```

Chart сам выполняет миграции БД и создаёт `hatchet-client-config` с
`HATCHET_CLIENT_TOKEN`. При переключении на self-hosted нужно подключить этот
Secret к dashboard, clients и hatchet-worker и задать им внутренние адреса
`hatchet-stack-engine:7070`, `http://hatchet-stack-api:8080` и TLS strategy
`none` вместо облачного токена из `psi-opora-env`.

Для просмотра UI без публичного Ingress:

```bash
kubectl port-forward -n psi-opora svc/hatchet-stack-frontend 8080:8080
# открыть http://localhost:8080
```

Версия chart закреплена намеренно: перед её обновлением проверьте release
notes и миграции на тестовом окружении.

## 4. Применить манифесты приложений

```bash
kubectl apply -f k3s/
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
официальная инструкция: https://upstash.com/docs/redis/howto/importexport.
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

`minio`, `waha`, `tg-userbot-worker` — тоже `Recreate`, уже осознанно:
`minio` — тот же RWO-диск; `waha` и `tg-userbot-worker` держат по одному
живому MTProto/WhatsApp-соединению на аккаунт, поднять второй под рядом со
старым нельзя технически (см. раздел выше). Сообщения, пришедшие в короткое
окно простоя при их рестарте, не теряются — Telegram/WhatsApp хранят их на
своей стороне и доставляют после переподключения.

## Порты (NodePort)

| Сервис          | NodePort | Порт в контейнере |
| --------------- | -------- | ----------------- |
| clients         | 30005    | 3000              |
| dashboard       | 30010    | 3000              |
| bitrix-webhook  | 30020    | 3000              |
| waha            | 30050    | 3000              |
| minio (API)     | 30900    | 9000              |
| minio (консоль) | 30901    | 9001              |
| postgres (TLS)  | 30432    | 5432              |

Grafana торчит через `IngressRoute` (см. "Домены" ниже), без NodePort.

`tg-userbot-worker` без Service — ему не нужен входящий трафик (MTProto
исходящий).

`registry` — без NodePort, доступен через `IngressRoute` (см. шаг 0 и
раздел "Домены" ниже).

## Домены (IngressRoute)

Наружу торчат через Traefik `IngressRoute` (не стандартный `networking.k8s.io/v1
Ingress` — CRD, специфичный для Traefik) с TLS через ACME `certResolver:
letsencrypt`, уже настроенный в кластере. Для каждого домена — пара
IngressRoute: на `web` (порт 80) с редиректом на https через общий
`Middleware` `redirect-to-https` (`k3s/middleware.yaml`), и на `websecure`
(порт 443) с `tls.certResolver: letsencrypt`.

| Сервис          | Домен                               |
| --------------- | ------------------------------------ |
| registry        | registry.orixon.ru                   |
| clients         | psi-opora-clients.orixon.ru          |
| dashboard       | psi-opora-dashboard.orixon.ru        |
| bitrix-webhook  | psi-opora-bitrix-webhook.orixon.ru   |
| tg-bot          | psi-opora-tg.orixon.ru               |
| max-bot         | psi-opora-max.orixon.ru              |
| grafana         | psi-opora-grafana.orixon.ru          |

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

```bash
kubectl create secret generic grafana-admin \
  --from-literal=password='<пароль>' --namespace psi-opora
```

## Проверка

```bash
kubectl get pods -n psi-opora
kubectl logs -n psi-opora deploy/tg-bot -f
```

## Настройка GitHub Actions (deploy-k3s.yml)

Workflow [.github/workflows/deploy-k3s.yml](../.github/workflows/deploy-k3s.yml)
на пуш в `main` (или вручную, `workflow_dispatch`, с выбором конкретного
сервиса) собирает образ, пушит в свой реестр и обновляет запущенный Deployment
через `kubectl set image` + `kubectl rollout status`. Раннер — обычный
`ubuntu-latest`, подключается к API k3s напрямую по сети, поэтому порт `6443`
на сервере должен быть доступен снаружи (тот же принцип, что и для NodePort
сервисов выше — открывать порт наружу здесь неизбежно, т.к. self-hosted
раннер или SSH-доступ не используются).

В репозитории (Settings → Secrets and variables → Actions) нужно завести:

**Variables:**

- `REGISTRY` — `registry.orixon.ru`, тот же адрес, что и в манифестах.

**Secrets:**

- `REGISTRY_USER`, `REGISTRY_PASSWORD` — логин/пароль из шага 0 выше (htpasswd).
- `KUBECONFIG` — содержимое `/etc/rancher/k3s/k3s.yaml` в base64, с полем
  `server:` переписанным на реальный адрес сервера (по умолчанию там
  `https://127.0.0.1:6443`, что снаружи не резолвится):

  ```bash
  sudo sed 's/127.0.0.1/<реальный адрес сервера>/' /etc/rancher/k3s/k3s.yaml \
    | base64 -w0
  ```

  Вывод команды целиком — значение секрета `KUBECONFIG`.

После первого успешного прогона workflow образы в манифестах на диске
(`:latest`) и реально запущенные в кластере (тег — git SHA коммита) начнут
расходиться — это ожидаемо, см. предупреждение в шаге 0.
