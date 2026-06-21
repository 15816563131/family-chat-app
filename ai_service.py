"""
FamilyChat AI 服务层
封装大模型 API 调用，支持流式返回和降级处理

多模式自动切换（按优先级）：
1. 远程 API（DeepSeek/OpenAI/智谱） — 需要 API Key，联网时首选
2. 本地 Ollama（完全免费） — 需要安装 Ollama + 下载模型
3. 嵌入式 llama-cpp-python（完全免费） — pip 安装，无需外部服务
"""
import json
import logging
import os
import requests
from config import (
    SUMMARY_SYSTEM_PROMPT, AI_QA_SYSTEM_PROMPT, REMINDER_SYSTEM_PROMPT,
    SUMMARY_MAX_CHARS, OLLAMA_BASE_URL, OLLAMA_MODEL
)

logger = logging.getLogger(__name__)

# ===== 全局状态 =====
_model_available = None       # None=未检测, True/False
_using_backend = None          # 'remote' | 'ollama' | 'llamacpp'
_has_llamacpp = None           # None=未检测, True/False


def _is_online():
    """快速检测网络是否可用"""
    try:
        requests.get('https://api.deepseek.com/v1/models',
                     timeout=2,
                     headers={'Authorization': 'Bearer ' + os.environ.get('OPENAI_API_KEY', '')})
        return True
    except requests.exceptions.ConnectionError:
        return False
    except Exception:
        return True  # 非连接错误（如401）说明网络通


def _check_llamacpp():
    """检查是否安装了 llama-cpp-python"""
    global _has_llamacpp
    if _has_llamacpp is not None:
        return _has_llamacpp
    try:
        import llama_cpp
        _has_llamacpp = True
        return True
    except ImportError:
        _has_llamacpp = False
        return False


def is_ai_available():
    """检查 AI 是否可用，自动选择最佳后端"""
    global _model_available, _using_backend
    if _model_available is not None:
        return _model_available

    # 1. 优先远程 API（须有 Key + 在线）
    key = os.environ.get('OPENAI_API_KEY', '')
    has_key = key and key != 'sk-your-api-key-here' and len(key) >= 10
    if has_key:
        online = _is_online()
        if online:
            _model_available = True
            _using_backend = 'remote'
            logger.info('[AI] ✅ 联网模式 → 远程 API (Key=%s...)', key[:8])
            return True
        else:
            logger.warning('[AI] ⚠️ 离线，API Key 不可用，尝试本地模型')

    # 2. 离线时本地 Ollama
    ollama_url = OLLAMA_BASE_URL.rstrip('/')
    try:
        resp = requests.get(ollama_url + '/api/tags', timeout=3)
        if resp.status_code == 200:
            models = resp.json().get('models', [])
            if models:
                _model_available = True
                _using_backend = 'ollama'
                logger.info('[AI] ✅ 离线模式 → 本地 Ollama (%d 个模型)', len(models))
                return True
            else:
                logger.warning('[AI] Ollama 运行中但无模型')
        else:
            logger.warning('[AI] Ollama 响应异常: %d', resp.status_code)
    except requests.exceptions.ConnectionError:
        logger.debug('[AI] Ollama 未运行')
    except Exception as e:
        logger.debug('[AI] Ollama 检测异常: %s', e)

    # 3. 嵌入式 llama-cpp-python
    if _check_llamacpp():
        _model_available = True
        _using_backend = 'llamacpp'
        logger.info('[AI] ✅ 离线模式 → 嵌入式 llama-cpp-python')
        return True

    _model_available = False
    return False


def _get_ollama_model():
    """获取 Ollama 上可用的模型名（用户配置的或自动检测第一个）"""
    try:
        resp = requests.get(OLLAMA_BASE_URL.rstrip('/') + '/api/tags', timeout=3)
        if resp.status_code == 200:
            models = resp.json().get('models', [])
            if models:
                # 优先使用用户配置的模型
                configured = OLLAMA_MODEL
                for m in models:
                    if m['name'] == configured or m['name'].startswith(configured.split(':')[0]):
                        return m['name']
                return models[0]['name']
    except Exception:
        pass
    return OLLAMA_MODEL


