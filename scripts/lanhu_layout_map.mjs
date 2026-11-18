/**
 * 从蓝湖导出规格生成 layout_map.md：给模型直接消费的布局树 + 素材表 + 多页状态差异。
 *
 * 目的：元素表是扁平的 z-order 列表，模型要花大量推理把 70~200 行还原成屏幕结构，
 * 还容易跳过表里的值去预览图上"量"坐标。这里用脚本一次生成缩进树和差异，坐标只以本文件为准。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pageSummary } from "./lanhu_spec.mjs";

const DIFF_EPS = 0.5; // pt，小于此值视为噪声

const num = (v) => {
  if (v == null) return "?";
  if (typeof v !== "number") return String(v);
  return String(+v.toFixed(2));
};

const frameOf = (e) => {
  const f = e.framePt;
  if (!f || f.some((v) => v == null)) return null;
  return f;
};

const labelOf = (e) => String(e.name == null ? "" : e.name).trim();

/** 同名兄弟用出现序号区分，避免多页配对时路径碰撞 */
function annotate(elements) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const occ = new Map();
  for (const e of elements) {
    const key = `${e.parentId}\u0000${labelOf(e)}`;
    occ.set(key, (occ.get(key) ?? -1) + 1);
    e._occ = occ.get(key);
    e._frame = frameOf(e);
  }
  for (const e of elements) {
    const names = [];
    let cur = e;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      let label = labelOf(cur);
      if (cur._occ) label += `#${cur._occ}`;
      names.push(label);
      cur = byId.get(cur.parentId);
    }
    e._path = names.reverse().join("/");
  }
  return elements;
}

const sortKey = (e) =>
  e._frame ? [0, e._frame[1], e._frame[0]] : [1, 0, e.id];

function fmtElement(e) {
  const head = e._frame
    ? `[${e.id}] (${num(e._frame[0])},${num(e._frame[1])} ${num(e._frame[2])}x${num(e._frame[3])}) ${labelOf(e)}`
    : `[${e.id}] (无几何) ${labelOf(e)}`;
  const extra = [];
  const text = e.text || {};
  if (text.text) {
    extra.push(`"${String(text.text).trim()}" ${num(text.sizePt)}pt ${text.color || ""} ${text.font || ""}`.trim());
  }
  if (e.asset && e.asset.id != null) extra.push(`asset:${e.asset.id}`);
  const style = e.style || {};
  const fill = style.fill || {};
  if (fill.color) extra.push(`fill:${fill.color}`);
  const radii = (style.shapes?.[0]?.radiiPt || []).filter((v) => v != null);
  if (radii.length) extra.push(`radius:${radii.map(num).join("/")}`);
  if (style.opacity != null) extra.push(`opacity:${num(style.opacity)}`);
  if (e.visible === false) extra.push("hidden");
  return extra.length ? `${head}  <- ${extra.join(" | ")}` : head;
}

function renderTree(elements, maxDepth) {
  const kids = new Map();
  for (const e of elements) {
    const key = e.parentId ?? "root";
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(e);
  }
  const lines = [];
  const walk = (parentId, depth) => {
    const list = (kids.get(parentId ?? "root") || []).slice().sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < 3; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });
    for (const e of list) {
      lines.push(`${"  ".repeat(depth)}${fmtElement(e)}`);
      if (depth + 1 < maxDepth && kids.has(e.id)) walk(e.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines;
}

function renderAssets(elements) {
  const rows = ["| id | 图层名 | pt 尺寸 | @2x px | @3x px | 文件 |", "|---|---|---|---|---|---|"];
  for (const e of elements.slice().sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < 3; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  })) {
    const asset = e.asset || {};
    if (asset.id == null) continue;
    const sizes = asset.sizes || {};
    const files = asset.files || {};
    const px = (key) => {
      const s = sizes[key] || {};
      return s.w ? `${s.w}x${s.h}` : "-";
    };
    const size = e._frame ? `${num(e._frame[2])}x${num(e._frame[3])}` : "-";
    const file = path.basename(String(files["2x"] || files.file || ""));
    rows.push(`| ${asset.id} | ${labelOf(e)} | ${size} | ${px("2x")} | ${px("3x")} | ${file} |`);
  }
  return rows;
}

function renderDiff(base, other) {
  const pa = new Map(base.els.map((e) => [e._path, e]));
  const pb = new Map(other.els.map((e) => [e._path, e]));
  const rows = [];
  let matched = 0;
  for (const [key, a] of pa) {
    const b = pb.get(key);
    if (!b) continue;
    matched += 1;
    const diffs = [];
    if (a._frame && b._frame) {
      if (a._frame.some((v, i) => Math.abs(v - b._frame[i]) > DIFF_EPS)) {
        diffs.push(
          `frame (${a._frame.map(num).join(",")}) -> (${b._frame.map(num).join(",")})`,
        );
      }
    }
    const ta = a.text || {};
    const tb = b.text || {};
    if (ta.color !== tb.color) diffs.push(`color ${ta.color} -> ${tb.color}`);
    if (ta.sizePt !== tb.sizePt) diffs.push(`size ${num(ta.sizePt)} -> ${num(tb.sizePt)}`);
    const fa = (a.style?.fill || {}).color;
    const fb = (b.style?.fill || {}).color;
    if (fa !== fb) diffs.push(`fill ${fa} -> ${fb}`);
    if (a.visible !== b.visible) diffs.push(`visible ${a.visible} -> ${b.visible}`);
    if (diffs.length) {
      rows.push(`- \`${key.split("/").pop() || key}\` [${a.id} -> ${b.id}] ${diffs.join(" ; ")}`);
    }
  }
  return { rows, matched };
}

/** 纯函数：pages 为 [{ n, name, spec }]（refreshImplementation 里的结构） */
export function buildLayoutMap(pages, { maxDepth = 3 } = {}) {
  const prepared = pages.map((page) => {
    const summary = pageSummary(page.spec);
    const els = annotate(summary.elements || []);
    const size = summary.pageSizePt || {};
    return {
      name: String(summary.image?.name || page.name || "").trim(),
      w: size.width,
      h: size.height,
      els,
    };
  });

  const out = ["# 布局图（脚本生成；坐标只以此为准，不要从图片测量或重算）", ""];
  for (const page of prepared) {
    out.push(`## ${page.name}  (${num(page.w)}x${num(page.h)} pt)`, "");
    out.push("```");
    out.push(...renderTree(page.els, maxDepth));
    out.push("```", "");
    const assets = renderAssets(page.els);
    if (assets.length > 2) {
      out.push(`### 素材清单 - ${page.name}`, "");
      out.push(...assets, "");
    }
  }

  if (prepared.length > 1) {
    out.push("## 多页差异（按祖先路径配对 = 状态差异）", "");
    for (let i = 0; i < prepared.length; i += 1) {
      for (let j = i + 1; j < prepared.length; j += 1) {
        const { rows, matched } = renderDiff(prepared[i], prepared[j]);
        out.push(`### ${prepared[i].name} -> ${prepared[j].name}  (结构相同元素 ${matched})`, "");
        out.push(...(rows.length ? rows : ["- 无几何/配色差异"]), "");
      }
    }
  }
  return `${out.join("\n")}\n`;
}

/** 写 <outDir>/layout_map.md，返回文件名 */
export async function writeLayoutMap(outDir, pages, opts = {}) {
  const content = buildLayoutMap(pages, opts);
  const file = "layout_map.md";
  await fs.writeFile(path.join(outDir, file), content);
  return file;
}
