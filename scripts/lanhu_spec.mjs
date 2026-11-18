/**
 * 蓝湖设计稿精确取值：图层 bounds / 文字样式 / 填充与渐变 / 切图像素颜色。
 *
 * 配合 lanhu_nav.mjs 使用（同一个技能目录）：
 *   const spec = await import(
 *     "file://" + process.env.HOME + "/.agents/skills/lanhu/scripts/lanhu_spec.mjs"
 *   );
 *
 * 原则：不要目测。按钮尺寸取 node.width/height；文字颜色取 textInfo.color；
 * 字号取 textInfo.size（px，除以 sliceScale 得 pt）；渐变优先取 gradientFill，
 * 没有矢量渐变时对 images.png_xxxhd 采样。
 */

import https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { getImageInfo } from "./lanhu_nav.mjs";

const execFileAsync = promisify(execFile);
const MAGICK = "/opt/homebrew/bin/magick";

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
}

function hex2(n) {
  return clampByte(n).toString(16).padStart(2, "0").toUpperCase();
}

function colorHex(c) {
  if (!c) return null;
  const r = c.r ?? c.red;
  const g = c.g ?? c.green;
  const b = c.b ?? c.blue;
  if (r == null && g == null && b == null) return null;
  return "#" + hex2(r) + hex2(g) + hex2(b);
}

function scaleOf(layer) {
  return Number(layer && layer.sliceScale) || 2;
}

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
    req.setTimeout(20000, () => req.destroy(new Error(`timeout ${url}`)));
  });
}

async function magickIdentify(file) {
  const { stdout } = await execFileAsync(MAGICK, ["identify", "-format", "%w %h", file]);
  const [w, h] = stdout.trim().split(/\s+/).map(Number);
  return { w, h };
}

async function magickPixel(file, x, y) {
  const { stdout } = await execFileAsync(MAGICK, [
    file,
    "-format",
    `%[pixel:p{${Math.round(x)},${Math.round(y)}}]`,
    "info:",
  ]);
  return stdout.trim();
}

/**
 * 取图层 JSON 和 image 元数据。
 */
export async function getLayerJson(tab, { projectId, teamId, imageId }) {
  const info = await getImageInfo(tab, { projectId, teamId, imageId });
  if (!info.jsonUrl) throw new Error("getLayerJson: missing jsonUrl");
  const text = await tab.playwright.evaluate(async (url) => {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  }, info.jsonUrl);
  return { info, layer: JSON.parse(text) };
}

/**
 * 深度遍历图层树，visitor(node, parents)。
 */
export function walkLayers(layer, visitor) {
  const roots = (layer && layer.board && layer.board.layers) || [];
  const walk = (node, parents) => {
    if (!node) return;
    visitor(node, parents);
    (node.layers || []).forEach((child) => walk(child, parents.concat([node])));
  };
  roots.forEach((root) => walk(root, []));
}

/**
 * 按 name / text / type 找图层，返回 [{node, parents}]。
 */
export function findLayers(layer, { name, text, type } = {}) {
  const out = [];
  walkLayers(layer, (node, parents) => {
    if (name && String(node.name || "") !== String(name)) return;
    if (text) {
      const t = (node.textInfo && node.textInfo.text) || "";
      if (!String(t).includes(String(text))) return;
    }
    if (type && node.type !== type) return;
    out.push({ node, parents });
  });
  return out;
}

/**
 * 文字样式：颜色、字号、字体、对齐。
 * 颜色来源：textInfo.color（r/g/b），个别文件在 textStyleRange[].textStyle.color（red/green/blue）。
 */
export function textSpec(node, layer) {
  const s = scaleOf(layer);
  const ti = (node && node.textInfo) || {};
  const styleColor =
    ti.color ||
    (ti.textStyleRange && ti.textStyleRange[0] && ti.textStyleRange[0].textStyle
      ? ti.textStyleRange[0].textStyle.color
      : null);
  return {
    text: ti.text || "",
    color: colorHex(styleColor),
    colorRGB: styleColor
      ? [styleColor.r ?? styleColor.red, styleColor.g ?? styleColor.green, styleColor.b ?? styleColor.blue]
      : null,
    sizePx: ti.size ?? null,
    sizePt: ti.size != null ? ti.size / s : null,
    font: ti.fontPostScriptName || ti.fontName || null,
    fontStyle: ti.fontStyleName || null,
    justification: ti.justification || null,
    widthPx: node.width,
    heightPx: node.height,
    widthPt: node.width != null ? node.width / s : null,
    heightPt: node.height != null ? node.height / s : null,
  };
}

