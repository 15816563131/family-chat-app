# ===== FamilyChat 通用部署镜像（支持 Koyeb / Fly.io / Render）=====
FROM python:3.12-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# 复制并安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . .

# 确保数据目录存在
RUN mkdir -p /data /app/static/uploads

# 使用非 root 用户运行
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8080

# 使用 PORT 环境变量（Koyeb 自动注入），默认 8080
CMD gunicorn app:app --bind 0.0.0.0:${PORT:-8080} -k eventlet -w 1 --timeout 120