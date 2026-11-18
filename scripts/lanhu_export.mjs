/**
 * 蓝湖（lanhuapp.com）设计图切图批量导出。
 *
 * 运行环境：ZCode 的 mcp__node_repl__js（Node 里能拿到内置浏览器的 tab）。
 * 元数据（项目/分组/版本）走浏览器会话；图层 JSON 与切图原图走 Node https 直连 CDN。
 *
 * 用法：
 *   const { exportSector } = await import(
 *     "file:///Users/<you>/.agents/skills/lanhu/scripts/lanhu_export.mjs"
 *   );
 *   const summary = await exportSector(tab, {
 *     projectId: "<projectId>",
 *     teamId: "<teamId>",
 *     sector: "Spark Live",              // 分组名或 sector id
 *     outDir: `${process.env.HOME}/Downloads/lanhu_spark_live`,
 *     montage: true,                     // 生成 _check 目检图
 *     pageIncludes: ["4.消息"],           // 可选：只导名称包含这些子串的页面
 *   });
 *
 * 输出：
 *   full/ layers/ slices/NN_页面/ slices_index.csv duplicates_report.json manifest.json README.md _check/
 */

import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getImageInfo } from "./lanhu_nav.mjs";
import { buildPageSpec, implementationGuide, writePageSpec } from "./lanhu_spec.mjs";

const DEFAULT_MAGICK = "/opt/homebrew/bin/magick";

const safeName = (s) =>
  String(s == null ? "" : s)
    .replace(/[\\/:*?"<>|\n\r\t]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://lanhuapp.com/" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 4) {
          res.resume();
          download(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error(`timeout ${url}`)));
  });
}

function run(bin, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin} exit ${code}: ${err.slice(0, 300)}`))));
    p.on("error", reject);
    if (input !== undefined) p.stdin.end(input);
  });
}

async function identify(file, magickPath) {
  const out = await run(magickPath, ["identify", "-format", "%w %h", file]);
  const [w, h] = out.trim().split(/\s+/).map(Number);
  return { w, h };
}

/**
 * 读取一个分组下的页面元数据（需要浏览器登录态）。
 * @returns {{sector:{id,name,count}, pages:Array<{n,id,name,url,jsonUrl}>}}
 */
export async function collectSector(tab, { projectId, teamId, sector }) {
  return tab.playwright.evaluate(
    async (arg) => {
      const { projectId, teamId, sector } = arg;
      const get = async (url) => {
        const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
        return r.json();
      };
      const [imgsRes, sectorsRes] = await Promise.all([
        get(`/api/project/images?project_id=${projectId}&team_id=${teamId}&dds_status=1&position=1&show_cb_src=1&comment=1`),
        get(`/api/project/project_sectors?project_id=${projectId}`),
      ]);
      const sectors = sectorsRes?.data?.sectors || [];
      const needle = String(sector || "").toLowerCase();
      const sec =
        sectors.find((s) => s.id === sector) ||
        sectors.find((s) => s.name === sector) ||
        sectors.find((s) => (s.name || "").toLowerCase().includes(needle));
      if (!sec) {
        return { error: "sector not found", sectors: sectors.map((s) => ({ id: s.id, name: s.name, count: (s.images || []).length })) };
      }
      const images = imgsRes?.data?.images || [];
      const pages = await Promise.all(
        (sec.images || []).map(async (id, i) => {
          const j = await get(`/api/project/image?image_id=${id}&team_id=${teamId}&project_id=${projectId}`);
          const d = j?.data || j?.result || j;
          const v = (d.versions || [])[0] || {};
          return {
            n: i + 1,
            id,
            name: (d.name || "").trim(),
            width: d.width,
            height: d.height,
            latestVersion: d.latest_version,
            url: v.url,
            jsonUrl: v.json_url,
          };
        })
      );
      return { sector: { id: sec.id, name: sec.name, count: pages.length }, projectName: imgsRes?.data?.name || "", pages };
    },
    { projectId, teamId, sector }
  );
}

/** 列出项目全部分组（需要浏览器登录态）。 */
export async function listSectors(tab, { projectId }) {
  return tab.playwright.evaluate(
    async (arg) => {
      const r = await fetch(`/api/project/project_sectors?project_id=${arg.projectId}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const j = await r.json();
      return ((j?.data || j)?.sectors || []).map((s) => ({ id: s.id, name: s.name, count: (s.images || []).length }));
    },
    { projectId }
  );
}

