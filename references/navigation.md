# 蓝湖导航与接口参考

只有需要按名称定位、操作搜索 UI 或排查接口时读取。已知设计图链接优先使用主技能的批量入口。

## 2026-11-07 导航：找项目 / 文件夹 / 分组 / 页面

### 快速开始

```js
const teamId = "<teamId>";

// 项目：按名称搜索
const projects = await nav.findProjects(tab, { keyword: "<项目名>", teamId });
// 打开项目（URL 直达）
await nav.openProject(tab, projects[0]);

// 分组：搜索并打开
const sectors = await nav.findSectors(tab, {
  projectId: projects[0].id,
  keyword: "Spark",
});
await nav.openSector(tab, {
  projectId: projects[0].id,
  sectorId: sectors[0].id,
});

// 页面：同名页面会带 sectorName；打开时尽量传 imageId
const pages = await nav.findPages(tab, {
  projectId: projects[0].id,
  keyword: "4.消息",
});
const page = pages.items.find((p) => p.sectorName === "Spark Live");
await nav.openPage(tab, {
  projectId: projects[0].id,
  imageId: page.id,
});
```

### 函数

| 函数 | 作用 |
|------|------|
| `listTeams(tab)` | 账号下所有团队 |
| `searchProjects(tab, {teamId, keyword, pageNo, pageSize})` | 项目搜索；`keyword` 必须传，空字符串表示全部 |
| `listProjects(tab, {teamId})` | 第一页项目（最多约 100），返回 `truncated` |
| `findProjects(tab, {keyword, teamId?})` | 按名称找项目；不传 `teamId` 会遍历所有团队 |
| `searchFolders(tab, {teamId, keyword, pageNo, pageSize})` | 项目文件夹搜索 |
| `listFolders(tab, {teamId})` | 第一页文件夹，返回 `truncated` |
| `findFolders(tab, {keyword, teamId?})` | 按名称找文件夹 |
| `listFolderProjects(tab, {teamId, folderId})` | 文件夹下的项目 |
| `getProjectInfo(tab, {projectId, teamId})` | 项目名称/类型等 |
| `listSectors(tab, {projectId})` | 全部分组，含 `images[]` |
| `listImages(tab, {projectId, teamId})` | 全部设计图元数据 |
| `listPages(tab, {projectId, teamId})` | 设计图 + 所属分组 + 组内顺序 |
| `findSectors(tab, {projectId, keyword, top})` | 分组搜索 |
| `findPages(tab, {projectId, keyword, top})` | 设计图搜索，带 `sectorId/sectorName/indexInSector` |
| `searchAll(tab, {projectId, keyword, top})` | 分组 + 设计图一起搜 |
| `getImageInfo(tab, {projectId, teamId, imageId})` | 单图元数据，含 `url/jsonUrl` |
| `projectUrl({projectId, teamId})` | 项目直达 URL |
| `currentProject(tab)` | 从当前 URL 解析 `projectId/teamId` |
| `openProject(tab, {projectId/name, teamId?})` | URL 直达项目 |
| `openProjectByName(tab, {name, teamId?})` | 按名称搜索并打开 |
| `ensureProject(tab, {projectId, teamId})` | 不在目标项目时才跳转 |
| `openSector(tab, {projectId, sectorId/name})` | 搜索并点击分组结果 |
| `openPage(tab, {projectId, imageId/name})` | 搜索并点击设计图；有 `imageId` 时精确匹配 |
| `openSearch/closeSearch/runSearch/selectSearchTab` | 底层搜索面板控制 |

### 项目内搜索面板（UI）

- 打开：右上角放大镜 `.nav-tool-search`，或 **⌘K**。
- 输入框：`#search_input`，placeholder `搜索设计图、分组名称`。
- **必须按 Enter 才发请求**；只 `fill()` 不会出结果。
- Tab：`全部` / `设计图分组` / `设计图`。
- 分组结果：`.group_item[id="<sectorId>"]`
- 设计图结果：`.img_item img[id="<imageId>"]`
- 点击分组会切换左侧树；点击设计图会打开画布。
- 关闭：`.search_close`。
- 不要用页面内 `el.click()` 模拟搜索按钮，Vue 事件可能不触发；用 Playwright locator。

### URL / 深链

项目可以直达：

```
https://lanhuapp.com/web/#/item/project/stage?pid=<projectId>&teamId=<teamId>
```

已验证标题会变成 `<项目名>-Lanhu`。

用户已提供带 `image_id` 的 `detailDetach` 链接时，直接交给 `exportDesigns` 解析并读取。项目画布内点击图层时 URL 可能不变，按名称找分组或页面才使用以下搜索流程；不要自行猜测路由。

### 已知项目

把你自己项目的 `projectId` / `teamId` / `sectorId` 记在这里（或用 `findProjects`、`findSectors`、`findPages` 现查后缓存）。这些 id 可以在蓝湖 URL 或接口返回里直接拿到，不要提交到公开仓库。

## 2026-11-07 内部接口

不是蓝湖公开 API，是网页前端接口；改版可能失效。

| 用途 | 请求 |
|------|------|
| 团队 | `GET /api/account/user_teams` |
| 项目搜索 | `GET /api/project/search_project?team_id=&keyword=&pageNo=&pageSize=` |
| 文件夹搜索 | `GET /api/project/search_folder?team_id=&keyword=&pageNo=&pageSize=` |
| 文件夹内项目 | `GET /api/account/folder_projects?team_id=&folder_id=&pageNo=&pageSize=&default_order=desc` |
| 项目信息 | `GET /api/project/multi_info?project_id=&team_id=&img_limit=1&doc_info=1&members=1&links=1` |
| 项目分组 | `GET /api/project/project_sectors?project_id=` |
| 项目设计图 | `GET /api/project/images?project_id=&team_id=&dds_status=1&position=1&show_cb_src=1&comment=1` |
| 单张设计图 | `GET /api/project/image?image_id=&team_id=&project_id=` |
| 分组/设计图搜索 | `GET /api/project/search_sector_image?pid=&keyword=&top=20[&bucket=magic_sector]` |

要点：

- `search_project` / `search_folder` 必须带 `keyword`，空字符串表示全部；不带会 400。
- `pageSize` 实际上限约 100；当前版本 `pageNo` 不可靠，`listProjects`/`listFolders` 只返回第一页并标 `truncated`。找具体项目/文件夹请用 `keyword`。
- `search_sector_image` 不带 `bucket` 返回设计图；`bucket=magic_sector` 返回分组 `{id,name}`。
- 设计图搜索结果没有分组名；用 `project_sectors.images[]` 反查。
- `top` 默认 20；同名页面多时调大。

## 2026-11-07 导航与导出注意事项

- 同名页面非常常见（多个 `4.消息`）；`findPages` 结果按 `sectorName` 过滤，`openPage` 尽量传 `imageId`。
- 跨团队/跨项目操作时把 `teamId` 一起传；`openProject` 生成的 URL 带团队 id 才稳定。
- 分组重名时传 `sectorId`；项目重名时先 `findProjects` 看 `teamName/teamId`。
- 搜索面板打开后页面被遮罩；操作前先 `closeSearch(tab)`。
- 搜索面板是**项目内**的；搜另一个项目要先 `openProject`。
- 左侧树节点可能因滚动不可见导致点击超时；优先用搜索。
- 蓝湖接口没有稳定版本，失效时回退 UI 搜索/树点击，或重新抓接口。
- `full/` 整图只作参考和兜底；切图实际来自切片层母图，不是从整图裁。
