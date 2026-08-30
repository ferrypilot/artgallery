# scripts/push.ps1
#
# 커밋하고 GitHub 에 올립니다. 올리기 전에 비밀값이 섞였는지 검사하고,
# 하나라도 걸리면 밀지 않고 멈춥니다.
#
#   npm run push -- -m "무엇을 고쳤는지"    커밋하고 올리기
#   npm run push                            이미 커밋했다면 올리기만
#   npm run push -- -Check                  검사만. 올리지 않음
#
# 이 검사가 있는 이유: 같은 폴더에 .env.local 이 있고 그 안에 실제 xAI 키가
# 들어 있습니다. .gitignore 가 막고 있지만, 파일 이름이 바뀌거나 누가 키를
# 다른 파일에 붙여넣는 순간 그 방어는 사라집니다. 한 번 올라간 키는
# 지워도 이력에 남으므로, 막을 곳은 여기입니다.

[CmdletBinding()]
param(
  [Alias("m")][string]$Message,
  [switch]$Check
)

# git 은 진행 상황을 stderr 로 씁니다. Stop 이면 그게 오류로 둔갑합니다.
# 성공 여부는 $LASTEXITCODE 로 명시적으로 봅니다.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location (Split-Path $PSScriptRoot -Parent)

function Fail($msg) { Write-Host ""; Write-Host "중단: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "  OK   $msg" -ForegroundColor DarkGray }

# ── 1. 커밋 ────────────────────────────────────────────────
$dirty = git status --porcelain
if ($dirty) {
  if (-not $Message) {
    Write-Host "커밋하지 않은 변경이 있습니다:" -ForegroundColor Yellow
    git status --short
    Fail ' -m "메시지" 로 커밋 내용을 적어주세요.'
  }
  git add -A
  git commit -q -m $Message
  Write-Host "커밋했습니다: $Message"
}

# ── 2. 비밀값 검사 ─────────────────────────────────────────
# 자리표시자(xai-... / eyJ...)는 걸리지 않도록 실제 값 길이를 요구합니다.
Write-Host ""
Write-Host "비밀값 검사"

$patterns = @{
  "xAI API 키"          = "xai-[A-Za-z0-9]{20,}"
  "Supabase 공개 키"     = "sb_publishable_[A-Za-z0-9_-]{10,}"
  "Supabase 비밀 키"     = "sb_secret_[A-Za-z0-9_-]{10,}"
  "JWT 형태의 키"        = "eyJ[A-Za-z0-9_-]{30,}"
  # 낱말 자체는 위험하지 않습니다. 주석에도 흔히 나옵니다.
  # 위험한 것은 값이 대입된 경우입니다. 실제 키 값은 JWT / sb_secret_
  # 패턴이 이미 잡습니다. 리터럴은 쪼갭니다 — 안 그러면 이 파일이 걸립니다.
  "서비스 롤 키 대입"     = ("SERVICE" + "_ROLE_KEY\s*=\s*\S")
}

$found = $false
foreach ($name in $patterns.Keys) {
  $hits = git grep -n -I -E -e $patterns[$name] HEAD 2>$null
  if ($hits) {
    $found = $true
    Write-Host "  발견  $name" -ForegroundColor Red
    $hits | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
  } else { Ok $name }
}
if ($found) { Fail "위 값이 커밋에 들어 있습니다. 지우고 다시 커밋하세요." }

# .env.local 이 추적되고 있으면 즉시 중단
# --error-unmatch 는 없을 때 stderr 를 냅니다. 목록이 비었는지만 보면 됩니다.
if (git ls-files ".env.local") { Fail ".env.local 이 git 에 추적되고 있습니다. git rm --cached .env.local" }
Ok ".env.local 은 추적되지 않음"

# ── 3. 올릴 내용 ───────────────────────────────────────────
$branch = git rev-parse --abbrev-ref HEAD
git fetch -q origin $branch 2>$null

Write-Host ""
$ahead = git log --oneline "origin/$branch..HEAD" 2>$null
if (-not $ahead) { Write-Host "올릴 커밋이 없습니다. 이미 최신입니다."; exit 0 }

Write-Host "올라갈 커밋 ($branch):"
$ahead | ForEach-Object { Write-Host "  $_" }

if ($Check) { Write-Host ""; Write-Host "검사만 했습니다. 올리지 않았습니다." -ForegroundColor Yellow; exit 0 }

# ── 4. 푸시 ────────────────────────────────────────────────
Write-Host ""
git push -u origin $branch
if ($LASTEXITCODE -ne 0) { Fail "푸시에 실패했습니다. 위 메시지를 보세요." }

Write-Host ""
Write-Host "올렸습니다 → https://github.com/ferrypilot/artgallery" -ForegroundColor Green