/** 解析用户给的 detailDetach 链接，不需要 UI 搜索或猜测路由。 */
export function parseDesignUrl(value) {
  const url = new URL(value);
  if (url.hostname !== "lanhuapp.com" && !url.hostname.endsWith(".lanhuapp.com")) {
    throw new Error("Expected a lanhuapp.com design URL");
  }
  const query = new URLSearchParams(url.hash.split("?")[1] || url.search);
  const result = {
    projectId: query.get("pid") || query.get("project_id"),
    teamId: query.get("tid") || query.get("teamId") || query.get("team_id"),
    imageId: query.get("image_id") || query.get("imageId"),
  };
  if (!result.projectId || !result.teamId || !result.imageId) {
    throw new Error("Design URL must include project, team and image IDs; use navigation for project-only URLs");
  }
  return result;
}

/** 用户已提供设计图链接时，一次导出切图、规格、摘要和预览。 */
export async function exportDesigns(tab, opts) {
  const designs = [...new Map(opts.urls.map((url) => {
    const design = parseDesignUrl(url);
    return [[design.projectId, design.teamId, design.imageId].join("/"), design];
  })).values()];
  if (!designs.length) throw new Error("exportDesigns: urls must contain at least one design URL");
  const { projectId, teamId } = designs[0];
  if (designs.some((d) => d.projectId !== projectId || d.teamId !== teamId)) {
    throw new Error("exportDesigns: export different projects/teams into separate output directories");
  }
  const pages = await Promise.all(designs.map(async (design, i) => {
    const info = await getImageInfo(tab, design);
    return { n: i + 1, id: design.imageId, name: info.name, url: info.url, jsonUrl: info.jsonUrl };
  }));
  return exportPages(pages, { ...opts, projectId, teamId });
}

/**
 * 导出一批已经 collect 的页面（纯 Node，不需要浏览器）。
 * pages 来自 collectSector().pages。
 */
