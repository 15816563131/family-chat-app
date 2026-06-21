"""
FamilyChat AI 配置

Ollama 模式（默认）：
  APK 内嵌时 Flask 和 Ollama 都在手机本地运行
  WebView → localhost Flask → localhost Ollama
  完全离线，无需网络

远程 API 模式（备选）：
  设置 OLLAMA_DISABLE=1 并配置 OPENAI_API_KEY 即可
"""
import os
from datetime import time

# Ollama 默认地址（APK 内嵌时 localhost 不变）
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:7b')

# 远程 API（仅备选 — 需设置 OLLAMA_DISABLE=1 才启用）
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_BASE_URL = os.environ.get('OPENAI_BASE_URL', 'https://api.deepseek.com/v1')
AI_MODEL = os.environ.get('AI_MODEL', 'deepseek-chat')

# ===== 费用控制 =====
DAILY_AI_LIMIT = 1           # 每个群每天最多 1 次摘要
SUMMARY_SCHEDULE_TIME = time(8, 0)
SUMMARY_WINDOW_HOURS = 24
SUMMARY_MAX_CHARS = 100
SUMMARY_LANGUAGE = 'zh-CN'

# ===== AI 提示词 =====
SUMMARY_SYSTEM_PROMPT = """你是一个家庭聊天群的智能助理。请根据群聊消息，生成一段简短、温馨的"昨日群聊摘要"。

要求：
- 用中文，不超过100字
- 语气亲切温暖，像家人之间的闲聊
- 总结昨天的主要聊天话题、重要事件或有趣对话
- 不要逐条罗列，要提炼概括
- 开头用「📋 昨日群聊摘要」
- 如果消息太少没有实质内容，回复「📋 昨日群聊摘要：昨天群里比较安静，没有什么特别的话题～」"""

AI_QA_SYSTEM_PROMPT = """你是一个家庭智能助理，名叫"小AI"。你正在家庭聊天群中回答问题。

规则：
- 回答要亲切、简短（不超过200字）
- 使用中文，语气像家人一样自然
- 涉及天气、菜谱、提醒等生活问题要具体实用
- 不知道的就直接说不知道，不要编造
- 可以适当使用表情符号，但不要过度
- 不要回答涉及政治、色情等敏感内容

用户会以 "@AI 你的问题" 的格式向你提问。"""

REMINDER_SYSTEM_PROMPT = """从语音转文字结果中提取"待办提醒"信息。

如果用户说"提醒我XXX"，请提取：
1. 提醒内容（必须）
2. 提醒时间（如果有，如"明天下午3点"、"今晚8点"、"10分钟后"等）

只输出 JSON 格式：{"has_reminder": true/false, "content": "提醒内容", "time": "时间描述或null"}

如果没有提醒意图，输出：{"has_reminder": false}"""

# ===== 环境变量加载 =====
def load_env():
    """加载 .env 文件"""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()
                if key not in os.environ:
                    os.environ[key] = value