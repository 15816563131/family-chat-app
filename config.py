"""
FamilyChat AI 配置
"""
import os
from datetime import time

# ===== AI 模型配置 =====
# 兼容 OpenAI API 的提供商均可使用（DeepSeek、OpenAI、智谱等）
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_BASE_URL = os.environ.get('OPENAI_BASE_URL', 'https://api.deepseek.com/v1')
AI_MODEL = os.environ.get('AI_MODEL', 'deepseek-chat')

# ===== 本地 Ollama 配置（完全免费，无需 API Key） =====
# 安装 Ollama: https://ollama.com
# 下载模型: ollama pull qwen2.5:7b （或 deepseek-r1:7b, llama3.1:8b 等）
# 设置后 AI 功能自动使用本地模型，无需任何费用
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:7b')

# ===== 费用控制 =====
# 每个群每天最多生成 1 次摘要
DAILY_AI_LIMIT = 1

# ===== 摘要配置 =====
# 每天早上 8:00 生成摘要
SUMMARY_SCHEDULE_TIME = time(8, 0)
# 摘要窗口：最近 24 小时
SUMMARY_WINDOW_HOURS = 24
# 摘要最大字数
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
                # 只设置环境变量（不覆盖已存在的）
                if key not in os.environ:
                    os.environ[key] = value