export async function exportPages(pages, opts) {
  if (pages.some((page) => !page.id)) {
    throw new Error("exportPages: each page needs id; use getImageInfo().id or exportDesigns(tab, opts)");
  }
  const {
    outDir,
    magickPath = DEFAULT_MAGICK,
    montage = false,
    projectName = "",
    projectId = "",
    teamId = "",
    sectorName = "",
    scales = [2, 3],
  } = opts;
  const scaleList = [...new Set((scales || [2, 3]).map(Number).filter((s) => s > 0))].sort((a, b) => a - b);
  if (!scaleList.length) scaleList.push(2);

  await fs.mkdir(path.join(outDir, "full"), { recursive: true });
  await fs.mkdir(path.join(outDir, "layers"), { recursive: true });
  await fs.mkdir(path.join(outDir, "specs"), { recursive: true });
  await fs.mkdir(path.join(outDir, "slices"), { recursive: true });

  const manifestFile = path.join(outDir, "manifest.json");
  let manifest = { project: { name: projectName, id: projectId, teamId }, sector: sectorName, generatedAt: new Date().toISOString(), pages: [] };
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    manifest.project = manifest.project || { name: projectName, id: projectId, teamId };
    manifest.sector = manifest.sector || sectorName;
  } catch (e) {}

  const summaries = [];

  for (const page of pages) {
    if (!page.url || !page.jsonUrl) throw new Error(`page ${page.n} ${page.name}: missing url/jsonUrl`);
    const prefix = `${String(page.n).padStart(2, "0")}_${safeName(page.name)}`;
    const layerPath = path.join(outDir, "layers", `${prefix}.json`);
    const fullPath = path.join(outDir, "full", `${prefix}.png`);
    const sliceDir = path.join(outDir, "slices", prefix);

    const [layerBuf, fullBuf] = await Promise.all([download(page.jsonUrl), download(page.url)]);
    const layer = JSON.parse(layerBuf.toString("utf8"));
    await fs.writeFile(layerPath, layerBuf);
    await fs.writeFile(fullPath, fullBuf);

    const o = layer.board.artboard.artboardRect;
    const artW = o.right - o.left;
    const artH = o.bottom - o.top;
    const bitmap = await identify(fullPath, magickPath);

    const nodeById = new Map();
    const walk = (n) => {
      if (!n) return;
      if (n.id != null) nodeById.set(n.id, n);
      (n.layers || []).forEach(walk);
    };
    (layer.board.layers || []).forEach(walk);

    await fs.rm(sliceDir, { recursive: true, force: true });
    await fs.mkdir(sliceDir, { recursive: true });

    const usedBases = new Set();
    const assets = [];
    let fromLayer = 0;
    let fromCrop = 0;
    const sliceScale = Number(layer.sliceScale) || 2;

    for (const a of layer.assets || []) {
      const b = a.bounds;
      if (!b) continue;
      const w = b.right - b.left;
      const h = b.bottom - b.top;
      if (w <= 0 || h <= 0) continue;

      const rawBase = safeName(a.name) || "未命名";
      let base = rawBase;
      let k = 2;
      while (usedBases.has(base)) {
        base = `${rawBase}-${k}`;
        k++;
      }
      usedBases.add(base);

      const node = nodeById.get(a.id);
      const imgUrl = node?.images?.png_xxxhd || node?.images?.png_xxhd || node?.images?.png_xhd;
      let source = "design-crop";
      let note = null;
      const files = {};
      const sizes = {};

      if (imgUrl) {
        try {
          const buf = await download(imgUrl);
          const tmp = path.join("/tmp", `lanhu_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}.png`);
          await fs.writeFile(tmp, buf);
          // png_xxxhd 是 4x 母图；按 bounds（sliceScale 倍）生成 2x/3x
          for (const s of scaleList) {
            const tw = Math.max(1, Math.round((w * s) / sliceScale));
            const th = Math.max(1, Math.round((h * s) / sliceScale));
            const fname = `${base}@${s}x.png`;
            await run(magickPath, [tmp, "-resize", `${tw}x${th}!`, path.join(sliceDir, fname)]);
            files[`${s}x`] = fname;
            sizes[`${s}x`] = { w: tw, h: th };
          }
          await fs.rm(tmp, { force: true });
          source = "layer-image";
          fromLayer++;
        } catch (e) {
          note = `layer image failed: ${String(e).slice(0, 160)}`;
        }
      }

      if (source === "design-crop") {
        const x = Math.max(0, Math.round(b.left - o.left));
        const y = Math.max(0, Math.round(b.top - o.top));
        const cw = Math.min(Math.round(w), artW - x);
        const ch = Math.min(Math.round(h), artH - y);
        if (cw > 0 && ch > 0) {
          // 整图只能提供 2x；没有图层母图时不生成 3x，避免放大糊图
          const fname = `${base}@2x.png`;
          await run(magickPath, [fullPath, "-crop", `${cw}x${ch}+${x}+${y}`, "+repage", path.join(sliceDir, fname)]);
          files["2x"] = fname;
          sizes["2x"] = { w: cw, h: ch };
          fromCrop++;
          if (scaleList.includes(3)) note = note || "3x skipped: no layer image source";
        } else {
          note = note || "empty crop";
        }
      }

      const primaryKey = files["2x"] ? "2x" : Object.keys(files)[0];
      const primaryFile = primaryKey ? files[primaryKey] : null;
      let size = primaryKey ? sizes[primaryKey] : { w: Math.round(w), h: Math.round(h) };
      if (primaryFile) {
        try {
          size = await identify(path.join(sliceDir, primaryFile), magickPath);
        } catch (e) {}
      }
      assets.push({
        name: a.name,
        id: a.id,
        file: primaryFile,
        files,
        sizes,
        w: size.w,
        h: size.h,
        bounds: b,
        source,
        fullBoard: w * h >= artW * artH * 0.95,
        note,
      });
    }

    await fs.writeFile(path.join(sliceDir, "_index.json"), JSON.stringify(assets, null, 2));

    const specFile = `specs/${prefix}.json`;
    const summaryFile = `specs/${prefix}.summary.json`;
    const spec = await writePageSpec(layer, {
      outFile: path.join(outDir, specFile),
      summaryFile: path.join(outDir, summaryFile),
      image: { id: page.id, name: page.name },
      assets: assets.map((a) => ({
        id: a.id,
        source: a.source,
        note: a.note,
        files: Object.fromEntries(Object.entries(a.files).map(([scale, file]) => [scale, `slices/${prefix}/${file}`])),
        sizes: a.sizes,
      })),
    });

    const entry = {
      n: page.n,
      id: page.id,
      name: page.name,
      artboard: { w: artW, h: artH },
      bitmap,
      fullImage: `full/${prefix}.png`,
      layerFile: `layers/${prefix}.json`,
      sliceDir: `slices/${prefix}`,
      specFile,
      summaryFile,
      pageSizePt: spec.pageSizePt,
      assetCount: assets.length,
      scales: scaleList,
      assets,
    };
    manifest.pages = (manifest.pages || []).filter((p) => p.id !== page.id);
    manifest.pages.push(entry);
    manifest.pages.sort((a, b) => a.n - b.n);
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));

    summaries.push({
      n: page.n,
      name: page.name,
      artboard: entry.artboard,
      bitmap,
      specFile,
      summaryFile,
      pageSizePt: spec.pageSizePt,
      assetCount: assets.length,
      scales: scaleList,
      fromLayer,
      fromCrop,
      cropped: assets.filter((x) => x.source === "design-crop").map((x) => x.name),
      failed: assets.filter((x) => x.note).map((x) => ({ name: x.name, note: x.note })),
    });

  }

  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  await writeReports(outDir, manifest);
  const review = await refreshImplementation(outDir, { magickPath, montage });

  return {
    outDir,
    sector: manifest.sector,
    ...review,
    pages: summaries,
    totals: {
      pages: summaries.length,
      assets: summaries.reduce((s, x) => s + x.assetCount, 0),
      fromLayer: summaries.reduce((s, x) => s + x.fromLayer, 0),
      fromCrop: summaries.reduce((s, x) => s + x.fromCrop, 0),
      scales: scaleList,
    },
  };
}

