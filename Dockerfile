# ===== FamilyChat Docker 镜像（支持 Hugging Face Spaces / Render / 通用）=====
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

# Hugging Face Spaces 持久化存储路径
RUN mkdir -p /data /app/static/uploads

# 使用非 root 用户运行
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app /data
USER appuser

EXPOSE 7860

# Hugging Face Spaces 自动注入 PORT 环境变量，默认 7860
CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT:-7860} -k eventlet -w 1 --timeout 120"]