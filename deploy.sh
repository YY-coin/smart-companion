#!/bin/bash
# 阿里云 ECS 一键部署脚本
# 使用：scp deploy.sh server:/tmp/ && ssh server "bash /tmp/deploy.sh"
# 或者：ssh root@<ECS_IP> "bash -s" < deploy.sh
#
# 前提：ECS 是阿里云公共镜像 CentOS 7/8 或 Ubuntu 20.04+
# 端口开放：安全组要放行 22(SSH) / 80(HTTP) / 443(HTTPS)

set -eu

APP_DIR=/opt/smart-companion
APP_USER=smart
NODE_VERSION=20

echo "=========================================="
echo " 通用技术智能学伴 - 阿里云 ECS 部署脚本"
echo "=========================================="

# ---------- 1. 安装系统依赖 ----------
echo ""
echo "[1/6] 安装系统依赖..."
if command -v yum &>/dev/null; then
    yum install -y curl git unzip nginx
elif command -v apt &>/dev/null; then
    apt update -y
    apt install -y curl git unzip nginx
fi

# ---------- 2. 安装 Node.js ----------
echo ""
echo "[2/6] 安装 Node.js $NODE_VERSION..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v$NODE_VERSION* ]]; then
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash - 2>/dev/null || true
    if command -v yum &>/dev/null; then
        yum install -y nodejs
    else
        apt install -y nodejs
    fi
fi
echo "Node.js: $(node -v)  npm: $(npm -v)"

# ---------- 3. 安装 PM2 ----------
echo ""
echo "[3/6] 安装 PM2..."
if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
fi

# ---------- 4. 准备应用目录 ----------
echo ""
echo "[4/6] 准备应用目录 $APP_DIR ..."
mkdir -p $APP_DIR/logs
# 如果已有旧版本，先备份
if [ -f $APP_DIR/server.js ]; then
    echo "  备份旧版本到 $APP_DIR.bak ..."
    rm -rf ${APP_DIR}.bak
    mv $APP_DIR ${APP_DIR}.bak
    mkdir -p $APP_DIR/logs
fi

# 从当前脚本同级目录拷贝文件
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp $SCRIPT_DIR/server.js $APP_DIR/
cp $SCRIPT_DIR/data.json $APP_DIR/
cp $SCRIPT_DIR/package.json $APP_DIR/
cp $SCRIPT_DIR/ecosystem.config.js $APP_DIR/
if [ -f $SCRIPT_DIR/模型配置.json ]; then
    cp $SCRIPT_DIR/模型配置.json $APP_DIR/
    echo "  已复制 模型配置.json"
fi
echo "  文件已复制："
ls -la $APP_DIR

# ---------- 5. 配置 Nginx ----------
echo ""
echo "[5/6] 配置 Nginx..."
cp $SCRIPT_DIR/nginx.conf /etc/nginx/conf.d/smart-companion.conf
# 默认 server 块可能冲突，注释掉一个
if [ -f /etc/nginx/conf.d/default.conf ]; then
    mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak 2>/dev/null || true
fi
nginx -t && {
    systemctl enable nginx
    systemctl restart nginx
    echo "  Nginx 已启动"
}

# ---------- 6. 启动 PM2 ----------
echo ""
echo "[6/6] 启动 PM2..."
cd $APP_DIR
pm2 delete smart-companion 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
# PM2 开机自启
if ! pm2 startup systemd | grep -q "sudo"; then
    eval "$(pm2 startup systemd | tail -1)"
    pm2 save
fi

echo ""
echo "=========================================="
echo " 部署完成！"
echo "=========================================="
echo ""
echo " 访问地址:"
echo "  学生端: http://$(hostname -I | awk '{print $1}')/"
echo "  教师端: http://$(hostname -I | awk '{print $1}')/teacher"
echo ""
echo " 常用命令:"
echo "  pm2 status              查看运行状态"
echo "  pm2 logs smart-companion  查看日志"
echo "  pm2 restart smart-companion  重启"
echo "  pm2 reload smart-companion   零中断重载"
echo "=========================================="
