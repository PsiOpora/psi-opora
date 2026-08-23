<#
.SYNOPSIS
  Переносит базу psi_opora со старого k3s-кластера на новый через pg_dump/pg_restore.

.DESCRIPTION
  pg_dump/pg_restore выполняются через `kubectl exec` прямо внутри пода postgres-0
  каждого кластера — по Unix-сокету это "local"-соединение (pg_hba.conf: trust),
  поэтому пароль не нужен, только доступ к обоим kubeconfig. Дамп временно
  сохраняется на локальной машине между шагами dump/restore.

.PARAMETER SourceKubeconfig
  Kubeconfig старого сервера (сейчас — k3s/k3s.yml, prochub.mott.ai).

.PARAMETER TargetKubeconfig
  Kubeconfig нового сервера (178.212.14.126).

.PARAMETER Namespace
  Namespace на обоих кластерах.

.PARAMETER ScaleDownApps
  Deployment'ы на старом сервере, которые пишут в БД — их скейлят в 0 на время
  финального дампа, чтобы перенести консистентный снимок.

.PARAMETER SkipScaleDown
  Не трогать приложения на старом сервере (для тестового прогона на копии).

.EXAMPLE
  .\migrate-postgres-to-new-server.ps1 -SourceKubeconfig k3s\k3s.yml -TargetKubeconfig k3s\k3s-new.yml
#>
param(
    [Parameter(Mandatory)] [string]$SourceKubeconfig,
    [Parameter(Mandatory)] [string]$TargetKubeconfig,
    [string]$Namespace = "psi-opora",
    [string[]]$ScaleDownApps = @(
        "tg-bot", "max-bot", "tg-userbot-worker", "max-userbot-worker",
        "hatchet-worker", "bitrix-webhook", "dashboard", "clients"
    ),
    [switch]$SkipScaleDown
)

$ErrorActionPreference = "Stop"

function Invoke-PgExec($Kubeconfig, $Command) {
    kubectl --kubeconfig $Kubeconfig exec postgres-0 -n $Namespace -- bash -c $Command
}

Write-Host "== 1. Проверяю оба кластера ==" -ForegroundColor Cyan
kubectl --kubeconfig $SourceKubeconfig get pod postgres-0 -n $Namespace | Out-Null
kubectl --kubeconfig $TargetKubeconfig get pod postgres-0 -n $Namespace | Out-Null

if (-not $SkipScaleDown) {
    Write-Host "== 2. Останавливаю приложения на старом сервере (окно простоя) ==" -ForegroundColor Cyan
    kubectl --kubeconfig $SourceKubeconfig scale deployment -n $Namespace $ScaleDownApps --replicas=0
    kubectl --kubeconfig $SourceKubeconfig wait --for=delete pod `
        -l "app in ($($ScaleDownApps -join ','))" -n $Namespace --timeout=120s 2>$null
}

Write-Host "== 3. pg_dump на старом сервере ==" -ForegroundColor Cyan
$DumpPath = Join-Path $env:TEMP "psi_opora-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
Invoke-PgExec $SourceKubeconfig 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges' `
    > $DumpPath

if ((Get-Item $DumpPath).Length -eq 0) {
    throw "Дамп пустой — проверьте под/переменные окружения, не переносите пустую базу поверх целевой."
}
Write-Host "Дамп сохранён: $DumpPath ($('{0:N1}' -f ((Get-Item $DumpPath).Length / 1MB)) MB)"

Write-Host "== 4. Копирую дамп в под нового сервера и восстанавливаю ==" -ForegroundColor Cyan
kubectl --kubeconfig $TargetKubeconfig cp $DumpPath "${Namespace}/postgres-0:/tmp/restore.dump"
Invoke-PgExec $TargetKubeconfig 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges /tmp/restore.dump'
Invoke-PgExec $TargetKubeconfig 'rm -f /tmp/restore.dump'

Write-Host "== 5. Сверяю число таблиц ==" -ForegroundColor Cyan
$CountCmd = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.tables where table_schema=''public''"'
$SrcTables = Invoke-PgExec $SourceKubeconfig $CountCmd
$DstTables = Invoke-PgExec $TargetKubeconfig $CountCmd
Write-Host "Таблиц: старый сервер = $SrcTables, новый сервер = $DstTables"

if ($SrcTables -ne $DstTables) {
    Write-Warning "Количество таблиц не совпадает — проверьте вывод pg_restore выше, прежде чем переключать приложения."
} else {
    Write-Host "Совпадает." -ForegroundColor Green
}

Write-Host "`nГотово. Дамп остался в $DumpPath — удалите вручную после проверки."
if (-not $SkipScaleDown) {
    Write-Host "Приложения на старом сервере остановлены (replicas=0)."
    Write-Host "Дальше: обновите POSTGRES_URL в psi-opora-env на новом сервере (см. README.md, PostgreSQL) и поднимите приложения уже там."
}
