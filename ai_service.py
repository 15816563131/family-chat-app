"""
FamilyChat AI 服务层
本地优先，完全离线可用

后端优先级（自动检测，无需配置）：
1. 本地 Ollama（默认） — http://localhost:11434，APK 内嵌首选
2. 嵌入 llama-cpp-python — pip 装 + 下载 GGUF 模型文件即可
3. 远程 API（可选） — 仅当 OLLAMA_DISABLE=1 且有 API Key 时启用
"""
import json
import logging
import os
import requests

from config import (
    SUMMARY_SYSTEM_PROMPT, AI_QA_SYSTEM_PROMPT, REMINDER_SYSTEM_PROMPT,
    SUMMARY_MAX_CHARS
)

logger = logging.getLogger(__name__)

# ===== 全局状态 =====
_model_available = None     # None=未检测, True/False
_using_backend = None        # 'ollama' | 'llamacpp' | 'remote'
_has_llamacpp = None         # None=未检测, True/False

# Ollama 默认地址（APK 内嵌时固定为 localhost）
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434').rstrip('/')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:7b')


def is_ai_available():
    """自动检测可用后端，Ollama 优先"""
    global _model_available, _using_backend
    if _model_available is not None:
        return _model_available

    # 1. 本地 Ollama（默认首选，APK 内嵌）
    if _is_ollama_running():
        _model_available = True
        _using_backend = 'ollama'
        logger.info('[AI] ✅ Ollama 本地模型')
        return True

    # 2. 嵌入式 llama-cpp-python
    if _check_llamacpp():
        _model_available = True
        _using_backend = 'llamacpp'
        logger.info('[AI] ✅ llama-cpp-python 嵌入模型')
        return True

    # 3. 远程 API（仅备选）
    disable_ollama = os.environ.get('OLLAMA_DISABLE', '0') == '1'
    key = os.environ.get('OPENAI_API_KEY', '')
    if disable_ollama and key and len(key) >= 10:
        _model_available = True
        _using_backend = 'remote'
        logger.info('[AI] ✅ 远程 API')
        return True

    _model_available = False
    logger.warning('[AI] ❌ 无可用后端。请安装 Ollama (ollama.com) 或配置 API')
    return False


# ── 检测 ──────────────────────────────────────────

def _is_ollama_running():
    """检测本地 Ollama 服务是否运行"""
    try:
        resp = requests.get(OLLAMA_BASE_URL + '/api/tags', timeout=3)
        if resp.status_code == 200:
            models = resp.json().get('models', [])
            if models:
                return True
            logger.warning('[AI] Ollama 运行中但无模型，请执行: ollama pull %s', OLLAMA_MODEL)
        else:
            logger.warning('[AI] Ollama 响应异常: %d', resp.status_code)
    except requests.exceptions.ConnectionError:
        logger.debug('[AI] Ollama 未运行')
    except Exception as e:
        logger.debug('[AI] Ollama 检测异常: %s', e)
    return False


def _check_llamacpp():
    """检查是否安装了 llama-cpp-python"""
    global _has_llamacpp
    if _has_llamacpp is not None:
        return _has_llamacpp
    try:
        import llama_cpp  # noqa: F401
        _has_llamacpp = True
        return True
    except ImportError:
        _has_llamacpp = False
        return False


def _get_ollama_model_name():
    """获取 Ollama 可用模型名"""
    try:
        resp = requests.get(OLLAMA_BASE_URL + '/api/tags', timeout=3)
        if resp.status_code == 200:
            models = resp.json().get('models', [])
            if models:
                for m in models:
                    if m['name'].startswith(OLLAMA_MODEL.split(':')[0]):
                        return m['name']
                return models[0]['name']
    except Exception:
        pass
    return OLLAMA_MODEL


# ── 统一入口 ─────────────────────────────────────