/**
 * 图层尺寸/位置（px 与 pt）。
 */
export function layerSpec(node, layer) {
  const s = scaleOf(layer);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    widthPx: node.width,
    heightPx: node.height,
    widthPt: node.width != null ? node.width / s : null,
    heightPt: node.height != null ? node.height / s : null,
    leftPx: node.left,
    topPx: node.top,
    leftPt: node.left != null ? node.left / s : null,
    topPt: node.top != null ? node.top / s : null,
    imageUrl: node.images?.png_xxxhd || node.images?.png_xxhd || node.images?.png_xhd || null,
    isSlice: !!node.isSlice,
    isAsset: !!node.isAsset,
  };
}

function parseGradient(gf) {
  if (!gf) return null;
  const gradient = gf.gradient || {};
  const stops = (gradient.colors || []).map((s) => ({
    color: colorHex(s.color),
    location: s.location,
    midpoint: s.midpoint,
  }));
  const transparency = (gradient.transparency || []).map((t) => ({
    opacity: t.opacity && t.opacity.value,
    location: t.location,
  }));
  return {
    type: gf.type || gradient.type || null,
    angle: gradient.angle ? gradient.angle.value : null,
    stops,
    transparency,
  };
}

/** 普通图层的绘制属性；缺失字段保留 null，不用截图颜色推断原始属性。 */
export function styleSpec(node, layer) {
  const s = scaleOf(layer);
  const stroke = node.strokeStyle;
  const components = node.path?.pathComponents || [];
  return {
    fill: node.fill || node.gradientFill
      ? {
          enabled: stroke?.fillEnabled ?? true,
          color: colorHex(node.fill?.color),
          gradient: parseGradient(node.gradientFill),
        }
      : null,
    opacity: node.blendOptions?.opacity?.value ?? null,
    fillOpacity: node.blendOptions?.fillOpacity?.value ?? null,
    blendMode: node.blendOptions?.mode ?? null,
    stroke: stroke
      ? {
          enabled: stroke.strokeEnabled ?? null,
          widthPx: stroke.strokeStyleLineWidth ?? null,
          widthPt: stroke.strokeStyleLineWidth != null ? stroke.strokeStyleLineWidth / s : null,
          color: colorHex(stroke.strokeStyleContent?.color),
          opacity: stroke.strokeStyleOpacity?.value ?? null,
          alignment: stroke.strokeStyleLineAlignment ?? null,
          gradient: parseGradient(stroke.strokeStyleContent?.gradientFill),
        }
      : null,
    shapes: components.map((c) => ({
      type: c.origin?.type ?? null,
      operation: c.shapeOperation ?? null,
      radiiPx: c.origin?.radii ?? null,
      radiiPt: c.origin?.radii?.map((r) => r / s) ?? null,
    })),
    effects: node.layerEffects ?? null,
    clipped: !!node.clipped,
    isClippingMask: !!node.isClippingMask,
  };
}

/**
 * 从 node.sliceBackData 里提取 fill / gradientFill。
 * 注意：不是所有切图都会把渐变保存在 layer JSON；烘焙成图片时这里只有 solid fill 或为空。
 */
export function fillsFromSlice(node) {
  if (!node || !node.sliceBackData) return [];
  let data;
  try {
    data = JSON.parse(node.sliceBackData);
  } catch (e) {
    return [];
  }
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.gradientFill) {
      out.push({
        name: n.name,
        type: n.type,
        bounds: n.bounds,
        kind: "gradient",
        gradient: parseGradient(n.gradientFill),
      });
    } else if (n.fill) {
      out.push({
        name: n.name,
        type: n.type,
        bounds: n.bounds,
        kind: "fill",
        color: colorHex(n.fill.color),
      });
    }
    (n.layers || []).forEach(walk);
  };
  (Array.isArray(data) ? data : [data]).forEach(walk);
  return out;
}