/**
 * 抓取分组并导出。
 */
export async function exportSector(tab, opts) {
  const collected = await collectSector(tab, opts);
  if (collected.error) {
    const err = new Error(`sector not found: ${opts.sector}`);
    err.sectors = collected.sectors;
    throw err;
  }
  let pages = collected.pages;
  if (opts.pageIncludes && opts.pageIncludes.length) {
    pages = pages.filter((p) => opts.pageIncludes.some((s) => (p.name || "").includes(s)));
  }
  if (opts.limit) pages = pages.slice(0, opts.limit);
  return exportPages(pages, {
    ...opts,
    projectName: opts.projectName || collected.projectName || "",
    sectorName: collected.sector.name,
  });
}

async function writeReports(outDir, manifest) {
  const rows = [["page_no", "page", "asset", "file_2x", "file_3x", "w_2x", "h_2x", "w_3x", "h_3x", "source", "full_board"]];
  const byName = new Map();
  const fullBoard = [];
  for (const p of manifest.pages) {
    for (const a of p.assets) {
      const s2 = a.sizes?.["2x"] || {};
      const s3 = a.sizes?.["3x"] || {};
      rows.push([
        p.n, p.name, a.name,
        a.files?.["2x"] || "", a.files?.["3x"] || "",
        s2.w || "", s2.h || "", s3.w || "", s3.h || "",
        a.source, a.fullBoard ? "yes" : "",
      ]);
      const key = (a.name || "").trim();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ page: p.n, pageName: p.name, files: a.files, w: a.w, h: a.h, sliceDir: p.sliceDir });
      if (a.fullBoard) fullBoard.push({ page: p.n, pageName: p.name, name: a.name, files: a.files, w: a.w, h: a.h, sliceDir: p.sliceDir });
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  await fs.writeFile(path.join(outDir, "slices_index.csv"), csv + "\n");

  const repeated = {};
  for (const [k, v] of byName) if (v.length > 1) repeated[k] = v;
  await fs.writeFile(
    path.join(outDir, "duplicates_report.json"),
    JSON.stringify({ repeatedNames: repeated, fullBoard }, null, 2)
  );

  const scaleText = ((manifest.pages[0] && manifest.pages[0].scales) || [2, 3])
    .map((s) => `@${s}x`)
    .join(" + ");
  const lines = [
    `# ${manifest.sector || "蓝湖"} 切图导出`,
    "",
    `- 项目：${manifest.project?.name || ""} \`${manifest.project?.id || ""}\``,
    `- 分组：${manifest.sector || ""}`,
    `- 页面：${manifest.pages.length}，切图：${rows.length - 1}`,
    `- 切图：图层原图 \`images.png_xxxhd\` 生成 ${scaleText}，保留透明通道`,
    "",
    "| # | 页面 | 画布(px) | 切图数 |",
    "|---|------|----------|--------|",
    ...manifest.pages.map((p) => `| ${p.n} | ${p.name} | ${p.artboard.w}x${p.artboard.h} | ${p.assetCount} |`),
    "",
    "索引：`slices_index.csv`；重名/整画板：`duplicates_report.json`；每页明细：`slices/NN_页面/_index.json`。",
    "实现先读 `implementation.md`（多页共用样式、pt 布局、素材 ID/本地文件/父组文案）；按 id 查 `specs/*.json`，原始数据在 `layers/`。",
    "",
    "> 设计可能只覆盖部分页面/组件，且跨页可能有共享组件；不要默认全量接入。",
  ];
  await fs.writeFile(path.join(outDir, "README.md"), lines.join("\n") + "\n");
}

