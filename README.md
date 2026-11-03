# 通用技术 · 智能学伴（魔搭创空间）

《通用技术》（周晓林主编）课程智能助教。Node.js 20 单进程 Web 应用，内置离线启发式引导引擎，可接入阿里云百炼大模型。

## 访问

部署后：`https://modelscope.cn/studios/{owner}/{repo}`
- 学生端：`{链接}/`
- 教师端：`{链接}/teacher`

## 本地运行

```bash
node server.js
# http://127.0.0.1:8000
```

## 技术栈

- Node.js 20（零外部 npm 依赖）
- 离线启发式引擎（课程知识图谱）
- 可选大模型：阿里云百炼

## 环境变量（接入大模型，可选）

| Key | 示例 |
|---|---|
| `LLM_API_KEY` | `sk-ws-H.xxx` |
| `LLM_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_PROTOCOL` | `openai` |
| `LLM_MODEL` | `qwen-plus` |

server.js 已通过 `process.env.PORT` 自动适配，魔搭注入 7860。

## 目录

```
server.js     主服务（API + HTML 内嵌）
data.json     课程数据
Dockerfile    创空间构建
package.json  npm 元数据（零依赖）
```
