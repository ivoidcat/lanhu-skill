/**
 * 蓝湖（lanhuapp.com）项目 / 文件夹 / 分组 / 设计图快速定位与打开。
 *
 * 运行环境：ZCode 的 mcp__node_repl__js；需要内置浏览器已登录蓝湖，
 * 并有一个 lanhuapp.com 的 tab。
 *
 * 典型用法：
 *   const { findProjects, openProject, findSectors, openSector, findPages, openPage } =
 *     await import("file://" + process.env.HOME + "/.agents/skills/lanhu/scripts/lanhu_nav.mjs");
 *
 *   const projects = await findProjects(tab, { keyword: "<项目名>" });
 *   await openProject(tab, projects[0]);                 // 项目 URL 直达
 *   const sectors = await findSectors(tab, { projectId, keyword: "Spark" });
 *   await openSector(tab, { projectId, sectorId: sectors[0].id });
 *   const pages = await findPages(tab, { projectId, keyword: "4.消息" });
 *   await openPage(tab, { projectId, imageId: pages[0].id });
 *
 * 蓝湖的搜索/项目接口是网页前端内部接口，不是公开 API；改版可能失效。
 * 如果接口失效，SKILL.md 里有 UI 搜索兜底步骤。
 */

const BASE = "https://lanhuapp.com";
const enc = encodeURIComponent;

