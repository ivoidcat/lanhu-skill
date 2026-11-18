---
name: lanhu
description: 蓝湖设计图定位、透明切图与 UI 实现数据导出。用户提供 lanhuapp.com 链接、页面名或要求按蓝湖还原页面时使用。一次生成多页实现清单和带图层 ID 的素材预览，直接按 JSON 绑定布局与素材。
---

# 蓝湖设计数据与切图

## 2026-11-07 执行顺序

1. 识别输入。带 `image_id` 的设计图链接直接使用 `exportDesigns`；只有项目链接或名称时，读 [导航参考](references/navigation.md) 定位。多个目标页面放在同一次批量调用中。
2. 在 ZCode 内置浏览器保持蓝湖登录态，按可用的 `control-browser` 技能初始化并取得 `tab`。登录/API 调用复用浏览器 cookie。
3. 一次导出原图、切图、规格和预览。首先读 **一份 `implementation.md`**，其中包含本批全部页面、共享样式、布局和素材绑定。按返回的 `overviewFile/assetPreviews` 查看自动生成的整图与 ID 预览，多个文件尽量在同一轮工具调用中读取。不要再逐页整读 `specs/*.summary.json`。
4. 根据清单里的 pt 坐标、文案、样式编号和素材键进入页面实现。预览用于核对素材，避免逐张描述图标、重拼已有总览或凭图标含义重新推测行归属。只对具体缺失、冲突或运行截图差异，按 id 查询完整规格/原始 JSON。
5. 若任务包含开发页面或接入 Debug 入口，导出完成后继续完成这些交付。按项目要求编译并从指定入口运行，对照设计稿验收布局、遮挡、素材、文字及交互状态；iOS 编译验证使用真机目标。

JSON 提供静态设计属性，交互、适配和运行时视图层级仍需结合目标项目实现。用原始值建立第一版，再根据运行结果修正。

## 2026-11-07 已知设计图链接：批量导出

取得 `tab` 后在 `mcp__node_repl__js` 中执行：

```js
const exporter = await import(
  "file://" + process.env.HOME + "/.agents/skills/lanhu/scripts/lanhu_export.mjs"
);
const result = await exporter.exportDesigns(tab, {
  urls: [designUrl1, designUrl2], // 用户给的完整 detailDetach 链接
  outDir: process.env.HOME + "/Downloads/lanhu_profile",
  montage: true,
  scales: [2, 3],
});
nodeRepl.write(result);
```

- 自动解析 `pid/project_id`、`tid/teamId/team_id`、`image_id/imageId`，按准确 id 获取页面，不需要 UI 搜索。
- 同次调用支持同项目、同团队的多张图；不同项目分别导出到不同目录。
- `exportPages(pages, opts)` 也可直接使用，`pages` 格式为 `[{n,id,name,url,jsonUrl}]`。已有 `getImageInfo` 结果时无需为确定签名重读脚本。
- 导出结果仅返回路径、数量、尺寸、失败项。完整 JSON 保存在文件中，避免把原始图层树或 `getImageInfo().raw` 全量打印进会话。
- 返回的 `previewErrors` 非空才修复对应预览。已有可读的 ID 预览时直接复用；不要为了改标签/分组再自行拼多轮图。

## 2026-11-07 只有分组或页面名

按 [导航参考](references/navigation.md) 用 `nav.findPages` 或 `nav.findSectors` 定位，同名页面按分组筛选。分组批量导出示例：

```js
const result = await exporter.exportSector(tab, {
  projectId, teamId, sector: sectorId,
  outDir, montage: true, scales: [2, 3],
  // pageIncludes: ["4.消息"], // 只导名称包含这些子串的页面
  // limit: 5,
});
nodeRepl.write(result);
```

## 2026-11-07 输出与单位

| 输出 | 用途 |
|---|---|
| `implementation.md` | **默认阅读入口**。本批所有页面合并，样式去重；一行一个元素/素材，包含 pt 布局、文字、父组、素材键和文件名 |
| `specs/NN_页面.summary.json` | 逐页备用摘要；已有实现清单时无需整读 |
| `specs/NN_页面.json` | 完整规格，按图层 id 查祖先、样式、效果与烘焙内容归属 |
| `layers/NN_页面.json` | 原始 JSON，保留路径、混合/裁剪信息与切片内部原始层 |
| `slices/NN_页面/_index.json` | 素材 id、倍率、尺寸、来源与失败说明 |
| `manifest.json` | 各页面的规格、摘要、整图、素材目录索引 |
| `full/`、`_check/` | 设计整图和自动生成的素材/页面预览 |

单位只换算一次：