function parseRgba(text) {
  const m = String(text).match(/rgba?\(([^)]+)\)/i);
  if (!m) return { raw: text, hex: null };
  const parts = m[1].split(",").map((x) => x.trim());
  const [r, g, b] = parts.slice(0, 3).map(Number);
  const a = parts[3] != null ? Number(parts[3]) : 1;
  return { raw: text, hex: "#" + hex2(r) + hex2(g) + hex2(b), rgb: [r, g, b], alpha: a };
}

/**
 * 对切图 assets 做像素采样。
 * samples: [{x,y}]（像素坐标）或 [{u,v}]（0..1 归一化坐标）；默认按钮中线上三个点。
 */
export async function sampleAssetColors(nodeOrUrl, samples) {
  const url =
    typeof nodeOrUrl === "string"
      ? nodeOrUrl
      : nodeOrUrl && nodeOrUrl.images && nodeOrUrl.images.png_xxxhd;
  if (!url) throw new Error("sampleAssetColors: missing png_xxxhd url");
  const buf = await download(url);
  const tmp = path.join(os.tmpdir(), `lanhu_spec_${process.pid}_${Date.now()}.png`);
  await fs.writeFile(tmp, buf);
  try {
    const size = await magickIdentify(tmp);
    const list =
      samples && samples.length
        ? samples
        : [
            { u: 0.1, v: 0.75 },
            { u: 0.5, v: 0.75 },
            { u: 0.9, v: 0.75 },
          ];
    const out = [];
    for (const s of list) {
      const x = s.x != null ? s.x : Math.round((s.u != null ? s.u : 0.5) * size.w);
      const y = s.y != null ? s.y : Math.round((s.v != null ? s.v : 0.5) * size.h);
      const raw = await magickPixel(tmp, x, y);
      out.push({ x, y, ...parseRgba(raw) });
    }
    return { size, samples: out };
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/**
 * 一次性检查图层：尺寸/位置、文字样式、slice 内的 fill/渐变、切图像素颜色。
 */
export async function inspectLayer(tab, opts) {
  const { projectId, teamId, imageId, name, text, type, samples } = opts;
  const { info, layer } = await getLayerJson(tab, { projectId, teamId, imageId });
  const found = findLayers(layer, { name, text, type });
  const items = [];
  for (const { node, parents } of found) {
    const spec = layerSpec(node, layer);
    const item = {
      spec,
      text: node.textInfo ? textSpec(node, layer) : null,
      fills: fillsFromSlice(node),
      style: styleSpec(node, layer),
      parents: parents.map((p) => layerSpec(p, layer)),
    };
    if (spec.imageUrl) {
      try {
        item.colors = await sampleAssetColors(node, samples);
      } catch (e) {
        item.colorsError = String(e).slice(0, 200);
      }
    }
    items.push(item);
  }
  return { image: info, sliceScale: scaleOf(layer), items };
}

/**
 * 直接给一张详情页（imageId），导出整页所有图层元素。
 * 不需要搜索；后续 UI 还原可以只吃这一份 JSON。
 *
 * 返回每个元素：
 *   id/name/type/parentPath/depth
 *   widthPx/heightPx/widthPt/heightPt/leftPx/topPx/leftPt/topPt
 *   text（textLayer 才有：颜色/字号/字体/对齐）
 *   fills（有 sliceBackData 的节点：solid fill / gradientFill）
 *   imageUrl（isSlice/isAsset 的 png_xxxhd）
 */
export function buildPageSpec(layer, opts = {}) {
  const {
    image = null,
    assets = [],
    visibleOnly = true,
    maxDepth = Infinity,
    includeFills = true,
  } = opts;
  const s = scaleOf(layer);
  const elements = [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const roots = (layer.board && layer.board.layers) || [];

  const walk = (node, parents, depth, parentVisible = true, assetOwnerId = null) => {
    if (!node) return;
    const visible = parentVisible && node.visible !== false;
    if (!visibleOnly || visible) {
      const spec = layerSpec(node, layer);
      const element = {
        ...spec,
        visible,
        depth,
        parentId: parents.at(-1)?.id ?? null,
        parentPath: parents.map((p) => p.name).join(" / "),
        assetOwnerId,
        style: styleSpec(node, layer),
        asset: assetById.get(node.id) ?? null,
      };
      if (node.textInfo) element.text = textSpec(node, layer);
      if (includeFills && node.sliceBackData) element.fills = fillsFromSlice(node);
      elements.push(element);
    }
    if (depth < maxDepth) {
      const imageUrl = node.images?.png_xxxhd || node.images?.png_xxhd || node.images?.png_xhd;
      const owner = assetOwnerId ?? (imageUrl ? node.id : null);
      (node.layers || []).forEach((child) => walk(child, parents.concat([node]), depth + 1, visible, owner));
    }
  };

  roots.forEach((root) => walk(root, [], 0));

  return {
    image,
    sliceScale: s,
    device: layer.device || null,
    artboard: (layer.board && layer.board.artboard && layer.board.artboard.artboardRect) || null,
    pageSizePt: layer.board?.artboard?.artboardRect
      ? {
          width: (layer.board.artboard.artboardRect.right - layer.board.artboard.artboardRect.left) / s,
          height: (layer.board.artboard.artboardRect.bottom - layer.board.artboard.artboardRect.top) / s,
        }
      : null,
    units: {
      frame: "leftPt/topPt/widthPt/heightPt are page coordinates in pt; do not divide again",
      shape: "radiiPt and stroke.widthPt are pt; radiiPx and widthPx are design pixels",
      opacity: "opacity/fillOpacity/stroke.opacity use 0..100; null means unspecified, not zero",
      effects: "effects retain original JSON units and composition; not flattened appearance",
    },
    count: elements.length,
    elements,
  };
}

export async function inspectPage(tab, opts = {}) {
  const { info, layer } = await getLayerJson(tab, opts);
  return buildPageSpec(layer, { ...opts, image: info });
}

/** 模型优先读的实现摘要；位图内部已烘焙的子图层不重复实现。 */
export function pageSummary(result) {
  return {
    image: result.image ? { id: result.image.id, name: result.image.name } : null,
    pageSizePt: result.pageSizePt,
    sliceScale: result.sliceScale,
    units: result.units,
    elements: result.elements.filter((e) => e.assetOwnerId == null).map((e) => {
      const element = {
        id: e.id,
        name: e.name,
        type: e.type,
        parentId: e.parentId,
        visible: e.visible,
        framePt: [e.leftPt, e.topPt, e.widthPt, e.heightPt],
        render: e.imageUrl ? "image" : "layers",
      };
      if (e.text) {
        element.text = {
          text: e.text.text,
          sizePt: e.text.sizePt,
          color: e.text.color,
          font: e.text.font,
          justification: e.text.justification,
        };
      }
      if (e.imageUrl) {
        element.asset = e.asset;
        if (!e.asset || !Object.keys(e.asset.files).length) element.imageUrl = e.imageUrl;
      } else {
        // 摘要省略未指定属性，完整规格仍保留 null 与原始效果字段。
        element.style = Object.fromEntries(Object.entries(e.style).filter(([key, value]) => {
          if (key === "clipped" || key === "isClippingMask") return value;
          return value != null && (!Array.isArray(value) || value.length > 0);
        }));
      }
      return element;
    }),
  };
}

/** 多页实现清单：共享样式去重，一行一个元素；保留完整规格供定点追溯。 */
export function implementationGuide(pages) {
  const styles = [];
  const styleIds = new Map();
  const sections = [];
  for (const page of pages) {
    const summary = pageSummary(page.spec);
    const byId = new Map(summary.elements.map((e) => [e.id, e]));
    const textByParent = new Map();
    for (const e of summary.elements.filter((e) => e.text)) {
      let parent = e.parentId;
      while (parent != null) {
        if (!textByParent.has(parent)) textByParent.set(parent, []);
        textByParent.get(parent).push(e.text.text);
        parent = byId.get(parent)?.parentId;
      }
    }
    const rows = [];
    const assets = [];
    for (const e of summary.elements) {
      const style = { ...e.style };
      if (e.text) {
        const { text, ...textStyle } = e.text;
        style.text = textStyle;
      }
      const serialized = JSON.stringify(style);
      if (!styleIds.has(serialized)) {
        styleIds.set(serialized, `S${styles.length + 1}`);
        styles.push(style);
      }
      const key = e.render === "image" ? `P${page.n}-${e.id}` : null;
      rows.push([e.id, e.parentId, e.name, e.framePt, styleIds.get(serialized), key, e.text?.text ?? null]);
      if (key) {
        let parent = e.parentId;
        let context = [];
        while (parent != null) {
          const texts = textByParent.get(parent) || [];
          if (texts.length) {
            // 大范围容器的全部文案不代表该图标的用途；只给最近局部组的关联证据。
            if (texts.length <= 3) context = texts;
            break;
          }
          parent = byId.get(parent)?.parentId;
        }
        const files = e.asset?.files || {};
        assets.push([key, Object.fromEntries(Object.entries(files).map(([scale, file]) => [scale, path.basename(file)])), context, e.asset?.source ?? null, e.asset?.note ?? null]);
      }
    }
    sections.push([
      `## P${page.n} ${page.name.trim()}`,
      `sizePt=${JSON.stringify(summary.pageSizePt)}; sliceDir=${page.sliceDir}; fullSpec=${page.specFile}`,
      `资产预览=${page.previewFile || "未生成"}; 原图=${page.fullImage}`,
      "元素列 [id,parentId,name,[x,y,w,h]pt,style,assetKey,text]，顺序保持 JSON 层顺序：",
      "```jsonl", ...rows.map((r) => JSON.stringify(r)), "```",
      "素材列 [assetKey,倍率文件名,同一局部父组的文案,source,note]。文件名相对本页 sliceDir：",
      "```jsonl", ...assets.map((a) => JSON.stringify(a)), "```",
    ].join("\n"));
  }
  return [
    "# 蓝湖实现清单",
    "两页/多页一起读本文件。布局已是 pt，不要重复除倍率；null=未指定。S 样式跨页共享，P前缀素材键与预览标签一致。",
    "按 JSON 父组绑定素材与文字；局部文案是层级证据，不是图片内容识别结果。不要凭图标语义交换设计位置。",
    "完整样式、裁剪和混合关系在 fullSpec；此处 parentId 用于追溯关系，不改变整页坐标。用运行截图核对组合效果。",
    "## 共享样式（颜色、字体、圆角、描边、效果）",
    "```jsonl", ...styles.map((s, i) => JSON.stringify([`S${i + 1}`, s])), "```",
    ...sections,
  ].join("\n\n") + "\n";
}

export async function writePageSpec(layer, opts = {}) {
  const { outFile, summaryFile = outFile ? outFile.replace(/\.json$/, "") + ".summary.json" : null } = opts;
  const result = buildPageSpec(layer, opts);
  if (outFile) await fs.writeFile(outFile, JSON.stringify(result, null, 2));
  if (summaryFile) await fs.writeFile(summaryFile, JSON.stringify(pageSummary(result), null, 2));
  return {
    outFile: outFile || null,
    summaryFile,
    image: result.image,
    sliceScale: result.sliceScale,
    pageSizePt: result.pageSizePt,
    count: result.count,
  };
}

/**
 * inspectPage 并把完整结果写到本地 JSON，方便离线做 UI 还原。
 */
export async function dumpPageSpec(tab, opts = {}) {
  const { info, layer } = await getLayerJson(tab, opts);
  return writePageSpec(layer, { ...opts, image: info });
}

// 已有 layers/*.json 时离线生成规格，避免重新访问蓝湖。
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [layerFile, outFile] = process.argv.slice(2);
  if (!layerFile || !outFile) throw new Error("Usage: node lanhu_spec.mjs <layer.json> <spec.json>");
  const layer = JSON.parse(await fs.readFile(layerFile, "utf8"));
  console.log(JSON.stringify(await writePageSpec(layer, { outFile })));
}