async function api(tab, path) {
  return tab.playwright.evaluate(async (p) => {
    const r = await fetch(p, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    let json = null;
    try {
      json = await r.json();
    } catch (e) {}
    return { status: r.status, json };
  }, BASE + path);
}

function check(res, what) {
  if (!res || res.status !== 200) throw new Error(`${what}: HTTP ${res && res.status}`);
  const code = res.json && res.json.code;
  if (code != null && String(code) !== "00000" && String(code) !== "0") {
    throw new Error(`${what}: code=${code} ${(res.json && res.json.msg) || ""}`);
  }
  return res.json ? res.json.result ?? res.json.data ?? res.json : null;
}

function normProject(p) {
  return {
    id: p.id,
    name: p.name,
    teamId: p.team_id,
    folderId: p.folder_id ?? null,
    type: p.type,
    updateTime: p.update_time,
  };
}

function normFolder(f) {
  return {
    id: f.id,
    name: f.name,
    parentId: f.parent_id ?? null,
    projectCount: f.all_project_count ?? null,
    visibleProjectCount: f.visible_project_count ?? null,
  };
}

async function wait(tab, ms = 500) {
  await tab.playwright.waitForTimeout(ms);
}

/* ----------------------------- 团队 / 项目 / 文件夹 ----------------------------- */

export async function listTeams(tab) {
  const d = check(await api(tab, "/api/account/user_teams"), "listTeams");
  return (Array.isArray(d) ? d : []).map((t) => ({
    id: t.id,
    name: t.name,
    role: t.role && t.role.name ? t.role.name : t.role,
    memberNum: t.member_num,
  }));
}

export async function searchProjects(tab, { teamId, keyword = "", pageNo = 1, pageSize = 100 }) {
  const q = new URLSearchParams({
    team_id: teamId,
    keyword: keyword || "",
    pageNo: String(pageNo),
    pageSize: String(pageSize),
  });
  const res = await api(tab, `/api/project/search_project?${q}`);
  const d = check(res, "searchProjects");
  const items = Array.isArray(d) ? d : [];
  return {
    total: res.json?.total ?? items.length,
    hasNext: !!(res.json && res.json.has_next),
    items: items.map(normProject),
  };
}

export async function listProjects(tab, { teamId, pageSize = 100 }) {
  const r = await searchProjects(tab, { teamId, keyword: "", pageNo: 1, pageSize });
  return { total: r.total, items: r.items, truncated: r.items.length < r.total };
}

export async function findProjects(tab, { keyword = "", teamId, pageSize = 100 }) {
  if (teamId) {
    const r = await searchProjects(tab, { teamId, keyword, pageSize });
    return r.items;
  }
  const teams = await listTeams(tab);
  const out = [];
  for (const t of teams) {
    const r = await searchProjects(tab, { teamId: t.id, keyword, pageSize });
    out.push(...r.items.map((p) => ({ ...p, teamName: t.name })));
  }
  return out;
}

export async function searchFolders(tab, { teamId, keyword = "", pageNo = 1, pageSize = 100 }) {
  const q = new URLSearchParams({
    team_id: teamId,
    keyword: keyword || "",
    pageNo: String(pageNo),
    pageSize: String(pageSize),
  });
  const res = await api(tab, `/api/project/search_folder?${q}`);
  const d = check(res, "searchFolders");
  const items = Array.isArray(d) ? d : [];
  return {
    total: res.json?.total ?? items.length,
    hasNext: !!(res.json && res.json.has_next),
    items: items.map(normFolder),
  };
}

export async function listFolders(tab, { teamId, pageSize = 100 }) {
  const r = await searchFolders(tab, { teamId, keyword: "", pageNo: 1, pageSize });
  return { total: r.total, items: r.items, truncated: r.items.length < r.total };
}

export async function findFolders(tab, { keyword = "", teamId, pageSize = 100 }) {
  if (teamId) {
    const r = await searchFolders(tab, { teamId, keyword, pageSize });
    return r.items;
  }
  const teams = await listTeams(tab);
  const out = [];
  for (const t of teams) {
    const r = await searchFolders(tab, { teamId: t.id, keyword, pageSize });
    out.push(...r.items.map((f) => ({ ...f, teamName: t.name })));
  }
  return out;
}

export async function listFolderProjects(tab, { teamId, folderId, pageNo = 1, pageSize = 100 }) {
  const q = new URLSearchParams({
    team_id: teamId,
    folder_id: folderId,
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    default_order: "desc",
  });
  const d = check(await api(tab, `/api/account/folder_projects?${q}`), "listFolderProjects");
  const items = (d && d.projects_info) || [];
  return {
    total: (d && d.all_project_count) ?? items.length,
    visibleCount: d && d.visible_project_count,
    items: items.map(normProject),
  };
}

export async function getProjectInfo(tab, { projectId, teamId }) {
  const q = new URLSearchParams({
    project_id: projectId,
    team_id: teamId,
    img_limit: "1",
    doc_info: "1",
    members: "1",
    links: "1",
  });
  const d = check(await api(tab, `/api/project/multi_info?${q}`), "getProjectInfo");
  return {
    id: (d && d.id) || projectId,
    name: d && d.name,
    type: d && d.type,
    raw: d,
  };
}

/* ----------------------------- 项目内分组 / 设计图 ----------------------------- */

export async function listSectors(tab, { projectId }) {
  const q = new URLSearchParams({ project_id: projectId });
  const d = check(await api(tab, `/api/project/project_sectors?${q}`), "listSectors");
  const sectors = (d && d.sectors) || [];
  return sectors.map((s) => ({
    id: s.id,
    name: s.name,
    parentId: s.parent_id ?? null,
    order: s.order,
    images: s.images || [],
    imageCount: (s.images || []).length,
  }));
}

export async function listImages(tab, { projectId, teamId }) {
  const q = new URLSearchParams({
    project_id: projectId,
    team_id: teamId,
    dds_status: "1",
    position: "1",
    show_cb_src: "1",
    comment: "1",
  });
  const d = check(await api(tab, `/api/project/images?${q}`), "listImages");
  const images = (d && d.images) || [];
  return images.map((im) => ({
    id: im.id,
    name: (im.name || "").trim(),
    width: im.width,
    height: im.height,
    url: im.url,
    latestVersion: im.latest_version,
    order: im.order,
    positionX: im.position_x,
    positionY: im.position_y,
  }));
}

export async function listPages(tab, { projectId, teamId }) {
  const [sectors, images] = await Promise.all([
    listSectors(tab, { projectId }),
    listImages(tab, { projectId, teamId }),
  ]);
  const map = new Map();
  for (const s of sectors) {
    s.images.forEach((id, idx) => {
      if (!map.has(id)) map.set(id, { sectorId: s.id, sectorName: s.name, indexInSector: idx });
    });
  }
  return images.map((im) => ({ ...im, ...(map.get(im.id) || {}) }));
}

async function buildSectorIndex(tab, { projectId }) {
  const sectors = await listSectors(tab, { projectId });
  const sectorByImage = new Map();
  for (const s of sectors) {
    s.images.forEach((id, idx) => {
      if (!sectorByImage.has(id)) {
        sectorByImage.set(id, { sectorId: s.id, sectorName: s.name, indexInSector: idx });
      }
    });
  }
  return { sectors, sectorByImage };
}

async function searchSectorImage(tab, { projectId, keyword, top = 20, bucket }) {
  const q = new URLSearchParams({
    pid: projectId,
    keyword: keyword || "",
    top: String(top),
  });
  if (bucket) q.set("bucket", bucket);
  const d = check(await api(tab, `/api/project/search_sector_image?${q}`), "searchSectorImage");
  return Array.isArray(d) ? d : [];
}

export async function findSectors(tab, { projectId, keyword = "", top = 20 }) {
  const raw = await searchSectorImage(tab, { projectId, keyword, top, bucket: "magic_sector" });
  let items = raw
    .filter((x) => !x._bucket || x._bucket === "magic_sector")
    .map((x) => ({ id: x.id, name: x.name }));
  if (!items.length) {
    const all = await listSectors(tab, { projectId });
    const needle = (keyword || "").toLowerCase();
    items = all
      .filter((s) => !needle || (s.name || "").toLowerCase().includes(needle))
      .map((s) => ({ id: s.id, name: s.name, imageCount: s.imageCount }));
  }
  return items;
}

export async function findPages(tab, { projectId, keyword = "", top = 20 }) {
  const [raw, index] = await Promise.all([
    searchSectorImage(tab, { projectId, keyword, top }),
    buildSectorIndex(tab, { projectId }),
  ]);
  const items = raw
    .filter((x) => !x._bucket || x._bucket === "magic_image")
    .map((x) => ({
      id: x.id,
      name: (x.name || "").trim(),
      width: x.width,
      height: x.height,
      url: x.url,
      latestVersion: x.latest_version,
      ...(index.sectorByImage.get(x.id) || {}),
    }));
  return { total: items.length, items };
}

export async function searchAll(tab, { projectId, keyword = "", top = 20 }) {
  const [sectors, pages] = await Promise.all([
    findSectors(tab, { projectId, keyword, top }),
    findPages(tab, { projectId, keyword, top }),
  ]);
  return { sectors, pages: pages.items };
}

export async function getImageInfo(tab, { projectId, teamId, imageId }) {
  const q = new URLSearchParams({
    image_id: imageId,
    team_id: teamId,
    project_id: projectId,
  });
  const d = check(await api(tab, `/api/project/image?${q}`), "getImageInfo");
  const v = ((d && d.versions) || [])[0] || {};
  return {
    id: d && d.id,
    name: d && d.name,
    width: d && d.width,
    height: d && d.height,
    latestVersion: d && d.latest_version,
    url: v.url,
    jsonUrl: v.json_url,
    raw: d,
  };
}

/* ----------------------------- URL / 打开 ----------------------------- */

export function projectUrl({ projectId, teamId }) {
  const q = new URLSearchParams({ pid: projectId });
  if (teamId) q.set("teamId", teamId);
  return `${BASE}/web/#/item/project/stage?${q}`;
}

export async function currentProject(tab) {
  const href = await tab.playwright.evaluate(() => location.href);
  const hash = href.includes("#") ? href.split("#").slice(1).join("#") : "";
  const qs = hash.includes("?") ? hash.split("?").slice(1).join("?") : "";
  const q = new URLSearchParams(qs);
  return {
    projectId: q.get("pid"),
    teamId: q.get("teamId") || q.get("tid"),
    url: href,
  };
}

export async function openProject(tab, { projectId, teamId, name }) {
  if (!projectId && name) {
    const list = await findProjects(tab, { keyword: name, teamId });
    if (!list.length) throw new Error(`project not found: ${name}`);
    projectId = list[0].id;
    teamId = teamId || list[0].teamId;
  }
  if (!projectId) throw new Error("openProject: projectId or name required");
  const url = projectUrl({ projectId, teamId });
  try {
    await tab.goto(url);
  } catch (e) {}
  try {
    await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
  } catch (e) {}
  await wait(tab, 1800);
  const info = await tab.playwright.evaluate(() => ({ title: document.title, url: location.href }));
  return { projectId, teamId, requestedUrl: url, title: info.title, url: info.url };
}

export async function ensureProject(tab, { projectId, teamId }) {
  const cur = await currentProject(tab);
  if (projectId && cur.projectId !== projectId) {
    return openProject(tab, { projectId, teamId });
  }
  return cur;
}

async function hasSearchInput(tab) {
  return (await tab.playwright.locator("#search_input").count()) > 0;
}

export async function openSearch(tab) {
  if (await hasSearchInput(tab)) return true;
  const btn = tab.playwright.locator(".nav-tool-search").last();
  if (await btn.count()) {
    try {
      await btn.click();
    } catch (e) {}
  }
  await wait(tab, 300);
  if (!(await hasSearchInput(tab))) {
    try {
      await tab.cua.keypress({ keys: ["Meta", "k"] });
    } catch (e) {}
    await wait(tab, 400);
  }
  return hasSearchInput(tab);
}

export async function closeSearch(tab) {
  const close = tab.playwright.locator(".search_close");
  if (await close.count()) {
    try {
      await close.click();
    } catch (e) {}
    await wait(tab, 250);
  }
}

export async function runSearch(tab, keyword) {
  if (!(await openSearch(tab))) {
    throw new Error("search panel not found; is a Lanhu project stage open?");
  }
  const input = tab.playwright.locator("#search_input");
  await input.fill(keyword);
  await input.press("Enter");
  await wait(tab, 1100);
  return { keyword, resultCards: await tab.playwright.locator(".list_box .img_item").count() };
}

export async function selectSearchTab(tab, name) {
  const el = tab.playwright.getByText(name, { exact: true });
  if (await el.count()) {
    try {
      await el.first().click();
    } catch (e) {}
    await wait(tab, 600);
  }
}

export async function clickImageResult(tab, { imageId, name }) {
  const cards = tab.playwright.locator(".list_box .img_item");
  const count = await cards.count();
  if (!count) throw new Error("no image search results");
  let idx = -1;
  if (imageId) {
    idx = await tab.playwright.evaluate(
      (id) =>
        Array.from(document.querySelectorAll(".list_box .img_item")).findIndex(
          (el) => !!el.querySelector(`img[id="${id}"]`)
        ),
      imageId
    );
  }
  if (idx < 0 && name) {
    idx = await tab.playwright.evaluate(
      (kw) =>
        Array.from(document.querySelectorAll(".list_box .img_item")).findIndex((el) =>
          ((el.innerText || "") + (el.textContent || "")).includes(kw)
        ),
      name
    );
  }
  if (idx < 0) idx = 0;
  await cards.nth(idx).click();
  await wait(tab, 900);
  return { index: idx, clicked: true };
}

export async function clickSectorResult(tab, { sectorId, name }) {
  let clicked = false;
  if (sectorId) {
    const el = tab.playwright.locator(`.group_item[id="${sectorId}"]`);
    if (await el.count()) {
      await el.first().click();
      clicked = true;
    }
  }
  if (!clicked && name) {
    const idx = await tab.playwright.evaluate(
      (n) =>
        Array.from(document.querySelectorAll(".search_all .img_item")).findIndex((el) =>
          ((el.innerText || "") + (el.textContent || "")).includes(n)
        ),
      name
    );
    if (idx >= 0) {
      const card = tab.playwright.locator(".search_all .img_item").nth(idx);
      const group = card.locator(".group_item");
      if (await group.count()) {
        await group.first().click();
        clicked = true;
      }
    }
  }
  if (!clicked && name) {
    const re = new RegExp("^" + String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const tree = tab.playwright.getByRole("treeitem", { name: re });
    if (await tree.count()) {
      await tree.first().click();
      clicked = true;
    }
  }
  if (!clicked) throw new Error(`sector result not found: ${sectorId || name}`);
  await wait(tab, 900);
  return { clicked: true };
}

export async function openSector(tab, { projectId, teamId, sectorId, name, keyword }) {
  const cur = await currentProject(tab);
  projectId = projectId || cur.projectId;
  teamId = teamId || cur.teamId;
  if (projectId && cur.projectId !== projectId) await openProject(tab, { projectId, teamId });
  if (!name && sectorId) {
    const sectors = await listSectors(tab, { projectId });
    name = (sectors.find((s) => s.id === sectorId) || {}).name;
  }
  name = name || keyword;
  if (!name) throw new Error("openSector: sectorId or name required");
  await runSearch(tab, name);
  await selectSearchTab(tab, "设计图分组");
  const res = await clickSectorResult(tab, { sectorId, name });
  return { projectId, sectorId, name, ...res };
}

export async function openPage(tab, { projectId, teamId, imageId, name, keyword }) {
  const cur = await currentProject(tab);
  projectId = projectId || cur.projectId;
  teamId = teamId || cur.teamId;
  if (projectId && cur.projectId !== projectId) await openProject(tab, { projectId, teamId });
  let kw = keyword || name;
  if (!kw && imageId) {
    const info = await getImageInfo(tab, { projectId, teamId, imageId });
    kw = info.name;
  }
  if (!kw) throw new Error("openPage: imageId/name/keyword required");
  await runSearch(tab, kw);
  const res = await clickImageResult(tab, { imageId, name: name || kw });
  return { projectId, keyword: kw, ...res };
}

export async function openProjectByName(tab, { name, teamId, keyword }) {
  const list = await findProjects(tab, { keyword: keyword || name, teamId });
  if (!list.length) throw new Error(`project not found: ${name || keyword}`);
  return openProject(tab, { projectId: list[0].id, teamId: list[0].teamId, name: list[0].name });
}