def _call_ai(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用 AI，自动路由到当前可用后端"""
    if not is_ai_available():
        return None

    if _using_backend == 'ollama':
        return _call_ollama(messages, stream, max_tokens, temperature)
    elif _using_backend == 'llamacpp':
        return _call_llamacpp(messages, stream, max_tokens, temperature)
    elif _using_backend == 'remote':
        return _call_remote_api(messages, stream, max_tokens, temperature)
    return None


# ── 后端 1：Ollama ────────────────────────────────

def _call_ollama(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用本地 Ollama（OpenAI 兼容接口）"""
    model = _get_ollama_model_name()
    payload = {
        'model': model,
        'messages': messages,
        'stream': stream,
        'options': {
            'num_predict': max_tokens,
            'temperature': temperature
        }
    }

    try:
        resp = requests.post(
            OLLAMA_BASE_URL + '/v1/chat/completions',
            json=payload,
            timeout=60,
            stream=stream
        )
        if resp.status_code != 200:
            logger.error('[AI/Ollama] 错误: %d %s', resp.status_code, resp.text[:200])
            return None

        if stream:
            return _parse_ollama_stream(resp)
        data = resp.json()
        return data['choices'][0]['message']['content']
    except requests.exceptions.Timeout:
        logger.error('[AI/Ollama] 请求超时')
        return None
    except Exception as e:
        logger.error('[AI/Ollama] 异常: %s', e)
        return None


def _parse_ollama_stream(response):
    """解析 Ollama SSE 流"""
    for line in response.iter_lines(decode_unicode=True):
        if not line:
            continue
        if line.startswith('data: '):
            data_str = line[6:]
            if data_str.strip() == '[DONE]':
                break
            try:
                data = json.loads(data_str)
                delta = data.get('choices', [{}])[0].get('delta', {})
                content = delta.get('content', '')
                if content:
                    yield content
            except json.JSONDecodeError:
                continue


# ── 后端 2：llama-cpp-python（APK 嵌入） ──────────────

def _call_llamacpp(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用嵌入式 llama-cpp-python"""
    try:
        from llama_cpp import Llama
    except ImportError:
        logger.error('[AI/llamacpp] 未安装')
        return None

    model_path = os.environ.get('LLAMACPP_MODEL_PATH', '')
    if not model_path or not os.path.exists(model_path):
        logger.error('[AI/llamacpp] 模型文件不存在: %s', model_path)
        return None

    try:
        llm = Llama(model_path=model_path, n_ctx=2048, n_threads=4, verbose=False)
        prompt = ''
        for m in messages:
            role = m.get('role', 'user')
            content = m.get('content', '')
            if role == 'system':
                prompt = content + '\n\n'
            elif role == 'user':
                prompt += '用户: ' + content + '\n'
            elif role == 'assistant':
                prompt += '助手: ' + content + '\n'
        prompt += '助手: '

        if stream:
            return _stream_llamacpp(llm, prompt, max_tokens, temperature)
        output = llm(
            prompt, max_tokens=max_tokens, temperature=temperature,
            stop=['用户:', '\n\n'], echo=False
        )
        return output['choices'][0]['text'].strip()
    except Exception as e:
        logger.error('[AI/llamacpp] 异常: %s', e)
        return None


def _stream_llamacpp(llm, prompt, max_tokens, temperature):
    for output in llm(
        prompt, max_tokens=max_tokens, temperature=temperature,
        stop=['用户:', '\n\n'], echo=False, stream=True
    ):
        text = output['choices'][0]['text']
        if text:
            yield text


# ── 后端 3：远程 API（备选） ──────────────────────────

def _call_remote_api(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用远程 OpenAI 兼容 API"""
    api_key = os.environ.get('OPENAI_API_KEY', '')
    base_url = os.environ.get('OPENAI_BASE_URL', 'https://api.deepseek.com/v1').rstrip('/')
    model = os.environ.get('AI_MODEL', 'deepseek-chat')

    try:
        resp = requests.post(
            base_url + '/chat/completions',
            headers={
                'Authorization': 'Bearer ' + api_key,
                'Content-Type': 'application/json'
            },
            json={
                'model': model,
                'messages': messages,
                'stream': stream,
                'max_tokens': max_tokens,
                'temperature': temperature
            },
            timeout=30,
            stream=stream
        )
        if resp.status_code != 200:
            logger.error('[AI/Remote] 错误: %d %s', resp.status_code, resp.text[:200])
            return None

        if stream:
            return _parse_ollama_stream(resp)
        return resp.json()['choices'][0]['message']['content']
    except Exception as e:
        logger.error('[AI/Remote] 异常: %s', e)
        return None


# ═══════════════════════════════════════════════════════
# 以下为业务功能，通过 _call_ai 统一调用
# ═══════════════════════════════════════════════════════

# ── 功能 1：群聊摘要 ──────────────────────────────────

def generate_summary(messages_text):
    if not messages_text or len(messages_text.strip()) < 10:
        return '📋 昨日群聊摘要：昨天群里比较安静，没有什么特别的话题～'

    result = _call_ai([
        {'role': 'system', 'content': SUMMARY_SYSTEM_PROMPT},
        {'role': 'user', 'content': '以下是昨天群里的消息记录，请生成摘要：\n\n' + messages_text[-3000:]}
    ], max_tokens=300, temperature=0.5)

    if not result:
        return '📋 昨日群聊摘要：AI 服务暂不可用，请确认已安装 Ollama'
    if len(result) > SUMMARY_MAX_CHARS + 50:
        result = result[:SUMMARY_MAX_CHARS] + '…'
    return result


# ── 功能 2：@AI 问答（流式） ───────────────────────────

def ask_ai_stream(question):
    if not question:
        return
    generator = _call_ai([
        {'role': 'system', 'content': AI_QA_SYSTEM_PROMPT},
        {'role': 'user', 'content': question}
    ], stream=True, max_tokens=500, temperature=0.7)

    if generator is None:
        yield '⚠️ AI 不可用，请安装 Ollama (ollama.com) 并运行模型'
        return

    for chunk in generator:
        yield chunk


# ── 功能 3：语音转待办 ────────────────────────────────

def extract_reminder(voice_text):
    if not voice_text or '提醒' not in voice_text:
        return None
    result = _call_ai([
        {'role': 'system', 'content': REMINDER_SYSTEM_PROMPT},
        {'role': 'user', 'content': '语音转文字结果：' + voice_text}
    ], max_tokens=200, temperature=0.1)
    if not result:
        return None
    try:
        data = json.loads(result.strip())
        if data.get('has_reminder'):
            return {'content': data.get('content', voice_text), 'time': data.get('time')}
    except (json.JSONDecodeError, AttributeError):
        pass
    return None