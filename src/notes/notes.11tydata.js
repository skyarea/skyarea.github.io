export default {
	layout: "note.html",
	permalink: "/notes/{{ page.fileSlug }}/index.html",
	eleventyComputed: {
		// 原样把 summary 交给 pageDesc：转义只在 layout 的渲染点上发生一次。
		// 若写成模板字符串 "{{ summary }}"，Nunjucks 会先转义一次、layout 再转一次，
		// 搜索结果里的描述会显示成字面的 &lt;b&gt;（实测过）。
		// JSON 数据文件放不了函数，所以这里用 .11tydata.js 而不是 notes.json。
		pageDesc: (data) => data.summary,
	},
};