def _call_ai(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用大模型 API（自动选择后端，按优先级降级）"""
    if not is_ai_available():
        return None

    result = None
    if _using_backend == 'remote':
        result = _call_openai_api(messages, stream, max_tokens, temperature)
        # API 失败（余额不足等）→ 尝试本地模型
        if result is None:
            logger.warning('[AI] 远程 API 失败，尝试本地 Ollama...')
            result = _call_ollama(messages, stream, max_tokens, temperature)
        if result is None:
            logger.warning('[AI] Ollama 不可用，尝试 llama-cpp-python...')
            result = _call_llamacpp(messages, stream, max_tokens, temperature)
    elif _using_backend == 'ollama':
        result = _call_ollama(messages, stream, max_tokens, temperature)
    elif _using_backend == 'llamacpp':
        result = _call_llamacpp(messages, stream, max_tokens, temperature)
    else:
        logger.error('[AI] 未知后端: %s', _using_backend)

    return result


def _call_openai_api(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用 OpenAI 兼容 API"""
    api_key = os.environ.get('OPENAI_API_KEY', '')
    base_url = os.environ.get('OPENAI_BASE_URL', 'https://api.deepseek.com/v1')
    model = os.environ.get('AI_MODEL', 'deepseek-chat')

    headers = {
        'Authorization': 'Bearer ' + api_key,
        'Content-Type': 'application/json'
    }
    payload = {
        'model': model,
        'messages': messages,
        'stream': stream,
        'max_tokens': max_tokens,
        'temperature': temperature
    }

    try:
        resp = requests.post(
            base_url.rstrip('/') + '/chat/completions',
            headers=headers,
            json=payload,
            timeout=30,
            stream=stream
        )
        if resp.status_code == 401:
            logger.error('[AI] API Key 无效')
            return None
        if resp.status_code != 200:
            logger.error('[AI] API 错误: %d %s', resp.status_code, resp.text[:200])
            return None

        if stream:
            return _parse_stream(resp)
        else:
            data = resp.json()
            return data['choices'][0]['message']['content']
    except requests.exceptions.Timeout:
        logger.error('[AI] API 请求超时')
        return None
    except Exception as e:
        logger.error('[AI] 请求异常: %s', e)
        return None


def _call_ollama(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用本地 Ollama（OpenAI 兼容接口）"""
    model = _get_ollama_model()
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
            OLLAMA_BASE_URL.rstrip('/') + '/v1/chat/completions',
            json=payload,
            timeout=60,
            stream=stream
        )
        if resp.status_code != 200:
            logger.error('[AI/Ollama] 错误: %d %s', resp.status_code, resp.text[:200])
            return None

        if stream:
            return _parse_stream(resp)
        else:
            data = resp.json()
            return data['choices'][0]['message']['content']
    except requests.exceptions.Timeout:
        logger.error('[AI/Ollama] 请求超时（模型可能较慢）')
        return None
    except Exception as e:
        logger.error('[AI/Ollama] 异常: %s', e)
        return None


def _call_llamacpp(messages, stream=False, max_tokens=500, temperature=0.7):
    """调用嵌入式 llama-cpp-python（无需外部服务）"""
    try:
        from llama_cpp import Llama
    except ImportError:
        logger.error('[AI/llamacpp] 未安装，请执行: pip install llama-cpp-python')
        return None

    model_path = os.environ.get('LLAMACPP_MODEL_PATH', '')
    if not model_path:
        logger.error('[AI/llamacpp] 未配置模型路径，设置环境变量 LLAMACPP_MODEL_PATH')
        return None

    if not os.path.exists(model_path):
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
        else:
            output = llm(
                prompt,
                max_tokens=max_tokens,
                temperature=temperature,
                stop=['用户:', '\n\n'],
                echo=False
            )
            return output['choices'][0]['text'].strip()
    except Exception as e:
        logger.error('[AI/llamacpp] 调用异常: %s', e)
        return None


def _stream_llamacpp(llm, prompt, max_tokens, temperature):
    """llama-cpp-python 流式生成"""
    for output in llm(
        prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        stop=['用户:', '\n\n'],
        echo=False,
        stream=True
    ):
        text = output['choices'][0]['text']
        if text:
            yield text


def _parse_stream(response):
    """解析 SSE 流式响应，逐个 yield 文本块"""
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


# ===== 功能 1：生成群聊摘要 =====
def generate_summary(messages_text):
    """生成群聊摘要（非流式）"""
    if not messages_text or len(messages_text.strip()) < 10:
        return '📋 昨日群聊摘要：昨天群里比较安静，没有什么特别的话题～'

    result = _call_ai([
        {'role': 'system', 'content': SUMMARY_SYSTEM_PROMPT},
        {'role': 'user', 'content': '以下是昨天群里的消息记录，请生成摘要：\n\n' + messages_text[-3000:]}
    ], max_tokens=300, temperature=0.5)

    if not result:
        return '📋 昨日群聊摘要：AI 服务暂时不可用，请稍后再试～'
    
    # 限制长度
    if len(result) > SUMMARY_MAX_CHARS + 50:
        result = result[:SUMMARY_MAX_CHARS] + '…'
    return result


# ===== 功能 2：@AI 问答（流式） =====
def ask_ai_stream(question):
    """@AI 问答，返回生成器逐个 yield 文本块"""
    if not question:
        return

    generator = _call_ai([
        {'role': 'system', 'content': AI_QA_SYSTEM_PROMPT},
        {'role': 'user', 'content': question}
    ], stream=True, max_tokens=500, temperature=0.7)

    if generator is None:
        yield '⚠️ AI 余额不足，请充值 DeepSeek 或安装免费本地模型（Ollama）'
        return

    for chunk in generator:
        yield chunk


# ===== 功能 3：语音转待办分析 =====
def extract_reminder(voice_text):
    """从语音转文字结果中提取待办提醒"""
    if not voice_text or '提醒' not in voice_text:
        return None

    result = _call_ai([
        {'role': 'system', 'content': REMINDER_SYSTEM_PROMPT},
        {'role': 'user', 'content': '语音转文字结果：' + voice_text}
    ], max_tokens=200, temperature=0.1)

    if not result:
        return None

    try:
        # 尝试从 JSON 中提取
        data = json.loads(result.strip())
        if data.get('has_reminder'):
            return {
                'content': data.get('content', voice_text),
                'time': data.get('time')
            }
    except (json.JSONDecodeError, AttributeError):
        pass
    return None