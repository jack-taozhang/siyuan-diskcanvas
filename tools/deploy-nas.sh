#!/bin/bash
#
# 把 siyuan-diskcanvas（盘绘）部署到 NAS 上跑着的思源。
#
# ★ 为什么以 **zip 产物**为准 ★
#   `npm run pack` 已经做过 7 项自检（单文件产物、i18n 词表、清单文件齐备…），
#   用户装的也是这个 zip。部署直接用它解包，保证"我验的"与"你装的"是同一份，
#   不会再出现"构建产物 vs 源目录"两套东西对不上。
#
# 纪律（沿用本工作区固化的那套）：
#   · 传 //tmp → sudo cp → **md5 双向核对**，不一致立刻停（不让半截部署混过去）
#   · 落位后再看 ctime —— md5 对不等于没人再动过
#
# 用法：bash tools/deploy-nas.sh
set -u

# ★ 口令只从环境变量读，不写默认值（公开仓库不能带明文口令）★
#   用法：NAS_PW='你的口令' bash tools/deploy-nas.sh
if [ -z "${NAS_PW:-}" ]; then
  echo "缺少环境变量 NAS_PW。请这样跑：NAS_PW='你的口令' bash $0" >&2
  exit 2
fi
export NAS_PW

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PY="C:/Users/HP/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
NBSSH="D:/Docker/siyuan-localfs/tools/nbssh.py"

PLUGDIR="/vol1/docker/project/dk_app/siyuan/siyuan_E4Xr/data/data/plugins/siyuan-diskcanvas"
TMPDIR_REMOTE="/tmp/sy-diskcanvas"
STAGE="E:/TEMP/dc-stage"

md5local() { md5sum "$1" | cut -d' ' -f1; }
say() { echo "── $1"; }

cd "$ROOT" || exit 1

# ── 0. 构建 + 打包（pack 内部有 7 项自检）─────────────────────
say "0. 构建 + 打包"
npm run -s build >/dev/null 2>&1 || { echo "✗ 构建失败"; exit 1; }
npm run -s pack >/dev/null 2>&1 || { echo "✗ 打包自检未通过"; exit 1; }

VER="$("$PY" -c "import io,json;print(json.load(io.open('plugin.json',encoding='utf-8'))['version'])")"
ZIP="dist-package/siyuan-diskcanvas-v${VER}.zip"
[ -f "$ZIP" ] || { echo "✗ 找不到产物 $ZIP"; exit 1; }
say "   产物 $ZIP（version=$VER）"

# ── 1. 解包到暂存区（部署内容 == 用户装的 zip）─────────────────
say "1. 解包到暂存区"
rm -rf "$STAGE"
"$PY" - "$ZIP" "$STAGE" <<'PYEOF'
import sys, zipfile, os
zip_path, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path) as z:
    for name in z.namelist():
        # zip 内顶层目录是 siyuan-diskcanvas/，剥掉它
        rel = name.split("/", 1)[1] if "/" in name else name
        if not rel:
            continue
        dest = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with z.open(name) as src, open(dest, "wb") as fh:
            fh.write(src.read())
        print("   ", rel)
PYEOF

FILES="index.js index.css standalone.html standalone.js standalone.css plugin.json icon.png README.md README_zh_CN.md i18n/zh_CN.json i18n/en_US.json"

# ── 2. 上传到 //tmp ───────────────────────────────────────────
say "2. 上传到 ${TMPDIR_REMOTE}/"
"$PY" "$NBSSH" --sudo "rm -rf $TMPDIR_REMOTE; mkdir -p $TMPDIR_REMOTE/i18n; chmod 777 $TMPDIR_REMOTE $TMPDIR_REMOTE/i18n" >/dev/null 2>&1

for f in $FILES; do
  "$PY" "$NBSSH" --put "$STAGE/$f" "//${TMPDIR_REMOTE}/$f" 644 >/dev/null 2>&1 \
    || { echo "✗ 上传失败 $f"; exit 1; }
  echo "   ↑ $f  ($(md5local "$STAGE/$f"))"
done

# ── 3. 落位 ───────────────────────────────────────────────────
say "3. 安装到思源插件目录"
"$PY" "$NBSSH" --sudo "set -e
mkdir -p '$PLUGDIR/i18n'
for f in $FILES; do cp $TMPDIR_REMOTE/\$f '$PLUGDIR'/\$f; chmod 644 '$PLUGDIR'/\$f; done
OWN=\$(stat -c '%u:%g' /vol1/docker/project/dk_app/siyuan/siyuan_E4Xr/data/data/plugins 2>/dev/null || echo '')
[ -n \"\$OWN\" ] && chown -R \"\$OWN\" '$PLUGDIR' || true
rm -rf $TMPDIR_REMOTE
ls -la '$PLUGDIR'" 2>&1 | tail -16

# ── 4. md5 双向核对 ───────────────────────────────────────────
say "4. md5 双向核对"
FAIL=0
for f in $FILES; do
  l="$(md5local "$STAGE/$f")"
  r="$("$PY" "$NBSSH" --sudo "md5sum '$PLUGDIR/$f' | cut -d' ' -f1" 2>/dev/null | tr -d '\r\n ')"
  if [ "$l" = "$r" ]; then echo "   ✓ $f  $l"
  else echo "   ✗ $f  本地=$l 远端=$r"; FAIL=1; fi
done

if [ "$FAIL" != "0" ]; then echo "✗ md5 不一致，停止"; exit 1; fi
echo "✓ 全部一致"

# ── 5. ctime（md5 对 ≠ 没人再动）──────────────────────────────
say "5. 落地时间（ctime）"
"$PY" "$NBSSH" --sudo "stat -c '   %n  %s  ctime=%z' '$PLUGDIR/index.js' '$PLUGDIR/plugin.json'" 2>&1 | tail -4

echo
echo "版本：$VER"
echo "⚠️ 内核会缓存插件 JS —— 部署后必须**刷新思源页面**（Ctrl+Shift+R）；"
echo "   升 plugin.json.version 是唯一有效的破缓存手段，reload(ignoreCache) 无效。"
