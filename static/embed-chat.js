/**
 * FamilyChat 嵌入式 AI 助手
 * 一行代码插入任意网站，手机电脑均可用
 *
 * 用法：
 *   <script src="http://你的服务器:8080/static/embed-chat.js"></script>
 *
 * 自定义选项（通过 script 标签的 data-* 属性）：
 *   data-server="http://你的服务器:8080"  // 后端地址，默认当前域名
 *   data-title="AI 助手"                   // 聊天窗口标题
 *   data-primary="#667eea"                 // 主题色
 *   data-greeting="你好！我是 AI 助手"     // 初始问候语
 *   data-position="right"                  // 位置：right / left
 */
(function () {
    'use strict';

    // ===== 读取配置 =====
    var scripts = document.getElementsByTagName('script');
    var currentScript = scripts[scripts.length - 1];
    var BASE = currentScript.getAttribute('data-server') || window.location.origin;
    var TITLE = currentScript.getAttribute('data-title') || 'AI 助手';
    var PRIMARY = currentScript.getAttribute('data-primary') || '#667eea';
    var GREETING = currentScript.getAttribute('data-greeting') || '你好！我是 AI 助手，有什么可以帮你的吗？';
    var POSITION = currentScript.getAttribute('data-position') || 'right';
    var isRight = POSITION === 'right';

    // ===== 注入样式 =====
    var style = document.createElement('style');
    style.textContent = [
        '#_fc_widget { all: initial; position: fixed; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
        '#_fc_widget * { box-sizing: border-box; }',
        '#_fc_btn { position: fixed; ' + (isRight ? 'right: 20px;' : 'left: 20px;') + ' bottom: 20px; width: 56px; height: 56px; border-radius: 28px; background: ' + PRIMARY + '; color: #fff; border: none; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); font-size: 28px; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; z-index: 2147483647; }',
        '#_fc_btn:hover { transform: scale(1.1); }',
        '#_fc_btn svg { width: 28px; height: 28px; fill: currentColor; }',
        '#_fc_panel { position: fixed; ' + (isRight ? 'right: 20px;' : 'left: 20px;') + ' bottom: 88px; width: 360px; height: 520px; background: #fff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.18); display: none; flex-direction: column; overflow: hidden; z-index: 2147483647; }',
        '#_fc_panel.open { display: flex; }',
        '#_fc_header { background: ' + PRIMARY + '; color: #fff; padding: 14px 18px; font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; cursor: pointer; }',
        '#_fc_header span { font-family: inherit; }',
        '#_fc_close { background: none; border: none; color: #fff; cursor: pointer; font-size: 20px; padding: 0 4px; opacity: 0.8; }',
        '#_fc_close:hover { opacity: 1; }',
        '#_fc_msgs { flex: 1; overflow-y: auto; padding: 14px; background: #f5f7fb; }',
        '#_fc_msgs::-webkit-scrollbar { width: 4px; }',
        '#_fc_msgs::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }',
        '#_fc_msg_ai, #_fc_msg_user { max-width: 80%; margin-bottom: 10px; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.5; word-wrap: break-word; white-space: pre-wrap; font-family: inherit; }',
        '#_fc_msg_ai { float: left; clear: both; background: #fff; color: #333; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }',
        '#_fc_msg_user { float: right; clear: both; background: ' + PRIMARY + '; color: #fff; border-bottom-right-radius: 4px; }',
        '#_fc_typing { float: left; clear: both; color: #999; font-size: 13px; padding: 8px 0; }',
        '#_fc_typing::after { content: "● ● ●"; animation: _fc_blink 1.4s infinite; letter-spacing: 3px; }',
        '@keyframes _fc_blink { 0%, 20% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }',
        '#_fc_input_bar { padding: 10px 14px; background: #fff; border-top: 1px solid #eee; display: flex; gap: 8px; }',
        '#_fc_input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 8px 14px; font-size: 14px; outline: none; font-family: inherit; }',
        '#_fc_input:focus { border-color: ' + PRIMARY + '; }',
        '#_fc_send { background: ' + PRIMARY + '; color: #fff; border: none; border-radius: 20px; padding: 8px 18px; font-size: 14px; cursor: pointer; white-space: nowrap; }',
        '#_fc_send:disabled { opacity: 0.5; cursor: not-allowed; }',
        '#_fc_panel::after { content: ""; display: table; clear: both; }',

        // 移动端适配
        '@media (max-width: 480px) {',
        '  #_fc_panel { right: 0 !important; left: 0 !important; bottom: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; top: 0 !important; }',
        '  #_fc_btn { right: 16px; bottom: 16px; }',
        '}'
    ].join('');
    document.head.appendChild(style);

    // ===== 构建 DOM =====
    var widget = document.createElement('div');
    widget.id = '_fc_widget';
    widget.innerHTML = [
        '<button id="_fc_btn" title="' + TITLE + '">',
        '  <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>',
        '</button>',
        '<div id="_fc_panel">',
        '  <div id="_fc_header"><span>' + TITLE + '</span><button id="_fc_close">&times;</button></div>',
        '  <div id="_fc_msgs"><div id="_fc_msg_ai">' + GREETING + '</div></div>',
        '  <div id="_fc_input_bar">',
        '    <input id="_fc_input" type="text" placeholder="输入消息..." autocomplete="off">',
        '    <button id="_fc_send" disabled>发送</button>',
        '  </div>',
        '</div>'
    ].join('');
    document.body.appendChild(widget);

    // ===== DOM 引用 =====
    var btn = document.getElementById('_fc_btn');
    var panel = document.getElementById('_fc_panel');
    var header = document.getElementById('_fc_header');
    var closeBtn = document.getElementById('_fc_close');
    var msgsContainer = document.getElementById('_fc_msgs');
    var input = document.getElementById('_fc_input');
    var sendBtn = document.getElementById('_fc_send');

    var isLoading = false;
    var abortController = null;

    // ===== 工具函数 =====
    function addMsg(text, isUser) {
        var div = document.createElement('div');
        div.id = isUser ? '_fc_msg_user' : '_fc_msg_ai';
        div.textContent = text;
        msgsContainer.appendChild(div);
        msgsContainer.scrollTop = msgsContainer.scrollHeight;
        return div;
    }

    function removeTyping() {
        var t = document.getElementById('_fc_typing');
        if (t) t.remove();
    }

    function showTyping() {
        removeTyping();
        var div = document.createElement('div');
        div.id = '_fc_typing';
        msgsContainer.appendChild(div);
        msgsContainer.scrollTop = msgsContainer.scrollHeight;
    }

    function setLoading(loading) {
        isLoading = loading;
        sendBtn.disabled = loading || !input.value.trim();
        input.disabled = loading;
    }

    // ===== 发送消息 =====
    function sendMessage() {
        var text = input.value.trim();
        if (!text || isLoading) return;

        addMsg(text, true);
        input.value = '';
        sendBtn.disabled = true;
        setLoading(true);

        showTyping();
        var aiMsgDiv = null;
        var buffer = '';

        // 使用 fetch + SSE 流式读取
        abortController = new AbortController();
        fetch(BASE + '/api/embed/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text }),
            signal: abortController.signal
        }).then(function (resp) {
            if (!resp.ok) {
                throw new Error('HTTP ' + resp.status);
            }
            var reader = resp.body.getReader();
            var decoder = new TextDecoder();
            var partial = '';

            function readChunk() {
                return reader.read().then(function (result) {
                    if (result.done) {
                        removeTyping();
                        if (aiMsgDiv && buffer) {
                            aiMsgDiv.textContent = buffer;
                        }
                        setLoading(false);
                        abortController = null;
                        return;
                    }

                    partial += decoder.decode(result.value, { stream: true });
                    var lines = partial.split('\n');
                    partial = lines.pop() || '';

                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (line.startsWith('data: ')) {
                            try {
                                var data = JSON.parse(line.slice(6));
                                if (data.done) {
                                    removeTyping();
                                    if (aiMsgDiv && buffer) {
                                        aiMsgDiv.textContent = buffer;
                                    }
                                    setLoading(false);
                                    abortController = null;
                                    return;
                                }
                                if (data.content) {
                                    buffer += data.content;
                                    if (!aiMsgDiv) {
                                        removeTyping();
                                        aiMsgDiv = addMsg('', false);
                                    } else {
                                        aiMsgDiv.textContent = buffer;
                                    }
                                    msgsContainer.scrollTop = msgsContainer.scrollHeight;
                                }
                            } catch (e) {
                                // ignore parse errors
                            }
                        }
                    }

                    return readChunk();
                });
            }

            return readChunk();
        }).catch(function (err) {
            if (err.name === 'AbortError') return;
            removeTyping();
            addMsg('⚠️ 连接失败，请检查网络或稍后再试', false);
            setLoading(false);
            abortController = null;
        });
    }

    // ===== 事件绑定 =====
    btn.addEventListener('click', function () {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
            setTimeout(function () { input.focus(); }, 300);
        }
    });

    header.addEventListener('click', function () {
        panel.classList.remove('open');
    });

    closeBtn.addEventListener('click', function () {
        panel.classList.remove('open');
    });

    sendBtn.addEventListener('click', sendMessage);

    input.addEventListener('input', function () {
        sendBtn.disabled = isLoading || !input.value.trim();
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 点击空白区域关闭面板
    document.addEventListener('click', function (e) {
        if (panel.classList.contains('open') &&
            !panel.contains(e.target) &&
            e.target !== btn &&
            !btn.contains(e.target)) {
            panel.classList.remove('open');
        }
    });

})();