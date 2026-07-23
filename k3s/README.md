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
ConfigMap), а не переменными окружения. Авторизация — htpasswd, без TLS
(сертификат для голого IP/тестового сервера — лишняя возня). Из-за отсутствия
TLS его нужно явно разрешить как insecure и докер-демону раннера GitHub
Actions, и containerd на самой ноде k3s.

В `registry-config` в `accessControl` захардкожен пользователь `deploy` с
правами на чтение/запись (остальным — только чтение). Если нужен другой
логин, поменяйте имя в `k3s/registry.yaml` (`accessControl.repositories."**".policies[0].users`)
на своё.

1. Создать htpasswd-секрет с пользователем `deploy` (файл с паролем в git не
   попадает — секрет создаётся вручную, один раз):

   ```bash
   htpasswd -Bbn deploy '<пароль>' > /tmp/htpasswd
   kubectl create secret generic registry-htpasswd \
     --from-file=htpasswd=/tmp/htpasswd \
     --namespace psi-opora
   rm /tmp/htpasswd
   ```

2. Разрешить containerd на ноде k3s ходить в этот реестр по http без
   проверки сертификата — создать `/etc/rancher/k3s/registries.yaml`
   (замените `REGISTRY_HOST` на реальный адрес сервера — IP или домен):

   ```yaml
   mirrors:
     "REGISTRY_HOST:30500":
       endpoint:
         - "http://REGISTRY_HOST:30500"
   configs:
     "REGISTRY_HOST:30500":
       auth:
         username: deploy
         password: <пароль>
       tls:
         insecure_skip_verify: true
   ```

   и перечитать конфиг: `sudo systemctl restart k3s`.

3. Заменить плейсхолдер `REGISTRY_HOST` в манифестах на тот же адрес:

   ```bash
   sed -i 's/REGISTRY_HOST/<реальный адрес сервера>/' k3s/*.yaml
   ```

Тег `:latest` в манифестах — только для самого первого `kubectl apply`.
Дальнейшие деплои катит GitHub Actions через `kubectl set image` (см. ниже),
не трогая сами файлы — если применить манифест заново вручную, образ
откатится на `:latest`, после чего просто перезапустите workflow.

## 1. Собрать и загрузить образы (первый раз — вручную)

Перед первым `kubectl apply -f k3s/` реестр и сами приложения ещё не
задеплоены — собрать образы и запушить в свой реестр можно локально:

```bash
REGISTRY=<реальный адрес сервера>:30500
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
kubectl create secret generic psi-opora-env \
  --from-env-file=.env \
  --namespace psi-opora
```

Все поды получают переменные через `envFrom.secretRef` — секрет общий,
как `env_file: .env` в docker-compose. При обновлении `.env` секрет нужно
пересоздать (`kubectl delete secret ... && kubectl create secret ...`) и
перезапустить поды (`kubectl rollout restart deployment -n psi-opora`).

## 3. Применить манифесты

```bash
kubectl apply -f k3s/
```

## Важно: боты — только 1 реплика

`tg-bot`, `max-bot` и `tg-userbot-worker` держат long polling / постоянное
MTProto-соединение с одним и тем же токеном/сессией. Два одновременно
работающих пода приведут к конфликту (Telegram API отдаёт ошибку конфликта
polling, WAHA/mtcute — рвущиеся сессии). Поэтому у них `replicas: 1` и
`strategy: Recreate` — не увеличивайте реплики и не меняйте стратегию на
RollingUpdate.

## Порты (NodePort)

| Сервис          | NodePort | Порт в контейнере |
| ---------------- | -------- | ------------------ |
| clients          | 30005    | 3000                |
| dashboard        | 30010    | 3000                |
| bitrix-webhook   | 30020    | 3000                |
| waha             | 30050    | 3000                |
| minio (API)      | 30900    | 9000                |
| minio (консоль)  | 30901    | 9001                |
| registry         | 30500    | 5000                |

`tg-bot`, `max-bot`, `tg-userbot-worker` без Service — им не нужен входящий
трафик (long polling исходящий).

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
- `REGISTRY` — адрес реестра, тот же `REGISTRY_HOST:30500`, что и в манифестах.

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
