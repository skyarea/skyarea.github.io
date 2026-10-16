/**
 * Eleventy 配置。输入 src/，输出 _site/，全站样板在 src/_includes/。
 * 站点是 GitHub Pages 用户站点，发布在根路径，所以 pathPrefix 保持默认 "/"。
 */
export default function (eleventyConfig) {
	// 默认即 true：_site/ 与 node_modules/ 已在 .gitignore，不会被当成模板重复构建。
	eleventyConfig.setUseGitIgnore(true);

	// 笔记正文要能内嵌原生 HTML（提示块 .key 这类结构在标准 Markdown 里没有对应写法）。
	// Eleventy 的 Markdown 引擎本来就默认 html: true（见其内部 Markdown.js），
	// 所以这里不覆盖 setLibrary：少一处和 Eleventy 默认值打架的地方。

	return {
		dir: {
			input: "src",
			output: "_site",
			includes: "_includes",
			data: "_data",
		},
		// v3 里模板引擎的键是扩展名形式 "njk"（v2 的 "11ty.nunjucks" 写法已不适用）。
		htmlTemplateEngine: "njk",
		markdownTemplateEngine: "njk",
	};
}
