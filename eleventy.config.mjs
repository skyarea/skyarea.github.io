import { load as parseYaml } from "js-yaml";

/**
 * Eleventy 配置。输入 src/，输出 _site/，全站样板在 src/_includes/。
 * 站点是 GitHub Pages 用户站点，发布在根路径，所以 pathPrefix 保持默认 "/"。
 */
export default function (eleventyConfig) {
	// Eleventy 3.1.7 的 _data 只认 json/js/mjs/cjs；YAML 数据文件要自己注册解析器。
	// js-yaml 显式写进 devDependencies，与 Eleventy 自带的那份去重成同一个副本。
	eleventyConfig.addDataExtension("yml,yaml", (contents) => parseYaml(contents));

	// 静态资源：passthrough 复制，不过模板引擎。
	eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
	eleventyConfig.addPassthroughCopy({ "src/favicon.svg": "favicon.svg" });

	// Eleventy 3.1.7 没有内置的 date/iso 过滤器（实测 filter not found），
	// 所以自己注册一个把日期渲染成 YYYY-MM-DD 的过滤器。
	eleventyConfig.addFilter("ymd", (value) => {
		if (value instanceof Date) {
			return value.toISOString().slice(0, 10);
		}
		return String(value).slice(0, 10);
	});

	// 笔记 collection：用 glob 注册，不在目录数据里写 tag: notes——
	// tags 已被占用为内容分类，写进去会让 "notes" 混进每篇笔记的标签数组并显示成 #notes。
	// 排序在这里做完（日期倒序，同日按标题正序），下游模板只遍历不再排。
	eleventyConfig.addCollection("notes", (collection) =>
		collection
			.getFilteredByGlob("src/notes/*.md")
			.sort((a, b) => {
				const da = a.data.date.getTime();
				const db = b.data.date.getTime();
				if (da !== db) {
					return db - da;
				}
				return String(a.data.title).localeCompare(String(b.data.title));
			}),
	);

	// 取前 N 条。首页"最近三篇"用它；Nunjucks 没有内置 limit（slice 是 Liquid 的）。
	eleventyConfig.addFilter("limit", (list, count) => Array.from(list ?? []).slice(0, count));

	// 笔记正文要能内嵌原生 HTML（提示块 .key 这类结构在标准 Markdown 里没有对应写法）。
	// Eleventy 的 Markdown 引擎本来就默认 html: true，这里不覆盖 setLibrary，
	// 少一处会和上游默认值漂移的地方。

	return {
		dir: {
			input: "src",
			output: "_site",
		},
		// v3 里模板引擎的键是扩展名形式 "njk"（v2 的 "11ty.nunjucks" 写法已不适用）。
		htmlTemplateEngine: "njk",
		markdownTemplateEngine: "njk",
	};
}
