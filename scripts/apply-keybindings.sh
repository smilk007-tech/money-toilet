#!/usr/bin/env bash
# 프로젝트 단축키 설정을 Cursor / VSCode 에 적용하는 스크립트
# 사용법: bash scripts/apply-keybindings.sh [--vscode]
#   기본값: Cursor 에 적용
#   --vscode 옵션: VSCode 에 적용

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE="$PROJECT_DIR/.vscode/keybindings.json"

# OS별 설정 경로
case "$(uname -s)" in
  Darwin)
    CURSOR_DIR="$HOME/Library/Application Support/Cursor/User"
    VSCODE_DIR="$HOME/Library/Application Support/Code/User"
    ;;
  Linux)
    CURSOR_DIR="$HOME/.config/Cursor/User"
    VSCODE_DIR="$HOME/.config/Code/User"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    CURSOR_DIR="$APPDATA/Cursor/User"
    VSCODE_DIR="$APPDATA/Code/User"
    ;;
  *)
    echo "❌ 지원하지 않는 운영체제입니다."
    exit 1
    ;;
esac

# 대상 결정
if [[ "$1" == "--vscode" ]]; then
  TARGET_DIR="$VSCODE_DIR"
  EDITOR_NAME="VSCode"
else
  TARGET_DIR="$CURSOR_DIR"
  EDITOR_NAME="Cursor"
fi

TARGET="$TARGET_DIR/keybindings.json"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "❌ $EDITOR_NAME 설정 디렉토리를 찾을 수 없습니다: $TARGET_DIR"
  echo "   $EDITOR_NAME 가 설치되어 있는지 확인하세요."
  exit 1
fi

# 기존 파일 백업
if [[ -f "$TARGET" ]]; then
  BACKUP="$TARGET.backup.$(date +%Y%m%d_%H%M%S)"
  cp "$TARGET" "$BACKUP"
  echo "📦 기존 keybindings.json 백업 완료: $BACKUP"
fi

# 주석을 제거하고 순수 JSON 만 추출 (node.js 사용)
if command -v node &>/dev/null; then
  node -e "
    const fs = require('fs');
    const content = fs.readFileSync('$SOURCE', 'utf8');
    // 한 줄 주석 제거, 여러 줄 주석 제거
    const stripped = content
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(stripped);
    fs.writeFileSync('$TARGET', JSON.stringify(parsed, null, 2));
    console.log('✅ $EDITOR_NAME keybindings.json 적용 완료!');
    console.log('   경로: $TARGET');
    console.log('   적용된 단축키 수:', parsed.length);
  "
else
  # node 없으면 단순 복사 (주석 포함)
  cp "$SOURCE" "$TARGET"
  echo "✅ $EDITOR_NAME keybindings.json 적용 완료 (주석 포함)!"
  echo "   경로: $TARGET"
fi

echo ""
echo "📋 적용된 주요 단축키:"
echo "   Cmd+D           → 현재 줄 삭제"
echo "   Alt+Left        → 뒤로 이동"
echo "   Alt+Right       → 앞으로 이동"
echo "   Cmd+Left        → 줄 맨 앞으로 (Home)"
echo "   Cmd+I           → Cursor AI Agent 모드"
echo "   Ctrl+Cmd+F      → 찾기/바꾸기"
echo ""
echo "⚠️  변경사항을 적용하려면 $EDITOR_NAME 를 재시작하거나 창을 새로고침하세요."
echo "   (Cmd+Shift+P → 'Reload Window')"
