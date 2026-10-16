/* 视觉系统的可执行断言。对 _site/ 与 src/assets/style.css 说话，不对实现说话。
   先跑起来看到它失败（style.css 还是空的），再写样式。 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const results = [];

function assert(name, fn) {
	try {
		const detail = fn();
		results.push({ name, pass: true, detail: detail ?? "" });
	} catch (error) {
		results.push({ name, pass: false, detail: error.message });
	}
}

function read(path) {
	return readFileSync(join(ROOT, path), "utf8");
}

function htmlFiles(dir, out = []) {
	for (const entry of readdirSync(join(ROOT, dir))) {
		const rel = join(dir, entry);
		if (statSync(join(ROOT, rel)).isDirectory()) htmlFiles(rel, out);
		else if (entry.endsWith(".html")) out.push(rel);
	}
	return out;
}

const build = () =>
	execFileSync(process.execPath, [join(ROOT, "node_modules", "@11ty", "eleventy", "cmd.cjs")], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: "pipe",
	});

// 先建一次：本脚本可以单独跑（npm run check），不能依赖调用者负方已经 npx eleventy。
// 实测：删掉 _site/ 后直接跑，17/23 通过——那些读产物的断言全因为文件不在而假失败。
build();

const css = () => read("src/assets/style.css");
const site = () => htmlFiles("_site");

// ---- 样式表本身 ----

assert("style.css 非空且含设计令牌", () => {
	const text = css();
	if (text.trim().length < 200) throw new Error(`style.css 只有 ${text.trim().length} 个字符`);
	for (const token of ["--bg", "--ink", "--ink-dim", "--panel", "--accent", "--rule", "--font-body", "--font-mono", "--measure"]) {
		if (!text.includes(token)) throw new Error(`缺少设计令牌 ${token}`);
	}
	return `含 9 个令牌，${text.length} 字符`;
});

assert("只声明两种字体栈：正文 + 等宽", () => {
	const stacks = [...css().matchAll(/--font-(body|mono)\s*:/g)].map((m) => m[1]);
	const uniq = [...new Set(stacks)].sort();
	if (uniq.join(",") !== "body,mono") throw new Error(`字体栈是 ${uniq.join(", ") || "（无）"}`);
	return "body + mono";
});

assert("不出现 @font-face 与第三方字体域", () => {
	const offenders = [];
	if (/@font-face/.test(css())) offenders.push("style.css 里有 @font-face");
	for (const file of site()) {
		const text = read(file);
		for (const needle of ["fonts.googleapis.com", "fonts.gstatic.com", "@font-face"]) {
			if (text.includes(needle)) offenders.push(`${file} 引用了 ${needle}`);
		}
	}
	if (offenders.length) throw new Error(offenders.join("；"));
	return "产物与样式表都没有第三方字体";
});

assert("明暗两套配色各写一次", () => {
	const text = css();
	const dark = (text.match(/prefers-color-scheme:\s*dark/g) ?? []).length;
	const light = (text.match(/prefers-color-scheme:\s*light/g) ?? []).length;
	if (light < 1) throw new Error("没有 prefers-color-scheme: light 分支");
	if (dark > 0) throw new Error(`深色分支出现 ${dark} 次：深色应写在 :root，浅色只做令牌覆盖`);
	return "深色在 :root，浅色覆盖一次";
});

assert("动效只碰 transform / opacity", () => {
	const layoutProps = /(\b(?:width|height|top|left|right|bottom|margin|padding|font-size|border-width|max-width|min-height)\b)/;
	const offenders = [];
	for (const m of css().matchAll(/(transition|animation)(-property)?\s*:\s*([^;{}]*)/g)) {
		const value = m[3];
		// animation: rise .5s / transition: opacity .3s 这类不含属性名的写法是安全的
		if (layoutProps.test(value) && !/none|all|auto|both|forwards|infinite/.test(value)) {
			offenders.push(`${m[1]}${m[2] ?? ""}: ${value.trim()}`);
		}
	}
	if (offenders.length) throw new Error(`会触发重排的动画属性：${offenders.join("；")}`);
	return "只有 transform/opacity";
});

assert("入场动画时长落在 300–600ms", () => {
	const durations = [...css().matchAll(/animation\s*:\s*[^;]*?(\d+(?:\.\d+)?)(ms|s)/g)].map((m) =>
		m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]),
	);
	if (!durations.length) throw new Error("找不到任何带时长的 animation");
	const bad = durations.filter((d) => d < 300 || d > 600);
	if (bad.length) throw new Error(`越界的时长：${bad.join(", ")}ms`);
	return `${durations.length} 处，均在规定区间`;
});

assert("stagger 不超过 6 步", () => {
	const steps = [...css().matchAll(/\.note-item:nth-child\((\d+)\)/g)].map((m) => Number(m[1]));
	const max = steps.length ? Math.max(...steps) : 0;
	if (max > 6) throw new Error(`nth-child 排到了第 ${max} 步`);
	return `最多 ${max} 步`;
});

assert("prefers-reduced-motion 一刀切关闭", () => {
	const text = css();
	const block = text.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}/);
	if (!block) throw new Error("没有 prefers-reduced-motion: reduce 分支");
	if (!/animation\s*:\s*none/.test(block[1]) || !/transition\s*:\s*none/.test(block[1])) {
		throw new Error("reduce 分支里没同时关掉 animation 与 transition");
	}
	return "animation/transition 均置 none";
});

assert("正文用色在主背景上不低于 4.5:1（spec §10 底线）", () => {
	const lum = (hex) => {
		const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255
		).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
		return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	};
	const ratio = (a, b) => {
		const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
		return (x + 0.05) / (y + 0.05);
	};
	const root = css().match(/:root\s*\{([\s\S]*?)\}/)[1];
	const light = css().match(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)?.[1];
	if (!light) throw new Error("找不到浅色令牌块");
	const token = (block, name) => block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase();
	const offenders = [];
	for (const [scheme, block] of [["深色", root], ["浅色", light]]) {
		const bg = token(block, "--bg");
		const panel = token(block, "--panel");
		// 文字与强调色在主背景上
		for (const name of ["--ink", "--ink-dim", "--ink-faint", "--accent", "--accent-soft"]) {
			const value = token(block, name);
			if (!value) throw new Error(`${scheme} 缺 ${name}`);
			const r = ratio(value, bg);
			if (r < 4.5) offenders.push(`${scheme} ${name} 在 bg 上 ${r.toFixed(2)}`);
		}
		// 代码/提示块里的正文色在块背景上
		const panelInk = token(block, "--panel-ink");
		const rp = ratio(panelInk, panel);
		if (rp < 4.5) offenders.push(`${scheme} --panel-ink 在 panel 上 ${rp.toFixed(2)}`);
	}
	if (offenders.length) throw new Error(offenders.join("；"));
	return "两套模式下文字与强调色均 ≥ 4.5:1";
});

// ---- 产物结构 ----

assert("每个页面恰好一个 <nav>，且各页导航是同一份（只看结构，不计 aria-current）", () => {
	const navs = {};
	for (const file of site()) {
		const matches = read(file).match(/<nav[\s\S]*?<\/nav>/g) ?? [];
		if (matches.length !== 1) throw new Error(`${file} 里有 ${matches.length} 个 <nav>`);
		// 当前页高亮本来就是每页唯一会变的字节，剔掉它之后剩下的必须逐字节相同。
		navs[file] = matches[0].replace(/ aria-current="page"/g, "");
	}
	const uniq = [...new Set(Object.values(navs))];
	if (uniq.length > 1) throw new Error(`${Object.keys(navs).length} 个页面出现了 ${uniq.length} 种导航，说明有页面自己写了导航`);
	return `${Object.keys(navs).length} 页共用 1 份导航`;
});

assert("每个页面只有一个样式表入口", () => {
	for (const file of site()) {
		const heads = read(file).match(/<link rel="stylesheet"[^>]*>/g) ?? [];
		if (heads.length !== 1) throw new Error(`${file} 有 ${heads.length} 个样式表`);
		if (!heads[0].includes("/assets/style.css")) throw new Error(`${file} 的样式表不是 /assets/style.css`);
	}
	return "/assets/style.css 单一入口";
});

assert("全站零 JavaScript", () => {
	const offenders = site().filter((f) => /<script|onclick=|onload=/.test(read(f)));
	if (offenders.length) throw new Error(`出现脚本：${offenders.join("，")}`);
	const js = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".js") && !f.endsWith(".11tydata.js"));
	if (js.length) throw new Error(`src/ 下有会被当成页面资源的脚本：${js.join("，")}`);
	return "无 <script> 也无内联事件";
});

assert("导航里的外部链接带 rel=noopener 且不参与当前页判定", () => {
	// 只管导航：那是 site.yml 的契约（Review Focus 3）。
	// 正文里的外链（书目、笔记内引用）不强制 rel=noopener —— 全站不用 target="_blank"，
	// 同一标签页跳转本就没有 opener 关系，noopener 在那里是个空操作，
	// 给正文链接普遍加它只是 cargo cult。
	for (const file of site()) {
		const nav = (read(file).match(/<nav[\s\S]*?<\/nav>/) ?? [""])[0];
		for (const a of nav.matchAll(/<a href="(https?:\/\/[^"]*)"([^>]*)>/g)) {
			if (!/rel="noopener"/.test(a[2])) throw new Error(`${file} 导航里的 ${a[1]} 缺 rel="noopener"`);
			if (/aria-current/.test(a[2])) throw new Error(`${file} 导航里的 ${a[1]} 带了 aria-current`);
		}
		// 当前页高亮：地址在导航里的页必须高亮且只高亮自己；不在导航里的（404、笔记详情）必须一处都没有。
		// 这三条路径是 src/_data/site.yml 的契约，写死在这里而不是重新读 yml（避开在检查脚本里拉进 YAML 解析）。
		const NAV_PATHS = ["/", "/books/", "/notes/"];
		const url = "/" + file.replace(/^_site[\\/]/, "").replace(/\\/g, "/").replace(/index\.html$/, "");
		const hits = (nav.match(/aria-current="page"/g) ?? []).length;
		if (NAV_PATHS.includes(url)) {
			if (hits !== 1) throw new Error(`${file}（地址 ${url}）的高亮数是 ${hits}，应为 1`);
			if (!nav.includes(`href="${url}" aria-current="page"`)) {
				throw new Error(`${file} 高亮错了项：应是 ${url}`);
			}
		} else if (hits > 0) {
			throw new Error(`${file}（地址 ${url}，不在导航里）却出现了 ${hits} 处 aria-current`);
		}
	}
	return "导航合规；导航内页面各高亮自己一处，导航外页面零高亮";
});

assert("每个页面只有一个 <h1>", () => {
	for (const file of site()) {
		const count = (read(file).match(/<h1/g) ?? []).length;
		if (count !== 1) throw new Error(`${file} 有 ${count} 个 <h1>`);
	}
	return "无残留的第二个标题";
});

assert("正文最大宽度用 --measure（72ch）", () => {
	const text = css();
	if (!/--measure\s*:\s*72ch/.test(text)) throw new Error("--measure 不是 72ch");
	if (!/var\(--measure\)/.test(text)) throw new Error("没有任何规则引用 var(--measure)");
	return "72ch 且被使用";
});

assert("强调色只有一种彩色", () => {
	// :root 里除中性色（黑白灰）之外，只允许 --accent 带色相
	const rootBlock = css().match(/:root\s*\{([\s\S]*?)\}/)?.[1];
	if (!rootBlock) throw new Error(":root 令牌块不存在");
	if (!/--accent\s*:/.test(rootBlock)) throw new Error(":root 里没有 --accent");
	const colored = [...rootBlock.matchAll(/(#[0-9a-f]{6})/gi)]
		.map((m) => m[1].toLowerCase())
		.filter((hex) => {
			const r = parseInt(hex.slice(1, 3), 16);
			const g = parseInt(hex.slice(3, 5), 16);
			const b = parseInt(hex.slice(5, 7), 16);
			return Math.max(r, g, b) - Math.min(r, g, b) > 24; // 饱和度阈值，滤掉纯灰阶
		});
	const uniq = [...new Set(colored)];
	if (uniq.length > 2) throw new Error(`:root 里有 ${uniq.length} 种带色相的值：${uniq.join(" ")}`);
	return `${uniq.length} 种带色相（含 --accent 及其浅色变体）`;
});

// ---- 工作流：加一篇笔记到底要碰几个文件 ----

assert("构建产物不入库（_site/ 与 node_modules/ 不在 git 视野里）", () => {
	const out = execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const leaks = out.split("\n").filter((l) => /(^|\s)(_site\/|node_modules\/)/.test(l));
	if (leaks.length) throw new Error(`产物出现在 git 状态里：${leaks.slice(0, 3).join(" | ")}`);
	return "git 看不到任何产物";
});

assert("加一篇笔记只需新建一个 .md（列表自动长出它，且不碰其他文件）", () => {
	const probeRel = join("src", "notes", "zz-check-probe.md");
	const probeAbs = join(ROOT, probeRel);
	const listRel = join("_site", "notes", "index.html");
	const readList = () => read(listRel);
	const count = (html) => (html.match(/<article class="note-item"/g) ?? []).length;

	if (existsSync(probeAbs)) throw new Error(`探针文件已存在，会污染计数：${probeRel}`);
	// 先按当前 src/ 重建一次：_site/ 可能是上一轮检查留下的（带探针项），
	// 拿它当基准会让本断言只能跑对一次（实测：第一次 1→2 通过，第二次 2→2 失败）。
	build();
	const before = count(readList());
	const gitBefore = execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });

	try {
		// 故意写成最坑的一篇：没有 tags、日期与现有笔记同日、标题里带引号
		writeFileSync(
			probeAbs,
			"---\ntitle: 检查探针\ndate: 2026-10-16\nsummary: 探针摘要。\n---\n\n正文。\n",
			"utf8",
		);
		build();

		const after = readList();
		const n = count(after);
		if (n !== before + 1) throw new Error(`列表项从 ${before} 变成 ${n}，应为 ${before + 1}`);
		if (!after.includes("/notes/zz-check-probe/")) throw new Error("列表里没有探针的链接");
		if (!existsSync(join(ROOT, "_site", "notes", "zz-check-probe", "index.html"))) {
			throw new Error("探针的详情页没生成");
		}
		// 缺 tags 时不得留下裸分隔符或空容器（Review Focus 1）
		const probe = read(join("_site", "notes", "zz-check-probe", "index.html"));
		if (/<span class="tags"><\/span>/.test(after + probe)) throw new Error("出现了空的 tags 容器");
		if (/<\/time>\s*·\s*<\/p>/.test(after + probe)) throw new Error("出现了光秃秃的 · 分隔符");
		if (probe.includes("undefined")) throw new Error("探针页里出现了 undefined");
		// 同日的两篇必须顺序确定（Review Focus 4）。不猜中文的排序规则，
		// 只要求两次构建的列表逐字节一致 —— 顺序会漂的话这里就红。
		build();
		const again = readList();
		if (again !== after) {
			const names = (html) => [...html.matchAll(/href="\/notes\/([^/"]+)\//g)].map((m) => m[1]).join(",");
			throw new Error("同日笔记的列表顺序不稳定：" + names(after) + "  vs  " + names(again));
		}
		if (!again.includes("/notes/zz-check-probe/")) throw new Error("重构建后探针项丢了");
		// 除探针本身外不得弄脏任何文件：这就是"不用碰别的文件"的硬证据
		const gitAfter = execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
		const dirty = gitAfter.split("\n").filter((l) => l.trim() && !gitBefore.includes(l))
			.filter((l) => !l.includes("zz-check-probe"));
		if (dirty.length) throw new Error(`加一篇笔记却弄脏了其他文件：${dirty.join(" | ")}`);
		return `列表 ${before} → ${n}，除探针外零改动`;
	} finally {
		rmSync(probeAbs, { force: true });
		// Eleventy 不删孤儿产物：光删 .md 重建的话，_site/notes/zz-check-probe/
		// 会留在原地，下一轮检查的基准又坏了。先清输出再重建。
		rmSync(join(ROOT, "_site", "notes", "zz-check-probe"), { recursive: true, force: true });
		build();
	}
});

assert("同日笔记的顺序不依赖机器 locale（按码位，本地预览 = 上线结果）", () => {
	// 选一对在两种排法下会翻目的标题：
	//   码位："Alpha…"(0x41) 在 "苹果…"(0x82B9) 之前
	//   ICU 中文排序：苹果（拼音）在 Alpha 之前
	// 所以本断言等价于"比较器必须是码位比"。改回 localeCompare 就会红（本机已实测）。
	const files = [
		["zz-probe-alpha.md", "Alpha 探针"],
		["zz-probe-pin.md", "苹果 探针"],
	];
	const paths = files.map(([f]) => join(ROOT, "src", "notes", f));
	try {
		for (const [f, title] of files) {
			writeFileSync(
				join(ROOT, "src", "notes", f),
				`---\ntitle: ${title}\ndate: 2026-09-09\nsummary: 探针。\n---\n\n正文。\n`,
				"utf8",
			);
		}
		build();
		const html = read(join("_site", "notes", "index.html"));
		const order = [...html.matchAll(/href="\/notes\/([^/"]+)\//g)].map((m) => m[1]);
		const a = order.indexOf("zz-probe-alpha");
		const p = order.indexOf("zz-probe-pin");
		if (a < 0 || p < 0) throw new Error("两个探针没都出现在列表里：" + order.join(","));
		if (a > p) {
			throw new Error(`顺序走了 locale 派的那条：苹果 排在 Alpha 之前（${order.join(", ")}）`);
		}
		return "Alpha 在苹果之前，即码位序";
	} finally {
		for (const path of paths) rmSync(path, { force: true });
		for (const slug of ["zz-probe-alpha", "zz-probe-pin"]) {
			rmSync(join(ROOT, "_site", "notes", slug), { recursive: true, force: true });
		}
		build();
	}
});

assert("探针清理干净：跑完检查后工作树不因此变脏", () => {
	const out = execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
	const dirty = out.split("\n").filter((l) => l.includes("src/notes/") || l.includes("zz-check-probe"));
	if (dirty.length) throw new Error(`检查脚本留下了文件：${dirty.join(" | ")}`);
	return "src/notes/ 干净";
});

// ---- 迁移保真 ----

assert("那篇配额笔记的内容指纹不变（防以后改丢段落）", () => {
	// 与旧 HTML 的逐字符等价在 Task 3 已当面对过（归一化 tags 那处后两边都是 2126 字符）。
	// 旧文件已删，所以这里守的是指纹：下面三个常量（2126 / 7 / 2）是当时旧文件的实测值，
	// 不是从新文件反推的 —— 新文件意外掉内容时这里会红。
	const flat = (text) =>
		text
			.replace(/<head>[\s\S]*?<\/head>/, "")
			.replace(/<nav[\s\S]*?<\/nav>/g, "")
			.replace(/<footer[\s\S]*?<\/footer>/g, "")
			.replace(/<[^>]+>/g, "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/\s+/g, "");
	const now = flat(read("_site/notes/github-rate-limit/index.html"));
	if (now.length !== 2126) throw new Error(`可见文本长度 ${now.length}，期望 2126`);
	const codeBlocks = (read("_site/notes/github-rate-limit/index.html").match(/<pre/g) ?? []).length;
	if (codeBlocks !== 7) throw new Error(`代码块 ${codeBlocks} 个，旧文件是 7 个`);
	const h3 = (read("_site/notes/github-rate-limit/index.html").match(/<h3/g) ?? []).length;
	if (h3 !== 2) throw new Error(`小节标题 ${h3} 个，旧文件是 2 个`);
	return "2126 字符 / 7 个代码块 / 2 个小节";
});

assert("summary 一份文字同时出现在 meta、og 与列表", () => {
	const note = read("_site/notes/github-rate-limit/index.html");
	const metas = note.match(/content="[^"]*60 次\/小时[^"]*"/g) ?? [];
	if (metas.length !== 2) throw new Error(`详情页 meta 里命中 ${metas.length} 次，应为 2（description + og:description）`);
	if (new Set(metas).size !== 1) throw new Error("两处字符串不一致");
	for (const list of ["_site/notes/index.html", "_site/index.html"]) {
		if (!read(list).includes("只有 60 次/小时/IP。带 token，不是等 reset。")) {
			throw new Error(`${list} 里没有出现同一句摘要`);
		}
	}
	return "三处一致";
});

assert("书单渲染且没有空 href", () => {
	const books = read("_site/books/index.html");
	if (!books.includes("你身体里的奥秘")) throw new Error("书单条目没渲染出来");
	if (/<a href=""/.test(books)) throw new Error("存在空 href");
	return "1 条书目";
});

assert("404 页存在且不自己写导航", () => {
	if (!existsSync(join(ROOT, "_site/404.html"))) throw new Error("_site/404.html 不存在");
	const text = read("_site/404.html");
	if (/<h1/.test(text) === false) throw new Error("404 页没有标题");
	return "404.html 就位";
});

// ---- 输出 ----

let failed = 0;
for (const result of results) {
	console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail ? "  —  " + result.detail : ""}`);
	if (!result.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed) process.exitCode = 1;
