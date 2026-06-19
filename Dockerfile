# ===== FamilyChat Fly.io 部署镜像 =====
FROM python:3.12-slim

WORKDIR /app

# 安装系统依赖（psycopg2 编译需要，但这里用 SQLite 就先装轻量工具）
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# 复制并安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . .

# 确保数据目录存在（用于 Fly.io 持久化挂载）
RUN mkdir -p /data /app/static/uploads

# 使用非 root 用户运行（安全性更好）
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app /data
USER appuser

# Fly.io 默认端口
EXPOSE 8080

# 启动命令（Gunicorn + Eventlet 支持 WebSocket）
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:8080", "-k", "eventlet", "-w", "1", "--timeout", "120"]