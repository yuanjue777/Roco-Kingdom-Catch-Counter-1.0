/*
 * build.js —— 把 index.html + src/*.js 打成一个自包含的 HTML 片段。
 * 输出 dist/campus-m0.html，可以直接发布为 Artifact（不含 doctype/html/head/body 标签）。
 * 跑法：node build.js
 */
const fs = require('fs'), path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const grab = (tag) => {
  const m = html.match(new RegExp('<!--' + tag + '-->([\\s\\S]*?)<!--/' + tag + '-->'));
  if (!m) throw new Error('index.html 里找不到 ' + tag + ' 标记');
  return m[1].trim();
};
const style = grab('STYLE');
const content = grab('CONTENT');
const scriptBlock = grab('SCRIPTS');
const files = [...scriptBlock.matchAll(/src="(src\/[^"]+)"/g)].map(m => m[1]);
const code = files.map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const out = `<title>校园 M0 潜行原型</title>
${style}
${content}
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script>
${code}
<\/script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'campus-m0.html'), out);
console.log('已生成 dist/campus-m0.html  ' + (out.length / 1024).toFixed(0) + ' KB，内联 ' + files.length + ' 个源文件');

/* 完整单文件版：连 three.js 一起内联，双击即可运行，不需要联网也不需要本地服务器。
   发布为 Artifact 用上面那个片段版（CSP 放行 cdnjs，没必要把 600KB 库塞进页面）。 */
const three = fs.readFileSync(path.join(root, 'vendor', 'three.min.js'), 'utf8');
const standalone = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${style}
${html.match(/<title>[^<]*<\/title>/)[0]}
</head>
<body>
${content}
<script>${three}<\/script>
<script>
${code}
<\/script>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'dist', 'campus-m0-standalone.html'), standalone);
console.log('已生成 dist/campus-m0-standalone.html  ' + (standalone.length / 1024).toFixed(0) + ' KB（含 three.js，可离线双击运行）');