- `pageSizePt` 是页面逻辑尺寸。750×1422px、`sliceScale=2` 的页面是 **375×711pt**。
- `framePt=[left,top,width,height]` 是相对整页的 pt 坐标；嵌套容器布局时减父容器坐标，不能再除倍率。
- 文字 `sizePt`、形状 `radiiPt`、描边 `widthPt` 已换算。`radiiPx`、`widthPx` 保留设计像素用于追溯。
- `opacity/fillOpacity/stroke.opacity` 是 0–100；`null` 表示原始字段未指定，不能当成 0。
- `style.effects` 保留原始字段及单位。`blendMode`、`clipped`、`isClippingMask` 会影响合成结果；原始填充色不能直接等同于截图最终像素色。
- `style.shapes[].radiiPt` 来自 `path.pathComponents[].origin.radii`。已有半径时直接采用，无需拟合截图曲线。
- `imageUrl` 对应烘焙切图。摘要的 `render=image` 使用素材，内部的填充/图标等无需重复绘制。`asset.files` 路径相对 `outDir`。
- 清单里的 `P1-2461` 表示第 1 页图层 2461，与素材预览的标签一致。清单素材文件名相对本页 `sliceDir`，倍率按 `2x/3x` 区分。
- 素材行的“同一局部父组的文案”由 JSON 层级计算，用于明确图标跟哪一行。它不是图像识别结果；即使图标含义与文案直觉不一致，也先保留设计稿的实际绑定，记录疑问并在运行对照时核验。

## 2026-11-07 取值与实现决策

按以下证据顺序处理，每次查询都应回答一个具体的实现问题。

1. 已有完整组件切图，直接复用其透明原图及尺寸。动态文字、点击区域和状态仍由代码实现，避免烘焙内容被重复叠加。
2. 普通形状读取 `style.fill/stroke/shapes`；文字读取 `text`。组合效果同时检查父层 `effects/blendMode` 和裁剪关系。查 JSON 中已有属性，优先于从整图反推。
3. 摘要缺字段时按 id 查完整规格，再查原始 JSON 的对应图层。字段未知明确记录，不把未知当作不存在。
4. 只有相关属性在 JSON 和切图中都不足、且影响实现时，才对指定区域采样或查看局部图。截图采样只证明最终合成像素，不能证明原始透明度或描边参数。
5. 同一疑问连续两次查询没有新证据时，记录缺口并转到运行截图验证，或使用项目中可验证的绘制方案。发现实际偏差继续修复；不要在无新证据时反复重选“裁图/代码画/提取边框”。

素材清点、尺寸检查、图层过滤和批量取值交给脚本一次完成。共享样式编号（S1 等）相同就复用，无需重新分析另一行/另一页的同一属性。用 id、素材键和简短结论记录已确认项，不把每次看图写成长篇设计复述。只在新证据或运行差异出现时重查。

## 2026-11-07 已有 JSON：离线复用与定点查询

已有 `layers/*.json` 时，不必重新访问蓝湖：

```bash
node ~/.agents/skills/lanhu/scripts/lanhu_spec.mjs /path/to/layer.json /path/to/page_spec.json
```

已有完整导出目录、需要新版实现清单和 ID 预览时，离线重建即可：

```bash
node ~/.agents/skills/lanhu/scripts/lanhu_export.mjs /path/to/existing-export-directory
```

该命令只读取目录中的规格和 PNG，生成 `implementation.md`、更新预览和清单；不重新下载。也可调用 `exporter.refreshImplementation(outDir)`。

生成完整规格与同目录 `page_spec.summary.json`。也可调用纯函数 `buildPageSpec(layer, {image, assets})`，或者 `writePageSpec(layer, {outFile, image, assets})`；`assets` 按 id 关联本地导出清单。

只需要规格、无需下载素材时：

```js
const spec = await import(
  "file://" + process.env.HOME + "/.agents/skills/lanhu/scripts/lanhu_spec.mjs"
);
nodeRepl.write(await spec.dumpPageSpec(tab, {
  projectId, teamId, imageId, outFile: "/tmp/page_spec.json",
}));
```

其他定点函数：`getLayerJson`、`findLayers`、`textSpec`、`layerSpec`、`styleSpec`、`fillsFromSlice`、`inspectLayer`、`sampleAssetColors`。`inspectLayer` 返回命中层与祖先规格，且会对切图采样，因此已知值优先读本地文件。

## 2026-11-07 素材质量与验收

- 切图优先下载切片层 `images.png_xxxhd` 透明母图，默认生成 **@2x + @3x**；3x 从母图缩出。接入 imageset 时同步倍率和 `Contents.json`。
- 只有缺少母图的切片才回退整图裁切，生成 @2x 并明确标记 `design-crop` 和 `3x skipped`。检查是否夹带背景、文字或相邻元素，不能把有污染的裁图当透明素材使用。
- 首次导出检查 `failed/cropped`、`pageSizePt`、2x/3x 尺寸比例 1.5 和生成的预览。成功素材和规格直接复用，不另写脚本重复下载、清点和生成总览。
- API 有数据且本地已有结果时直接使用。API 失效再按导航参考回退 UI；官方“下载切图”仅作备用，原生保存框和中文压缩包名会增加批量操作成本。
- 开发任务的完成条件包括从用户指定入口可进入页面、状态可操作、运行截图与设计稿对应，以及项目要求的编译验证。导出通过只代表设计数据已准备好。