async function writeFullOverview(outDir, manifest, magickPath) {
  const files = [];
  for (const p of manifest.pages) {
    const f = path.join(outDir, p.fullImage);
    try {
      await fs.access(f);
      files.push("-label", `P${p.n} ${p.pageSizePt?.width ?? p.artboard.w}x${p.pageSizePt?.height ?? p.artboard.h}`, f);
    } catch (e) {}
  }
  if (!files.length) return null;
  const overviewFile = "_check/full_overview.png";
  await run(magickPath, [
      "montage",
      "-font", "Helvetica",
      "-pointsize", "14",
      "-background", "#1b1b1b",
      "-fill", "white",
      ...files,
      "-tile", `${Math.min(3, manifest.pages.length)}x`,
      "-geometry", "300x540+8+20",
      path.join(outDir, overviewFile),
    ]);
  return overviewFile;
}

/** 已有导出目录离线重建阅读清单/带 ID 预览，不重下素材。 */
export async function refreshImplementation(outDir, { magickPath = DEFAULT_MAGICK, montage = true } = {}) {
  const manifestFile = path.join(outDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  const pages = [];
  const previewErrors = [];
  await fs.mkdir(path.join(outDir, "_check", "pages"), { recursive: true });
  for (const page of manifest.pages) {
    let spec;
    if (page.specFile) {
      spec = JSON.parse(await fs.readFile(path.join(outDir, page.specFile), "utf8"));
    } else {
      const layer = JSON.parse(await fs.readFile(path.join(outDir, page.layerFile), "utf8"));
      spec = buildPageSpec(layer, {
        image: { id: page.id, name: page.name },
        assets: page.assets.map((a) => ({ ...a, files: Object.fromEntries(Object.entries(a.files).map(([s, f]) => [s, `${page.sliceDir}/${f}`])) })),
      });
    }
    page.previewFile = null;
    if (montage) {
      const previewFile = `_check/pages/${path.basename(page.sliceDir)}.png`;
      const inputs = page.assets.filter((a) => a.file).flatMap((a) => [
        "-label", `P${page.n}-${a.id}`, path.join(outDir, page.sliceDir, a.file),
      ]);
      try {
        if (inputs.length) {
          await run(magickPath, [
            "montage", "-font", "Helvetica", "-pointsize", "14",
            "-background", "#2b2440", "-fill", "white", ...inputs,
            "-tile", "5x", "-geometry", "128x128+8+12", path.join(outDir, previewFile),
          ]);
          page.previewFile = previewFile;
        }
      } catch (e) {
        previewErrors.push({ page: page.id, error: String(e).slice(0, 300) });
      }
    }
    pages.push({ ...page, specFile: page.specFile || page.layerFile, spec });
  }
  let overviewFile = null;
  if (montage) {
    try {
      overviewFile = await writeFullOverview(outDir, manifest, magickPath);
    } catch (e) {
      previewErrors.push({ page: "overview", error: String(e).slice(0, 300) });
    }
  }
  const implementationFile = "implementation.md";
  const guide = implementationGuide(pages);
  await fs.writeFile(path.join(outDir, implementationFile), guide);
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  return {
    implementationFile,
    implementationBytes: Buffer.byteLength(guide),
    overviewFile,
    assetPreviews: manifest.pages.map((p) => ({ page: p.n, file: p.previewFile })),
    previewErrors,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [outDir] = process.argv.slice(2);
  if (!outDir) throw new Error("Usage: node lanhu_export.mjs <existing-export-directory>");
  console.log(JSON.stringify(await refreshImplementation(outDir)));
}
