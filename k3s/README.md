# Деплой в k3s

Манифесты — по одному файлу на сервис (Deployment + Service, где сервису нужен
входящий трафик). `waha.yaml` и `minio.yaml` дополнительно содержат
PersistentVolumeClaim (сессии WhatsApp / файлы MinIO) — без него данные
пропадут при пересоздании пода.

Образы для tg-bot/max-bot/tg-userbot-worker/bitrix-webhook/dashboard/clients
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
for app in tg-bot max-bot tg-userbot-worker bitrix-webhook dashboard clients; do
  docker build -t "$REGISTRY/psi-opora-$app:latest" -f "apps/$app/Dockerfile" .
  docker push "$REGISTRY/psi-opora-$app:latest"
done
```

Если реестр ещё не поднят (курица и яйцо: registry.yaml тоже применяется
через `kubectl apply -f k3s/`) — примените сначала `namespace.yaml` и
`registry.yaml`, дождитесь, пока под реестра станет Ready, и только потом
собирайте и пушьте остальные образы.

`waha` и `minio` используют публичные образы — k3s подтянет их сам.

## 2. Создать namespace и секрет с переменными окружения

```bash
kubectl apply -f k3s/namespace.yaml
kubectl create secret generic psi-opora-env --from-env-file=.env --namespace psi-opora
```

Все поды получают переменные через `envFrom.secretRef` — секрет общий,
как `env_file: .env` в docker-compose. При обновлении `.env` секрет нужно
пересоздать (`kubectl delete secret ... && kubectl create secret ...`) и
перезапустить поды (`kubectl rollout restart deployment -n psi-opora`).

## 3. Применить манифесты

```bash
kubectl apply -f k3s/
```

## Важно: tg-userbot-worker — только 1 реплика

`tg-userbot-worker` держит постоянное MTProto-соединение с одной и той же
сессией. Два одновременно работающих пода приведут к рвущимся сессиям.
Поэтому у него `replicas: 1` и `strategy: Recreate` — не увеличивайте реплики
и не меняйте стратегию на RollingUpdate.

`tg-bot` и `max-bot` работают через webhook (не long polling), поэтому этого
ограничения на них уже нет.

## Порты (NodePort)

| Сервис          | NodePort | Порт в контейнере |
| --------------- | -------- | ----------------- |
| clients         | 30005    | 3000              |
| dashboard       | 30010    | 3000              |
| bitrix-webhook  | 30020    | 3000              |
| waha            | 30050    | 3000              |
| minio (API)     | 30900    | 9000              |
| minio (консоль) | 30901    | 9001              |

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
