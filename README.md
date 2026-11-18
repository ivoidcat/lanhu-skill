# lanhu-skill

把蓝湖（Lanhu）设计图导出成**可以直接照着写代码的 UI 清单**的 ZCode 技能。

一次导出产出：设计整图、透明切片（@2x/@3x）、逐元素的 pt 坐标与样式、带图层 ID 的素材预览，以及一份合并多页的 `implementation.md`。

## 安装

```bash
git clone https://github.com/ivoidcat/lanhu-skill.git ~/.agents/skills/lanhu
```

重启 ZCode 后生效（技能从 `~/.agents/skills/` 加载）。

## 依赖

| 依赖 | 用途 |
|---|---|
| Node.js ≥ 18 | 导出脚本 |
| ImageMagick（`magick`，需包含 `montage`） | 生成整图与素材 ID 预览 |
| ZCode + `control-browser` 技能 | 用内置浏览器复用蓝湖登录态 |
| 蓝湖账号 | 需要有目标项目的查看权限 |

## 用法

在 ZCode 里直接给蓝湖设计图链接（`detailDetach` 且带 `image_id` 的地址），让它用 `lanhu` 技能导出即可。

手动调用：

```js
const exporter = await import(
  "file://" + process.env.HOME + "/.agents/skills/lanhu/scripts/lanhu_export.mjs"
);
const result = await exporter.exportDesigns(tab, {
  urls: [designUrl1, designUrl2], // 用户给的完整 detailDetach 链接，多页放在同一次调用
  outDir: process.env.HOME + "/Downloads/lanhu_<页面名>",
  montage: true,
  scales: [2, 3],
});
nodeRepl.write(result);
```

只有项目链接、没有具体设计图时，用 `references/navigation.md` 里的 `findPages` / `findSectors` 先定位页面。

已有导出目录、只想重建清单和预览时，可离线跑：

```bash
node ~/.agents/skills/lanhu/scripts/lanhu_export.mjs /path/to/existing-export-directory
```

## 产物

| 文件 | 用途 |
|---|---|
| `implementation.md` | **默认入口**：多页合并、样式去重，pt 布局 + 文案 + 样式编号 + 素材键 |
| `specs/NN_页面.summary.json` | 逐页摘要，按 id 查元素 |
| `specs/NN_页面.json` | 完整规格（效果、裁剪、混合关系） |
| `layers/NN_页面.json` | 原始图层树 |
| `slices/NN_页面/` | 透明切片，@2x + @3x，含 `_index.json` |
| `full/` | 设计整图 |
| `_check/pages/` | 带 `P<页>-<id>` 标签的素材预览 |
| `manifest.json` | 全部产物的索引 |

## 单位约定

- `pageSizePt` 是逻辑尺寸；750×1422px / `sliceScale=2` → **375×711pt**
- `framePt=[left,top,width,height]` 相对整页；嵌套容器布局时减父容器坐标，**不要再除倍率**
- 文字 `sizePt`、圆角 `radiiPt`、描边 `widthPt` 已换算；`radiiPx`、`widthPx` 保留设计像素用于追溯
- `opacity` / `fillOpacity` / `stroke.opacity` 是 0–100；`null` 表示原始字段未指定，**不能当 0**

## 注意

- 不要把自己项目的 `projectId` / `teamId` / `sectorId` 提交到公开仓库
- 素材文件名是蓝湖原始图层名（通常是中文），接入工程时自己建命名映射
- 切片优先用透明母图；只有缺母图时才回退整图裁切，并会标记 `design-crop`
- 导出通过只代表设计数据准备好了，不代表页面实现完成

## 同步脚本

| 脚本 | 作用 |
|---|---|
| `./publish.sh` | 把 `~/.agents/skills/lanhu` 同步到本仓库并推送；**推送前扫描真实 id，命中就中止** |
| `./install.sh` | 把本仓库安装到 `~/.agents/skills/lanhu`（已有则先备份为 `lanhu.bak-<时间戳>`） |
