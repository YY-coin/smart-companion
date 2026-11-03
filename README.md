# 通用技术 · 智能学伴（魔搭创空间）

《通用技术》（周晓林主编）课程智能助教。Node.js 20 单进程 Web 应用，内置离线启发式引导引擎，可接入阿里云百炼大模型。

**访问地址**: `https://modelscope.cn/studios/{owner}/{repo}`

- 学生端：`{链接}/`
- 教师端：`{链接}/teacher`

## 技术栈

- Node.js 20（**零外部 npm 依赖**，只用内置 http/fs/crypto）
- 离线启发式引擎：课程知识图谱 + 引导思考模板
- 可选大模型：阿里云百炼（OpenAI 协议）或 Anthropic

## 本地运行

```bash
node server.js
# 打开 http://127.0.0.1:8000
```

## Docker 本地构建（可选）

```bash
docker build -t smart-companion .
docker run -p 7860:7860 smart-companion
```

## 魔搭创空间部署

1. 推代码到 GitHub 或 ModelScope Code 公开仓库
2. 打开 https://modelscope.cn/studios/create → 选 **Docker** → 填 git 仓库 URL
3. 创建后等 1-2 分钟构建即可

**端口说明**：server.js 已通过 `process.env.PORT || 8000` 自动适配，魔搭创空间会注入 `PORT=7860`。

### 环境变量（接入阿里云百炼大模型，可选）

| Key | 示例值 |
|---|---|
| `LLM_API_KEY` | `sk-ws-H.yOUR_K3y` |
| `LLM_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_PROTOCOL` | `openai` |
| `LLM_MODEL` | `qwen-plus` |

## 目录

```
server.js     主服务（API + 前端 HTML 全部内嵌）
data.json     课程数据
Dockerfile    魔搭创空间构建配置
package.json  npm 元数据（零依赖）
```
