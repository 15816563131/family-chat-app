let socket;
let currentUser = null;
let currentFriendId = null;
let currentFriendInfo = null;
let receivedMessages = {};
let isConnected = false;
let reconnectTimer = null;
let lastMessageCheckTime = Date.now();
let currentTab = 'friends';
const displayedMessageIds = new Set();
const unreadMessages = {};

// ===== 群组状态变量 =====
let currentGroupId = null;
let groupsList = [];
let currentGroupMembers = [];

// ===== 多选 & 转发 =====
let selectedMessages = [];
let isMultiSelectMode = false;

// ===== 老年模式 =====
let isSeniorMode = localStorage.getItem('seniorMode') === 'true';

// ===== 待办清单 =====
let todoSectionVisible = true;

// ===== 语音输入 (Speech-to-Text) =====
let speechRecognition = null;
let isSpeechRecording = false;

// ===== 语音状态提示（带显示/隐藏，修复：添加 active 类使元素可见） =====
function showVoiceStatus(text) {
    var el = document.getElementById('voice-status');
    if (el) { el.textContent = text; el.classList.add('active'); }
}

function hideVoiceStatus() {
    var el = document.getElementById('voice-status');
    if (el) { el.textContent = ''; el.classList.remove('active'); }
}

// ===== 语音消息录制 =====
let mediaRecorder = null;
let audioChunks = [];
let isAudioRecording = false;
let longPressTimer = null;
let isLongPress = false;

// ===== WebRTC 通话 =====
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let isCallActive = false;
let isCallInitiator = false;
let pendingOffer = null;
let callType = 'audio'; // 'audio' 或 'video'

// ===== Web Audio API 响铃 =====
let audioContext = null;
let ringtoneGainNode = null;
let ringtoneOscillator = null;
let isRinging = false;

// ===== 音频上下文初始化 =====
function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

// ===== 响铃功能 =====
function playRingtone() {
    if (isRinging) return;
    const ctx = getAudioContext();
    
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.3;
    gainNode.connect(ctx.destination);
    
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    oscillator.connect(gainNode);
    
    const now = ctx.currentTime;
    for (let i = 0; i < 20; i++) {
        const t = now + i * 0.5;
        const isOn = Math.floor(i / 2) % 2 === 0;
        gainNode.gain.setValueAtTime(isOn ? 0.3 : 0, t);
        gainNode.gain.linearRampToValueAtTime(isOn ? 0.3 : 0, t + 0.05);

        oscillator.frequency.setValueAtTime(440, t);
        oscillator.frequency.setValueAtTime(isOn ? 500 : 440, t + 0.05);
        oscillator.frequency.linearRampToValueAtTime(isOn ? 500 : 440, t + 0.25);
    }
    
    oscillator.start(now);
    ringtoneOscillator = oscillator;
    ringtoneGainNode = gainNode;
    isRinging = true;
}

function stopRingtone() {
    if (ringtoneOscillator) {
        try {
            ringtoneOscillator.stop();
        } catch (e) {}
        ringtoneOscillator = null;
    }
    if (ringtoneGainNode) {
        try {
            ringtoneGainNode.disconnect();
        } catch (e) {}
        ringtoneGainNode = null;
    }
    isRinging = false;
}

function playMessageSound() {
    const ctx = getAudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.2;
    gainNode.connect(ctx.destination);
    
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.setValueAtTime(1000, now + 0.05);
    osc.connect(gainNode);
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
}

function playCallConnectSound() {
    const ctx = getAudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.25;
    gainNode.connect(ctx.destination);
    
    const now = ctx.currentTime;
    [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gainNode);
        const t = now + i * 0.12;
        gainNode.gain.setValueAtTime(0.25, t);
        gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        osc.start(t);
        osc.stop(t + 0.15);
    });
}

function playCallEndSound() {
    const ctx = getAudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.25;
    gainNode.connect(ctx.destination);
    
    const now = ctx.currentTime;
    [784, 659, 523].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gainNode);
        const t = now + i * 0.15;
        gainNode.gain.setValueAtTime(0.25, t);
        gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.2);
    });
}

// ===== 语音输入 (Speech-to-Text) =====
function createSpeechRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    
    var recog = new SR();
    recog.lang = 'zh-CN';
    recog.continuous = false;
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    
    recog.onresult = function(event) {
        var transcript = event.results[0][0].transcript;
        var input = document.getElementById('message-input');
        if (input) input.value = input.value + transcript;
        hideVoiceStatus();
        isSpeechRecording = false;
        var btn = document.getElementById('voice-input-btn');
        if (btn) btn.textContent = '🎤';
        // 检测"提醒"关键词，自动创建待办
        if (transcript.indexOf('提醒') !== -1 && currentUser && currentUser.id) {
            fetch('/api/voice/reminder', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    text: transcript,
                    user_id: currentUser.id,
                    group_id: currentGroupId || null
                })
            }).catch(function(){});
        }
    };
    
    recog.onerror = function(event) {
        console.error('语音识别错误:', event.error);
        showVoiceStatus('语音识别失败: ' + event.error);
        isSpeechRecording = false;
        var btn = document.getElementById('voice-input-btn');
        if (btn) btn.textContent = '🎤';
        setTimeout(hideVoiceStatus, 3000);
    };
    
    recog.onend = function() {
        isSpeechRecording = false;
        var btn = document.getElementById('voice-input-btn');
        if (btn) btn.textContent = '🎤';
    };
    
    return recog;
}

function toggleSpeechRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        showVoiceStatus('您的浏览器不支持语音识别');
        setTimeout(hideVoiceStatus, 3000);
        return;
    }
    
    if (isSpeechRecording) {
        if (speechRecognition) {
            try { speechRecognition.stop(); } catch (e) {}
        }
        isSpeechRecording = false;
        var btn = document.getElementById('voice-input-btn');
        if (btn) btn.textContent = '🎤';
        hideVoiceStatus();
        return;
    }
    
    try {
        speechRecognition = createSpeechRecognition();
        if (!speechRecognition) {
            showVoiceStatus('创建语音识别失败');
            setTimeout(hideVoiceStatus, 3000);
            return;
        }
        speechRecognition.start();
        isSpeechRecording = true;
        var btn = document.getElementById('voice-input-btn');
        if (btn) btn.textContent = '🔴';
        showVoiceStatus('🎙️ 正在聆听...');
    } catch (e) {
        console.error('启动语音识别失败:', e);
        showVoiceStatus('启动语音识别失败');
        setTimeout(hideVoiceStatus, 3000);
    }
}

// ===== 语音消息录制 (MediaRecorder) =====
let audioRecordStartTime = 0;
let audioCurrentStream = null;

function startVoiceRecording() {
    if (isAudioRecording) return;
    audioChunks = [];
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function(stream) {
            audioCurrentStream = stream;
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data && event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = function() {
                var duration = (Date.now() - audioRecordStartTime) / 1000;
                if (audioCurrentStream) {
                    var tracks = audioCurrentStream.getTracks();
                    tracks.forEach(function(track) { track.stop(); });
                    audioCurrentStream = null;
                }
                
                if (audioChunks.length > 0 && duration >= 0.5) {
                    var audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    sendVoiceMessage(audioBlob, duration);
                } else if (duration < 0.5) {
                    showVoiceStatus('说话时间太短');
                    setTimeout(hideVoiceStatus, 1500);
                }
                isAudioRecording = false;
                var btn = document.getElementById('voice-input-btn');
                if (btn) btn.textContent = '🎤';
                hideVoiceStatus();
            };
            
            mediaRecorder.onerror = function(err) {
                console.error('录音错误:', err);
                showVoiceStatus('录音出错，已取消');
                setTimeout(hideVoiceStatus, 2000);
                isAudioRecording = false;
            };
            
            audioRecordStartTime = Date.now();
            mediaRecorder.start();
            isAudioRecording = true;
            var btn = document.getElementById('voice-input-btn');
            if (btn) btn.textContent = '🔴';
            showVoiceStatus('🎙️ 正在录音，松开发送');
        })
        .catch(function(error) {
            console.error('获取麦克风权限失败:', error);
            showVoiceStatus('❌ 无法访问麦克风，请检查权限');
            if (typeof AndroidBridge !== 'undefined' && AndroidBridge) {
                try { AndroidBridge.requestAudioPermission(); } catch (e) {}
            }
            setTimeout(hideVoiceStatus, 3000);
        });
}

function stopVoiceRecording() {
    try {
        if (mediaRecorder && isAudioRecording && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        } else if (isAudioRecording) {
            if (audioCurrentStream) {
                var tracks = audioCurrentStream.getTracks();
                tracks.forEach(function(track) { track.stop(); });
                audioCurrentStream = null;
            }
            isAudioRecording = false;
            var btn = document.getElementById('voice-input-btn');
            if (btn) btn.textContent = '🎤';
            hideVoiceStatus();
        }
    } catch (err) {
        console.error('停止录音出错:', err);
        isAudioRecording = false;
        var btn = document.getElementById('voice-input-btn');
        if (btn) btn.textContent = '🎤';
        hideVoiceStatus();
    }
}

function cancelVoiceRecording() {
    try {
        if (mediaRecorder && isAudioRecording && mediaRecorder.state !== 'inactive') {
            // 替换 onstop 为取消逻辑，不发送
            mediaRecorder.onstop = function() {
                if (audioCurrentStream) {
                    var tracks = audioCurrentStream.getTracks();
                    tracks.forEach(function(track) { track.stop(); });
                    audioCurrentStream = null;
                }
                isAudioRecording = false;
                var btn = document.getElementById('voice-input-btn');
                if (btn) btn.textContent = '🎤';
                hideVoiceStatus();
            };
            mediaRecorder.stop();
        } else if (isAudioRecording) {
            if (audioCurrentStream) {
                var tracks = audioCurrentStream.getTracks();
                tracks.forEach(function(track) { track.stop(); });
                audioCurrentStream = null;
            }
            isAudioRecording = false;
            var btn = document.getElementById('voice-input-btn');
            if (btn) btn.textContent = '🎤';
            hideVoiceStatus();
        }
    } catch (err) {
        console.error('取消录音出错:', err);
        isAudioRecording = false;
        var btn = document.getElementById('voice-input-btn');
        if (btn) btn.textContent = '🎤';
        hideVoiceStatus();
    }
}

async function sendVoiceMessage(audioBlob, duration) {
    if (!currentFriendId) {
        showVoiceStatus('请先选择聊天对象');
        return;
    }
    
    // 先在本地显示临时消息
    var tempMessage = {
        id: null,
        sender_id: currentUser.id,
        receiver_id: currentFriendId,
        content: '🎤 [语音消息]',
        voice_url: null,
        voice_duration: duration || 1,
        timestamp: new Date().toISOString(),
        is_mine: true,
        is_temporary: true
    };
    addMessageToUI(tempMessage);
    var messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    var formData = new FormData();
    formData.append('audio', audioBlob, 'voice_' + Date.now() + '.webm');
    formData.append('sender_id', currentUser.id);
    formData.append('receiver_id', currentFriendId);
    
    try {
        var response = await fetch('/api/voice/upload', {
            method: 'POST',
            body: formData
        });
        
        var data = await response.json();
        if (response.ok && data.url) {
            if (socket && isConnected) {
                socket.emit('send_message', {
                    sender_id: currentUser.id,
                    receiver_id: currentFriendId,
                    content: '🎤 [语音消息]',
                    voice_url: data.url,
                    voice_duration: duration || data.duration || 0
                });
            }
        } else {
            showVoiceStatus('语音上传失败');
            setTimeout(hideVoiceStatus, 2000);
        }
    } catch (error) {
        console.error('上传语音失败:', error);
        showVoiceStatus('语音上传失败，请检查网络');
        setTimeout(hideVoiceStatus, 2000);
    }
}

// ===== 手机端侧边栏管理 =====
function isMobile() {
    return window.innerWidth < 768;
}

function showMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const chatArea = document.querySelector('.chat-area');
    if (sidebar) sidebar.style.display = 'flex';
    if (chatArea) chatArea.style.display = 'none';
}

function showMobileChat() {
    const sidebar = document.querySelector('.sidebar');
    const chatArea = document.querySelector('.chat-area');
    if (sidebar) sidebar.style.display = 'none';
    if (chatArea) chatArea.style.display = 'flex';
}

function handleResize() {
    if (!currentUser) return;
    
    if (isMobile()) {
        if (currentFriendId) {
            showMobileChat();
        } else {
            showMobileSidebar();
        }
    } else {
        const sidebar = document.querySelector('.sidebar');
        const chatArea = document.querySelector('.chat-area');
        if (sidebar) sidebar.style.display = 'flex';
        if (chatArea) chatArea.style.display = 'flex';
    }
}

// ===== Android 权限请求 (通话前自动索要摄像头/麦克风) =====
function ensureMediaPermissions(needVideo) {
    return new Promise(function(resolve, reject) {
        if (typeof AndroidBridge === 'undefined' || !AndroidBridge) {
            resolve();
            return;
        }
        
        var hasCamera = needVideo ? AndroidBridge.hasCameraPermission() : true;
        var hasAudio = AndroidBridge.hasAudioPermission();
        
        if (hasCamera && hasAudio) {
            resolve();
            return;
        }
        
        showVoiceStatus('⏳ 请求权限中...');
        
        var cameraDone = !needVideo || hasCamera;
        var audioDone = hasAudio;
        var rejected = false;
        
        function checkBoth() {
            if (rejected) return;
            if (cameraDone && audioDone) {
                hideVoiceStatus();
                resolve();
            }
        }
        
        window.onCameraPermissionResult = function(granted) {
            if (rejected) return;
            if (!granted) {
                rejected = true;
                showVoiceStatus('❌ 摄像头权限被拒绝');
                setTimeout(hideVoiceStatus, 3000);
                reject(new Error('Camera permission denied'));
                return;
            }
            cameraDone = true;
            checkBoth();
        };
        
        window.onAudioPermissionResult = function(granted) {
            if (rejected) return;
            if (!granted) {
                rejected = true;
                showVoiceStatus('❌ 麦克风权限被拒绝');
                setTimeout(hideVoiceStatus, 3000);
                reject(new Error('Audio permission denied'));
                return;
            }
            audioDone = true;
            checkBoth();
        };
        
        if (!hasCamera && needVideo) AndroidBridge.requestCameraPermission();
        if (!hasAudio) AndroidBridge.requestAudioPermission();
    });
}

// ===== WebRTC 通话 =====
const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function showCallOverlay() {
    document.getElementById('call-overlay').style.display = 'flex';
}

function hideCallOverlay() {
    document.getElementById('call-overlay').style.display = 'none';
    document.getElementById('incoming-call').style.display = 'none';
    document.getElementById('active-call').style.display = 'none';
}

function startCall(type) {
    if (!currentFriendId) return;
    callType = type;
    isCallInitiator = true;
    
    ensureMediaPermissions(type === 'video').then(function() {
        showCallOverlay();
        document.getElementById('incoming-call').style.display = 'flex';
        document.getElementById('active-call').style.display = 'none';
        document.getElementById('caller-name').textContent = '正在呼叫 ' + (currentFriendInfo ? currentFriendInfo.username : '...');
        document.getElementById('call-type-label').textContent = type === 'video' ? '📹 视频通话' : '🎵 语音通话';
        document.getElementById('caller-avatar').textContent = getAvatarInitial(currentFriendInfo ? currentFriendInfo.username : '');
        
        document.querySelector('.accept-call-btn').style.display = 'none';
        document.querySelector('.reject-call-btn').textContent = '📞';
        
        playRingtone();
        
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: type === 'video'
        })
        .then(function(stream) {
            localStream = stream;
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = stream;
            
            if (type === 'audio') {
                localVideo.style.display = 'none';
            } else {
                localVideo.style.display = 'block';
            }
            
            createPeerConnection();
            
            localStream.getTracks().forEach(function(track) {
                if (localStream) {
                    peerConnection.addTrack(track, localStream);
                }
            });
            
            peerConnection.createOffer()
                .then(function(offer) {
                    return peerConnection.setLocalDescription(offer);
                })
                .then(function() {
                    if (socket && isConnected) {
                        socket.emit('webrtc_offer', {
                            from: currentUser.id,
                            to: currentFriendId,
                            sdp: peerConnection.localDescription,
                            call_type: type
                        });
                    }
                })
                .catch(function(error) {
                    console.error('创建Offer失败:', error);
                    endCall();
                });
        })
        .catch(function(error) {
            console.error('获取媒体设备失败:', error);
            endCall();
            showVoiceStatus('❌ 无法访问摄像头/麦克风');
            setTimeout(hideVoiceStatus, 3000);
            if (typeof AndroidBridge !== 'undefined' && AndroidBridge) {
                AndroidBridge.openAppSettings();
            } else {
                alert('无法访问摄像头/麦克风，请在系统设置中开启权限');
            }
        });
    }).catch(function(error) {
        console.error('权限请求失败:', error);
        showVoiceStatus('❌ 需要摄像头/麦克风权限才能通话');
        setTimeout(hideVoiceStatus, 3000);
        if (typeof AndroidBridge !== 'undefined' && AndroidBridge) {
            AndroidBridge.openAppSettings();
        } else {
            alert('需要摄像头/麦克风权限才能通话，请先在系统设置中开启');
        }
    });
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(RTC_CONFIG);
    
    peerConnection.onicecandidate = function(event) {
        if (event.candidate && socket && isConnected) {
            socket.emit('webrtc_ice_candidate', {
                from: currentUser.id,
                to: currentFriendId,
                candidate: event.candidate
            });
        }
    };
    
    peerConnection.ontrack = function(event) {
        remoteStream = event.streams[0];
        const remoteVideo = document.getElementById('remote-video');
        remoteVideo.srcObject = remoteStream;
    };
    
    peerConnection.oniceconnectionstatechange = function() {
        if (peerConnection.iceConnectionState === 'disconnected' ||
            peerConnection.iceConnectionState === 'failed' ||
            peerConnection.iceConnectionState === 'closed') {
            endCall();
        }
    };
}

function acceptCall() {
    if (!pendingOffer) return;
    
    ensureMediaPermissions(pendingOffer.call_type === 'video').then(function() {
        stopRingtone();
        document.getElementById('incoming-call').style.display = 'none';
        document.getElementById('active-call').style.display = 'flex';
        
        playCallConnectSound();
        
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: pendingOffer.call_type === 'video'
        })
        .then(function(stream) {
            localStream = stream;
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = stream;
            
            if (pendingOffer.call_type === 'audio') {
                localVideo.style.display = 'none';
            } else {
                localVideo.style.display = 'block';
            }
            
            callType = pendingOffer.call_type;
            createPeerConnection();
            
            localStream.getTracks().forEach(function(track) {
                if (localStream) {
                    peerConnection.addTrack(track, localStream);
                }
            });
            
            peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer.sdp))
                .then(function() {
                    return peerConnection.createAnswer();
                })
                .then(function(answer) {
                    return peerConnection.setLocalDescription(answer);
                })
                .then(function() {
                    if (socket && isConnected) {
                        socket.emit('webrtc_answer', {
                            from: currentUser.id,
                            to: pendingOffer.from,
                            sdp: peerConnection.localDescription
                        });
                    }
                    isCallActive = true;
                })
                .catch(function(error) {
                    console.error('接听通话失败:', error);
                    endCall();
                });
        })
        .catch(function(error) {
            console.error('获取媒体设备失败:', error);
            endCall();
            showVoiceStatus('❌ 无法访问摄像头/麦克风');
            setTimeout(hideVoiceStatus, 3000);
            if (typeof AndroidBridge !== 'undefined' && AndroidBridge) {
                AndroidBridge.openAppSettings();
            } else {
                alert('无法访问摄像头/麦克风，请在系统设置中开启权限');
            }
        });
        
        pendingOffer = null;
    }).catch(function(error) {
        console.error('权限请求失败:', error);
        rejectCall();
        showVoiceStatus('❌ 需要摄像头/麦克风权限才能接听');
        setTimeout(hideVoiceStatus, 3000);
        if (typeof AndroidBridge !== 'undefined' && AndroidBridge) {
            AndroidBridge.openAppSettings();
        } else {
            alert('需要摄像头/麦克风权限才能接听通话');
        }
    });
}

function rejectCall() {
    stopRingtone();
    if (socket && isConnected && pendingOffer) {
        socket.emit('webrtc_reject', {
            from: currentUser.id,
            to: pendingOffer.from
        });
    }
    pendingOffer = null;
    hideCallOverlay();
    playCallEndSound();
}

function endCall() {
    stopRingtone();
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(function(track) { track.stop(); });
        localStream = null;
    }
    
    if (remoteStream) {
        remoteStream.getTracks().forEach(function(track) { track.stop(); });
        remoteStream = null;
    }
    
    isCallActive = false;
    isCallInitiator = false;
    pendingOffer = null;
    
    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('local-video').style.display = 'block';
    
    if (socket && isConnected && currentFriendId) {
        socket.emit('webrtc_end_call', {
            from: currentUser.id,
            to: currentFriendId
        });
    }
    
    hideCallOverlay();
    playCallEndSound();
}

function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            document.getElementById('mute-btn').textContent = audioTrack.enabled ? '🔊' : '🔇';
        }
    }
}

function toggleSpeaker() {
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
        remoteVideo.muted = !remoteVideo.muted;
        document.getElementById('speaker-btn').textContent = remoteVideo.muted ? '🔇' : '🔊';
    }
}

// ===== SocketIO WebRTC 事件处理 =====
function initWebRTCSocketHandlers() {
    socket.on('webrtc_offer', function(data) {
        if (isCallActive) {
            socket.emit('webrtc_busy', { from: currentUser.id, to: data.from });
            return;
        }
        
        pendingOffer = data;
        callType = data.call_type || 'audio';
        isCallInitiator = false;
        
        showCallOverlay();
        document.getElementById('incoming-call').style.display = 'flex';
        document.getElementById('active-call').style.display = 'none';
        document.getElementById('caller-name').textContent = data.caller_name + ' 邀请你通话';
        document.getElementById('call-type-label').textContent = data.call_type === 'video' ? '📹 视频通话' : '🎵 语音通话';
        document.getElementById('caller-avatar').textContent = getAvatarInitial(data.caller_name);
        
        document.querySelector('.accept-call-btn').style.display = 'inline-block';
        document.querySelector('.reject-call-btn').textContent = '📞';
        
        playRingtone();
    });
    
    socket.on('webrtc_answer', function(data) {
        if (peerConnection && peerConnection.remoteDescription === null) {
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
                .then(function() {
                    stopRingtone();
                    isCallActive = true;
                    document.getElementById('incoming-call').style.display = 'none';
                    document.getElementById('active-call').style.display = 'flex';
                    playCallConnectSound();
                })
                .catch(function(error) {
                    console.error('设置远端描述失败:', error);
                });
        }
    });
    
    socket.on('webrtc_ice_candidate', function(data) {
        if (peerConnection && peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                .catch(function(error) {
                    console.error('添加ICE Candidate失败:', error);
                });
        }
    });
    
    socket.on('webrtc_reject', function(data) {
        stopRingtone();
        if (isCallInitiator) {
            playCallEndSound();
            alert('对方拒绝了通话');
            endCall();
        }
    });
    
    socket.on('webrtc_end_call', function(data) {
        if (isCallActive || isCallInitiator) {
            stopRingtone();
            playCallEndSound();
            endCall();
        }
    });
    
    socket.on('webrtc_busy', function(data) {
        stopRingtone();
        if (isCallInitiator) {
            playCallEndSound();
            alert('对方正忙');
            endCall();
        }
    });
}

// ===== 原有功能函数 =====

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('auth-message').textContent = '';
}

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('auth-message').textContent = '';
}

function showMessage(message, isError = true) {
    const msgElement = document.getElementById('auth-message');
    msgElement.textContent = message;
    msgElement.className = isError ? 'error' : 'success';
    setTimeout(() => {
        msgElement.textContent = '';
    }, 3000);
}

async function register() {
    showLoading();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    
    if (!username || !password) {
        showMessage('请填写所有字段');
        hideLoading();
        return;
    }
    
    if (password !== passwordConfirm) {
        showMessage('两次密码输入不一致');
        hideLoading();
        return;
    }
    
    if (password.length < 6) {
        showMessage('密码长度至少为6位');
        hideLoading();
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage('注册成功！请登录', false);
            hideLoading();
            setTimeout(() => {
                showLogin();
                document.getElementById('login-username').value = username;
            }, 1000);
        } else {
            showMessage(data.error || '注册失败');
            hideLoading();
        }
    } catch (error) {
        showMessage('网络错误，请重试');
        hideLoading();
        console.error('注册错误:', error);
    }
}

async function login() {
    showLoading();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        showMessage('请输入用户名和密码');
        hideLoading();
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentUser = {
                id: data.user_id,
                username: data.username
            };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            try {
                if (window.AndroidBridge && window.AndroidBridge.setUserId) {
                    window.AndroidBridge.setUserId(data.user_id);
                    console.log('AndroidBridge.setUserId called:', data.user_id);
                }
            } catch (e) {
                console.log('AndroidBridge not available:', e);
            }
            
            try {
                const loginEvent = new Event('userLoggedIn');
                window.dispatchEvent(loginEvent);
                console.log('登录成功事件已触发');
            } catch (e) {
                console.log('触发登录事件失败:', e);
            }
            
            initChat();
            hideLoading();
        } else {
            showMessage(data.error || '登录失败');
            hideLoading();
        }
    } catch (error) {
        showMessage('网络错误，请重试');
        hideLoading();
        console.error('登录错误:', error);
    }
}

function logout() {
    if (isCallActive || isCallInitiator) {
        endCall();
    }
    if (socket) {
        socket.emit('leave', { user_id: currentUser.id });
        socket.disconnect();
    }
    if (reconnectTimer) {
        clearInterval(reconnectTimer);
    }
    currentUser = null;
    currentFriendId = null;
    receivedMessages = {};
    localStorage.removeItem('currentUser');
    
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
    showLogin();
}

async function loadFriends() {
    try {
        const response = await fetch(`/api/friends/${currentUser.id}`);
        const friends = await response.json();
        
        const friendsList = document.getElementById('friends-list');
        friendsList.innerHTML = '';
        
        if (friends.length === 0) {
            friendsList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">暂无好友</p>';
            return;
        }
        
        friends.forEach(friend => {
            const friendElement = document.createElement('div');
            friendElement.className = 'friend-item' + (currentFriendId === friend.id ? ' active' : '');
            friendElement.dataset.friendId = friend.id;
            friendElement.onclick = () => selectFriend(friend);
            
            const unreadCount = unreadMessages[friend.id] || 0;
            const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
            
            friendElement.innerHTML = `
                <div class="friend-name">${escapeHtml(friend.username)}${unreadBadge}</div>
                <div class="last-message">${escapeHtml(friend.last_message || '暂无消息')}</div>
            `;
            
            friendsList.appendChild(friendElement);
        });
    } catch (error) {
        console.error('加载好友列表失败:', error);
    }
}

async function loadFriendRequests() {
    if (!currentUser || !currentUser.id) return;
    try {
        const response = await fetch(`/api/friend_requests/${currentUser.id}`);
        const requests = await response.json();
        
        const section = document.getElementById('friend-requests-section');
        const list = document.getElementById('friend-requests-list');
        
        if (requests.length > 0) {
            section.style.display = 'block';
            list.innerHTML = '';
            
            requests.forEach(req => {
                const requestElement = document.createElement('div');
                requestElement.className = 'friend-request-item';
                requestElement.innerHTML = `
                    <span>${escapeHtml(req.sender_username)}</span>
                    <div>
                        <button class="accept-btn" onclick="handleFriendRequest(${req.id}, 'accept')">同意</button>
                        <button class="reject-btn" onclick="handleFriendRequest(${req.id}, 'reject')">拒绝</button>
                    </div>
                `;
                list.appendChild(requestElement);
            });
        } else {
            section.style.display = 'none';
        }
    } catch (error) {
        console.error('加载好友请求失败:', error);
    }
}

async function handleFriendRequest(requestId, action) {
    try {
        const response = await fetch('/api/friend_request/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                request_id: requestId,
                action: action,
                receiver_id: currentUser.id
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            loadFriendRequests();
            loadFriends();
        } else {
            alert(data.error || '操作失败');
        }
    } catch (error) {
        console.error('处理好友请求失败:', error);
    }
}

async function searchUsers() {
    const searchInput = document.getElementById('search-input').value.trim();
    const resultsContainer = document.getElementById('search-results');
    
    if (!searchInput) {
        resultsContainer.innerHTML = '';
        return;
    }
    
    try {
        const response = await fetch(`/api/search?username=${encodeURIComponent(searchInput)}&user_id=${currentUser.id}`);
        const users = await response.json();
        
        resultsContainer.innerHTML = '';
        
        if (users.length === 0) {
            resultsContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 10px;">未找到用户</p>';
            return;
        }
        
        users.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'search-result-item';
            userElement.innerHTML = `
                <span>${escapeHtml(user.username)}</span>
                <button onclick="sendFriendRequest(${user.id})">添加</button>
            `;
            resultsContainer.appendChild(userElement);
        });
    } catch (error) {
        console.error('搜索用户失败:', error);
    }
}

async function sendFriendRequest(receiverId) {
    try {
        const response = await fetch('/api/friend_request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sender_id: currentUser.id,
                receiver_id: receiverId
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('好友请求已发送！');
            document.getElementById('search-input').value = '';
            document.getElementById('search-results').innerHTML = '';
        } else {
            alert(data.error || '发送失败');
        }
    } catch (error) {
        console.error('发送好友请求失败:', error);
    }
}

function refreshFriends() {
    loadFriends();
    loadFriendRequests();
    if (currentFriendId) {
        loadMessages(currentFriendId);
    }
}

function toggleFriendRequests() {
    const list = document.getElementById('friend-requests-list');
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

async function loadMessages(friendId) {
    try {
        const response = await fetch(`/api/messages/${currentUser.id}/${friendId}`);
        const messages = await response.json();
        
        const messagesContainer = document.getElementById('messages-container');
        messagesContainer.innerHTML = '';
        displayedMessageIds.clear();
        
        messages.forEach(message => {
            displayedMessageIds.add(message.id);
            addMessageToUI(message);
        });
        
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        console.error('加载消息失败:', error);
        const messagesContainer = document.getElementById('messages-container');
        messagesContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">加载消息失败，请检查网络连接</p>';
    }
}

function addMessageToUI(message) {
    const messagesContainer = document.getElementById('messages-container');
    
    if (message.id && document.querySelector(`[data-message-id="${message.id}"]`)) {
        return;
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message ' + (message.is_mine ? 'sent' : 'received');
    if (message.id) {
        messageElement.dataset.messageId = message.id;
        messageElement.dataset.msgId = message.id;
    }
    if (message.is_temporary) {
        messageElement.dataset.temporary = 'true';
        messageElement.dataset.tempContent = message.content;
        messageElement.dataset.tempTimestamp = message.timestamp;
        messageElement.classList.add('sending');
    }
    
    const time = new Date(message.timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const senderName = message.sender_name || (currentFriendInfo ? currentFriendInfo.username : '') || '';
    const avatarHtml = `<div class="message-avatar"><span class="avatar-initial">${getAvatarInitial(senderName)}</span></div>`;
    
    let bubbleContent;
    
    const isRecalled = message.recalled || message.content === '[撤回的消息]';
    
    if (isRecalled) {
        const recallText = message.is_mine ? '你撤回了一条消息' : `${senderName} 撤回了一条消息`;
        bubbleContent = `<div class="recall-notice">${escapeHtml(recallText)}</div>`;
    } else if (message.voice_url) {
        const duration = message.voice_duration ? Math.round(message.voice_duration) + '"' : '语音';
        bubbleContent = `
            <div class="msg-bubble voice-message-bubble">
                <div class="msg-content voice-msg-content" onclick="playVoiceMessage(this, '${escapeHtml(message.voice_url)}')">
                    <span class="voice-play-icon">▶️</span>
                    <span class="voice-duration">${duration}</span>
                    <div class="voice-wave">
                        <span></span><span></span><span></span><span></span><span></span>
                    </div>
                </div>
                <div class="msg-time">${message.is_temporary ? '发送中...' : time}</div>
            </div>
        `;
    } else {
        bubbleContent = `
            <div class="msg-bubble">
                <div class="msg-content">${escapeHtml(message.content)}</div>
                <div class="msg-time">${message.is_temporary ? '发送中...' : time}</div>
            </div>
        `;
    }
    
    messageElement.innerHTML = message.is_mine
        ? `${bubbleContent}${avatarHtml}`
        : `${avatarHtml}${bubbleContent}`;
    
    // 自己发送的消息支持长按/右键撤回
    if (message.is_mine && message.id && !isRecalled) {
        let longPressTimer = null;
        const handler = function() { showMessageMenu(messageElement, message, senderName); };
        messageElement.addEventListener('contextmenu', function(e) { e.preventDefault(); handler(); });
        // 移动端长按
        messageElement.addEventListener('touchstart', function(e) {
            longPressTimer = setTimeout(handler, 600);
        }, { passive: true });
        messageElement.addEventListener('touchend', function(e) {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        });
        messageElement.addEventListener('touchmove', function(e) {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        });
        // PC 鼠标长按
        messageElement.addEventListener('mousedown', function(e) {
            longPressTimer = setTimeout(handler, 800);
        });
        messageElement.addEventListener('mouseup', function(e) {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        });
        messageElement.addEventListener('mouseleave', function(e) {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        });
    }
    
    // 多选模式选择支持
    messageElement.onclick = function(e) {
        if (typeof isMultiSelectMode !== 'undefined' && isMultiSelectMode) {
            e.preventDefault();
            e.stopPropagation();
            toggleMessageSelect(this);
        }
    };
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ===== 消息菜单（撤回等）=====
let messageMenuElement = null;

function showMessageMenu(elem, message, senderName) {
    hideMessageMenu();
    
    const menu = document.createElement('div');
    menu.className = 'message-menu';
    
    // 计算菜单位置
    const rect = elem.getBoundingClientRect();
    const container = document.getElementById('messages-container');
    const containerRect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
    
    menu.style.left = (rect.left - containerRect.left + rect.width / 2 - 50) + 'px';
    menu.style.top = (rect.top - containerRect.top - 40) + 'px';
    
    const btn = document.createElement('button');
    btn.textContent = '撤回';
    btn.onclick = function() {
        recallMessage(message);
        hideMessageMenu();
    };
    menu.appendChild(btn);
    
    // 点击其他位置关闭
    setTimeout(function() {
        document.addEventListener('click', hideMessageMenu, { once: true, capture: true });
    }, 10);
    
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow) {
        chatWindow.appendChild(menu);
        messageMenuElement = menu;
    }
}

function hideMessageMenu() {
    if (messageMenuElement && messageMenuElement.parentNode) {
        messageMenuElement.parentNode.removeChild(messageMenuElement);
    }
    messageMenuElement = null;
}

function recallMessage(message) {
    if (!socket) {
        alert('连接未就绪，无法撤回');
        return;
    }
    socket.emit('recall_message', {
        message_id: message.id,
        user_id: currentUser.id
    });
}

// ===== 当前正在播放的语音（用于暂停/继续
let currentPlayingAudio = null;
let currentPlayingElement = null;

function playVoiceMessage(element, url) {
    // 如果点击的是当前正在播放的语音 → 暂停
    if (currentPlayingAudio && currentPlayingElement === element && !currentPlayingAudio.paused) {
        currentPlayingAudio.pause();
        return;
    }
    // 如果点击的是当前暂停中的语音 → 继续
    if (currentPlayingAudio && currentPlayingElement === element && currentPlayingAudio.paused) {
        currentPlayingAudio.play().catch(function(err) {
            console.error('继续播放语音失败:', err);
        });
        return;
    }
    // 其他情况：停止之前正在播放的语音
    if (currentPlayingAudio) {
        try { currentPlayingAudio.pause(); } catch(e) {}
    }

    const audio = new Audio(url);
    currentPlayingAudio = audio;
    currentPlayingElement = element;

    audio.play().catch(function(error) {
        console.error('播放语音失败:', error);
    });

    const playIcon = element.querySelector('.voice-play-icon');
    if (playIcon) {
        playIcon.textContent = '⏸️';
    }

    audio.onpause = function() {
        if (playIcon) playIcon.textContent = '▶️';
    };
    audio.onended = function() {
        if (playIcon) playIcon.textContent = '▶️';
        if (currentPlayingAudio === audio) {
            currentPlayingAudio = null;
            currentPlayingElement = null;
        }
    };
}

function getAvatarInitial(name) {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
}

function safeAvatarSrc(avatarUrl) {
    if (!avatarUrl) return null;
    if (avatarUrl.startsWith('data:')) {
        return avatarUrl;
    }
    return avatarUrl + '?t=' + Date.now();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getUserAvatar(userId) {
    return '/api/avatar/' + userId;
}

function handleReceivedMessage(message) {
    console.log('处理收到的消息:', message);
    
    if (message.id && displayedMessageIds.has(message.id)) {
        console.log('消息已显示，跳过:', message.id);
        return;
    }
    
    if (message.id) {
        displayedMessageIds.add(message.id);
    }
    
    if (message.is_mine) {
        const tempMessages = document.querySelectorAll('[data-temporary="true"]');
        for (let temp of tempMessages) {
            if (temp.dataset.tempContent === message.content) {
                temp.remove();
                console.log('已移除临时消息');
                break;
            }
        }
    }
    
    if (!message.is_mine) {
        const senderId = message.sender_id;
        if (!unreadMessages[senderId]) {
            unreadMessages[senderId] = 0;
        }
        unreadMessages[senderId]++;
        console.log('未读消息计数:', unreadMessages);

        let senderName = message.sender_name || '好友';
        const friendItem = document.querySelector(`[data-friend-id="${senderId}"]`);
        if (friendItem) {
            const nameEl = friendItem.querySelector('.friend-name');
            if (nameEl) {
                senderName = nameEl.textContent.replace(/\d+$/, '');
            }
        }

        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function') {
                window.AndroidBridge.showNotification(senderName, message.content);
            } else if (typeof showNotification === 'function') {
                showNotification(senderName, message.content);
            }
        } catch (e) {
            console.log('通知调用失败:', e);
        }

        playMessageSound();
    }
    
    const isInCurrentChat = (message.sender_id === currentFriendId || message.receiver_id === currentFriendId);
    
    if (isInCurrentChat) {
        addMessageToUI(message);
        const messagesContainer = document.getElementById('messages-container');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        if (!message.is_mine) {
            unreadMessages[currentFriendId] = 0;
        }
    } else if (!message.is_mine) {
        showMessageNotification(message);
    }
    
    if (!receivedMessages[message.sender_id]) {
        receivedMessages[message.sender_id] = [];
    }
    receivedMessages[message.sender_id].push(message);
}

function handleMessageRecalled(data) {
    if (!data || !data.message_id) return;
    
    const mid = data.message_id;
    const element = document.querySelector(`[data-message-id="${mid}"]`);
    
    // 如果找到元素 → 替换内容为撤回提示
    if (element) {
        let recallText;
        if (element.classList.contains('sent')) {
            recallText = '你撤回了一条消息';
        } else {
            const friendName = (currentFriendInfo ? currentFriendInfo.username : '对方');
            recallText = friendName + ' 撤回了一条消息';
        }
        element.innerHTML = `<div class="recall-notice">${escapeHtml(recallText)}</div>`;
    }
}

function showMessageNotification(message) {
    console.log('显示消息通知:', message);
    
    const friendItems = document.querySelectorAll('.friend-item');
    friendItems.forEach(item => {
        const friendId = parseInt(item.dataset.friendId);
        if (friendId === message.sender_id) {
            item.classList.add('has-unread');
            const count = unreadMessages[message.sender_id] || 0;
            if (count > 0) {
                let badge = item.querySelector('.unread-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'unread-badge';
                    item.appendChild(badge);
                }
                badge.textContent = count > 99 ? '99+' : count;
            }
        }
    });
    
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('新消息', {
            body: message.content.substring(0, 50),
            icon: '/static/icon.svg'
        });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentFriendId) {
        return;
    }
    
    if (!isConnected || !socket) {
        alert('当前未连接到服务器，请稍后再试');
        return;
    }
    
    const temporaryMessage = {
        id: null,
        sender_id: currentUser.id,
        receiver_id: currentFriendId,
        content: content,
        timestamp: new Date().toISOString(),
        is_mine: true,
        is_temporary: true
    };
    
    addMessageToUI(temporaryMessage);
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    input.value = '';
    
    console.log('发送消息到服务器:', {
        sender_id: currentUser.id,
        receiver_id: currentFriendId,
        content: content
    });
    
    try {
        socket.emit('send_message', {
            sender_id: currentUser.id,
            receiver_id: currentFriendId,
            content: content
        });
        console.log('消息发送请求已发出');
    } catch (error) {
        console.error('发送消息失败:', error);
        alert('发送消息失败，请检查网络连接');
        const tempMessages = document.querySelectorAll('[data-temporary="true"]');
        tempMessages.forEach(temp => temp.remove());
    }
    
    try {
        if (typeof AndroidBridge !== 'undefined' && AndroidBridge.sendSms) {
            const phoneNumber = currentFriendInfo ? currentFriendInfo.username : '';
            if (phoneNumber) {
                console.log('通过Android桥接发送SMS通知到:', phoneNumber);
                AndroidBridge.sendSms(phoneNumber, content.substring(0, 70));
            }
        }
    } catch (e) {
        console.log('SMS桥接调用失败（非Android环境）:', e);
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
    handleFriendTyping();
}

function updateUserAvatar(avatarUrl) {
    const avatarInitial = getAvatarInitial(currentUser.username);
    const initialElement = document.getElementById('user-avatar-initial');
    
    const src = safeAvatarSrc(avatarUrl);
    if (src) {
        const imgElement = document.getElementById('user-avatar-img');
        if (imgElement) {
            imgElement.src = src;
            imgElement.style.display = 'block';
        }
        if (initialElement) initialElement.style.display = 'none';
    } else {
        const imgElement = document.getElementById('user-avatar-img');
        if (imgElement) imgElement.style.display = 'none';
        if (initialElement) {
            initialElement.style.display = 'flex';
            initialElement.textContent = avatarInitial;
        }
    }
}

function switchTab(tab) {
    currentTab = tab;
    
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(`${tab}-tab`).style.display = 'flex';
    
    if (tab === 'contacts') {
        loadContacts();
    } else if (tab === 'blacklist') {
        loadBlacklist();
    }
}

async function openProfile() {
    try {
        const response = await fetch(`/api/user/${currentUser.id}`);
        const user = await response.json();
        
        // 显示头像（如果有则显示图片，否则显示初始字母）
        const imgElement = document.getElementById('profile-avatar-img');
        const initialElement = document.getElementById('profile-avatar-initial');
        if (user.avatar) {
            const src = safeAvatarSrc(user.avatar);
            if (src) {
                imgElement.src = src;
                imgElement.style.display = 'block';
                initialElement.style.display = 'none';
            } else {
                imgElement.style.display = 'none';
                initialElement.style.display = 'block';
                initialElement.textContent = getAvatarInitial(user.username);
            }
        } else {
            imgElement.style.display = 'none';
            initialElement.style.display = 'block';
            initialElement.textContent = getAvatarInitial(user.username);
        }
        
        document.getElementById('profile-username').value = user.username || '';
        document.getElementById('profile-bio').value = user.bio || '';
        document.getElementById('profile-password').value = '';
        document.getElementById('profile-modal').style.display = 'flex';
    } catch (error) {
        console.error('加载个人资料失败:', error);
    }
}

function closeProfile() {
    document.getElementById('profile-modal').style.display = 'none';
}

async function saveProfile() {
    const username = document.getElementById('profile-username').value.trim();
    const bio = document.getElementById('profile-bio').value.trim();
    const password = document.getElementById('profile-password').value;
    
    if (!username) {
        alert('用户名不能为空');
        return;
    }
    
    try {
        const data = { username, bio };
        if (password) {
            data.password = password;
        }
        
        const response = await fetch(`/api/user/${currentUser.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentUser.username = username;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            document.getElementById('current-user').textContent = `欢迎, ${username}`;
            updateUserAvatar();
            closeProfile();
            alert('保存成功！');
        } else {
            alert(result.error || '保存失败');
        }
    } catch (error) {
        console.error('保存个人资料失败:', error);
        alert('保存失败，请重试');
    }
}

async function openFriendProfile() {
    if (!currentFriendId) return;
    
    try {
        const response = await fetch(`/api/user/${currentFriendId}`);
        const user = await response.json();
        
        currentFriendInfo = user;
        
        const imgEl = document.getElementById('friend-profile-avatar-img');
        const initEl = document.getElementById('friend-profile-avatar');
        const src = safeAvatarSrc(user.avatar);
        if (src) {
            imgEl.src = src;
            imgEl.style.display = 'block';
            if (initEl) initEl.style.display = 'none';
        } else {
            if (imgEl) imgEl.style.display = 'none';
            if (initEl) {
                initEl.style.display = 'block';
                initEl.textContent = getAvatarInitial(user.username);
            }
        }
        document.getElementById('friend-profile-username').value = user.username || '';
        document.getElementById('friend-profile-bio').value = user.bio || '';
        document.getElementById('friend-profile-modal').style.display = 'flex';
    } catch (error) {
        console.error('加载好友资料失败:', error);
    }
}

function closeFriendProfile() {
    document.getElementById('friend-profile-modal').style.display = 'none';
}

async function deleteFriend() {
    if (!currentFriendId) return;
    if (!confirm('确定要删除这位好友吗？')) return;
    
    try {
        const response = await fetch('/api/friend/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                friend_id: currentFriendId
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            closeFriendProfile();
            currentFriendId = null;
            currentFriendInfo = null;
            document.getElementById('no-chat-selected').style.display = 'flex';
            document.getElementById('chat-window').style.display = 'none';
            loadFriends();
            loadContacts();
            if (isMobile()) {
                showMobileSidebar();
            }
            alert('已删除好友');
        } else {
            alert(result.error || '删除失败');
        }
    } catch (error) {
        console.error('删除好友失败:', error);
        alert('删除失败，请重试');
    }
}

async function blockFriend() {
    if (!currentFriendId) return;
    if (!confirm('确定要拉黑这位用户吗？拉黑后将无法接收对方消息。')) return;
    
    try {
        const response = await fetch('/api/blacklist/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                blocked_user_id: currentFriendId
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            closeFriendProfile();
            currentFriendId = null;
            currentFriendInfo = null;
            document.getElementById('no-chat-selected').style.display = 'flex';
            document.getElementById('chat-window').style.display = 'none';
            loadFriends();
            loadContacts();
            loadBlacklist();
            if (isMobile()) {
                showMobileSidebar();
            }
            alert('已加入黑名单');
        } else {
            alert(result.error || '操作失败');
        }
    } catch (error) {
        console.error('拉黑失败:', error);
        alert('操作失败，请重试');
    }
}

async function loadContacts() {
    const contactsList = document.getElementById('contacts-list');
    try {
        const response = await fetch(`/api/friends/${currentUser.id}`);
        const friends = await response.json();
        
        contactsList.innerHTML = '';
        
        if (friends.length === 0) {
            contactsList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">暂无联系人</p>';
            return;
        }
        
        friends.forEach(friend => {
            const contactElement = document.createElement('div');
            contactElement.className = 'contact-item';
            contactElement.innerHTML = `
                <span class="contact-item-name">${escapeHtml(friend.username)}</span>
                <button class="contact-btn" onclick="selectFriendFromContacts(${friend.id}, '${escapeHtml(friend.username)}')">发起聊天</button>
            `;
            contactsList.appendChild(contactElement);
        });
    } catch (error) {
        console.error('加载通讯录失败:', error);
        contactsList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">加载失败</p>';
    }
}

async function selectFriendFromContacts(friendId, username) {
    switchTab('friends');
    
    const friendItem = document.querySelector(`[data-friend-id="${friendId}"]`);
    if (friendItem) {
        friendItem.click();
    } else {
        const friend = { id: friendId, username: username };
        await selectFriend(friend);
    }
}

async function loadBlacklist() {
    const blacklistList = document.getElementById('blacklist-list');
    try {
        const response = await fetch(`/api/blacklist/${currentUser.id}`);
        const blacklist = await response.json();
        
        blacklistList.innerHTML = '';
        
        if (blacklist.length === 0) {
            blacklistList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">黑名单为空</p>';
            return;
        }
        
        blacklist.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.className = 'blacklist-item';
            itemElement.innerHTML = `
                <span class="blacklist-item-name">${escapeHtml(item.blocked_user_name)}</span>
                <button class="unblock-btn" onclick="unblockUser(${item.blocked_user_id})">移除</button>
            `;
            blacklistList.appendChild(itemElement);
        });
    } catch (error) {
        console.error('加载黑名单失败:', error);
        blacklistList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">加载失败</p>';
    }
}

async function unblockUser(blockedUserId) {
    if (!confirm('确定要移除黑名单吗？')) return;
    
    try {
        const response = await fetch('/api/blacklist/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                blocked_user_id: blockedUserId
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            loadBlacklist();
            alert('已从黑名单移除');
        } else {
            alert(result.error || '操作失败');
        }
    } catch (error) {
        console.error('移除黑名单失败:', error);
        alert('操作失败，请重试');
    }
}

async function selectFriend(friend) {
    currentFriendId = friend.id;
    currentFriendInfo = friend;
    
    document.querySelectorAll('.friend-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-friend-id="${friend.id}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('chat-window').style.display = 'flex';
    document.getElementById('chat-with-username').textContent = friend.username;
    document.getElementById('friend-avatar-initial').textContent = getAvatarInitial(friend.username);
    
    unreadMessages[friend.id] = 0;
    loadFriends();
    
    loadMessages(friend.id);

    if (isMobile()) {
        showMobileChat();
    }
}

function closeChat() {
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('no-chat-selected').style.display = 'flex';
    currentFriendId = null;
    currentFriendInfo = null;

    if (isMobile()) {
        showMobileSidebar();
    }
}

async function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        const response = await fetch('/api/avatar/upload/' + currentUser.id, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (response.ok) {
            const imgElement = document.getElementById('profile-avatar-img');
            const initialElement = document.getElementById('profile-avatar-initial');
            imgElement.src = data.avatar_url;
            imgElement.style.display = 'block';
            initialElement.style.display = 'none';
            // 同时更新侧边栏头像
            updateUserAvatar(data.avatar_url);
            alert('头像上传成功！');
        } else {
            alert(data.error || '上传失败');
        }
    } catch (error) {
        console.error('上传头像失败:', error);
        alert('上传头像失败，请重试');
    }
}

function isAndroidWebView() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('wv') >= 0 || window.AndroidBridge !== undefined;
}

function testNotification() {
    console.log('🧪 正在测试通知功能...');
    
    if (isAndroidWebView()) {
        console.log('📱 检测到Android WebView环境');
    }
    
    if (window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function') {
        console.log('📱 使用Android原生通知测试');
        window.AndroidBridge.showNotification('家庭聊天 - 测试通知', '✅ Android原生通知正常工作！');
        alert('✅ 已发出Android原生通知，请检查通知栏！');
        return;
    }
    
    if (!('Notification' in window)) {
        showBrowserCompatibilityTip();
        return;
    }
    
    if (Notification.permission === 'granted') {
        try {
            const notification = new Notification('家庭聊天 - 测试通知', {
                body: '✅ 通知功能正常工作！',
                icon: '/static/icon.svg',
                vibrate: [200, 100, 200, 100, 200],
                tag: 'family-chat-test'
            });
            
            notification.onclick = function() {
                window.focus();
                notification.close();
            };
            
            console.log('✅ 测试通知已发出');
            alert('✅ 测试通知已发出，请检查通知栏！');
        } catch (e) {
            console.error('❌ 显示测试通知失败:', e);
            alert('无法显示通知，请检查权限或尝试使用其他浏览器');
        }
    } else if (Notification.permission === 'default') {
        console.log('🔔 请求通知权限...');
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                alert('✅ 通知权限已开启！再次点击测试通知按钮测试');
            } else {
                showPermissionHelpTip();
            }
        });
    } else {
        showPermissionHelpTip();
    }
}

function showBrowserCompatibilityTip() {
    const browserTip = `⚠️ 您的浏览器不支持通知功能！

📱 建议解决方案：

方案一（推荐）：
使用我们的Android APP
- 自动处理通知权限
- 功能更完整

方案二：
更换浏览器（推荐）：
• Chrome 浏览器
• Edge 浏览器
• Firefox 浏览器

方案三：
继续使用，聊天功能仍然正常
只是无法收到后台通知`;
    alert(browserTip);
}

function showPermissionHelpTip() {
    const helpTip = `🔔 通知权限设置帮助

在系统设置中开启：
1. 打开手机"设置"
2. 找到"应用"或"应用管理"
3. 找到当前APP/浏览器
4. 打开"通知权限"
5. 允许显示通知

开启后刷新页面重试！`;
    alert(helpTip);
}

function checkNotificationPermission() {
    if (!('Notification' in window)) {
        return '不支持';
    }
    const status = Notification.permission;
    console.log('📱 通知权限状态:', status);
    return status;
}

function requestNotificationPermissionManually() {
    if (!('Notification' in window)) {
        alert('您的浏览器不支持通知功能');
        return;
    }
    
    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            console.log('✅ 通知权限已授予');
        }
    });
}

// ===== 语音输入按钮事件绑定 =====
function initVoiceButton() {
    const voiceBtn = document.getElementById('voice-input-btn');
    if (!voiceBtn) return;

    voiceBtn.addEventListener('click', function(e) {
        if (isAudioRecording) return;
        toggleSpeechRecognition();
    });

    voiceBtn.addEventListener('mousedown', function(e) {
        if (isSpeechRecording) return;
        isLongPress = false;
        longPressTimer = setTimeout(function() {
            isLongPress = true;
            startVoiceRecording();
        }, 400);
    });

    voiceBtn.addEventListener('mouseup', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (isLongPress) {
            stopVoiceRecording();
        }
    });

    voiceBtn.addEventListener('mouseleave', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (isLongPress) {
            stopVoiceRecording();
        }
    });

    voiceBtn.addEventListener('touchstart', function(e) {
        if (isSpeechRecording) return;
        isLongPress = false;
        longPressTimer = setTimeout(function() {
            isLongPress = true;
            startVoiceRecording();
        }, 400);
    }, { passive: true });

    voiceBtn.addEventListener('touchend', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (isLongPress) {
            stopVoiceRecording();
        }
    }, { passive: true });

    voiceBtn.addEventListener('touchcancel', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (isLongPress) {
            stopVoiceRecording();
        }
    }, { passive: true });
}

// ===== 初始化聊天 =====
function initChat() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
    document.getElementById('current-user').textContent = `欢迎, ${currentUser.username}`;
    
    // 从服务器加载用户信息（包括头像）
    fetch('/api/user/' + currentUser.id)
        .then(function(r) { return r.json(); })
        .then(function(user) {
            if (user && user.avatar) {
                updateUserAvatar(user.avatar);
            } else {
                updateUserAvatar();
            }
        })
        .catch(function() {
            updateUserAvatar();
        });
    
    socket = io({
        transports: ['polling'],  // 只用 polling，服务器 threading 模式不支持 WebSocket
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    
    // ===== 保活机制：定期发送心跳保持连接 =====
    setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('heartbeat', { ts: Date.now() });
        }
    }, 15000);  // 每15秒发送一次心跳
    
    socket.on('connect', () => {
        console.log('✅ 已连接到服务器');
        isConnected = true;
        if (currentUser && currentUser.id) {
            socket.emit('join', { user_id: currentUser.id });
        }
        
        if (currentFriendId) {
            loadMessages(currentFriendId);
        }
        loadFriends();
    });
    
    socket.on('disconnect', (reason) => {
        console.log('❌ 与服务器断开连接:', reason);
        isConnected = false;
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log('🔄 重连成功');
        isConnected = true;
        socket.emit('join', { user_id: currentUser.id });
        
        if (currentFriendId) {
            loadMessages(currentFriendId);
        }
        loadFriends();
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`🔄 正在尝试重连... (第${attemptNumber}次)`);
    });
    
    socket.on('reconnect_error', (error) => {
        console.log('❌ 重连失败:', error);
    });
    
    socket.on('receive_message', (message) => {
        console.log('📨 收到消息:', message);
        handleReceivedMessage(message);
    });

    // ===== AI 流式回答（打字机效果） =====
    socket.on('ai_message', (data) => {
        var groupId = data.group_id;
        var content = data.content || '';
        var done = data.done || false;

        var aiIndicator = document.getElementById('ai-typing-' + groupId);
        if (!aiIndicator && !done) {
            // 创建 AI 打字指示器
            var messagesContainer = document.querySelector('#group-chat-window .messages-container');
            if (!messagesContainer) return;
            aiIndicator = document.createElement('div');
            aiIndicator.id = 'ai-typing-' + groupId;
            aiIndicator.className = 'message ai-typing';
            aiIndicator.innerHTML = '<div class="message-content"><span class="ai-typing-text"></span></div>';
            messagesContainer.appendChild(aiIndicator);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        if (aiIndicator && !done) {
            var textEl = aiIndicator.querySelector('.ai-typing-text');
            if (textEl) {
                textEl.textContent += content;
                var container = document.querySelector('#group-chat-window .messages-container');
                if (container) container.scrollTop = container.scrollHeight;
            }
        }

        if (done && aiIndicator) {
            aiIndicator.remove();
        }
    });

    // ===== DeepSeek AI 私聊流式回答（打字机效果） =====
    socket.on('ai_private_message', (data) => {
        var userId = data.user_id;
        var content = data.content || '';
        var done = data.done || false;

        var aiIndicator = document.getElementById('ai-private-typing');
        if (!aiIndicator && !done) {
            var messagesContainer = document.querySelector('#chat-window .messages-container');
            if (!messagesContainer) return;
            aiIndicator = document.createElement('div');
            aiIndicator.id = 'ai-private-typing';
            aiIndicator.className = 'message ai-typing';
            aiIndicator.innerHTML = '<div class="message-content"><span class="ai-typing-text"></span></div>';
            messagesContainer.appendChild(aiIndicator);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        if (aiIndicator && !done) {
            var textEl = aiIndicator.querySelector('.ai-typing-text');
            if (textEl) {
                textEl.textContent += content;
                var container = document.querySelector('#chat-window .messages-container');
                if (container) container.scrollTop = container.scrollHeight;
            }
        }

        if (done && aiIndicator) {
            aiIndicator.remove();
        }
    });
    
    socket.on('message_recalled', (data) => {
        console.log('🔄 收到消息撤回:', data);
        handleMessageRecalled(data);
    });
    
    socket.on('connect_error', (error) => {
        console.log('❌ 连接错误:', error);
        isConnected = false;
        updateConnectionStatus('#FF5722', '● 连接错误');
        showSyncStatus('连接错误，请检查网络', true);
    });
    
    // ===== 输入状态提示 =====
    socket.on('user_typing', function(data) {
        if (data.user_id !== currentUser.id && currentGroupId === null && data.room === String(currentFriendId)) {
            var el = document.getElementById('friend-typing');
            if (!el) {
                var header = document.querySelector('#chat-window .chat-header-info');
                if (header) {
                    var typingDiv = document.createElement('div');
                    typingDiv.id = 'friend-typing';
                    typingDiv.className = 'typing-indicator';
                    typingDiv.textContent = '对方正在输入...';
                    header.appendChild(typingDiv);
                }
            } else {
                el.style.display = 'block';
            }
        }
        // Group typing
        if (data.room === 'group_' + currentGroupId && data.user_id !== currentUser.id) {
            var el = document.getElementById('group-typing');
            if (el) {
                el.textContent = data.username + ' 正在输入...';
                el.style.display = 'block';
                clearTimeout(el._typingTimer);
                el._typingTimer = setTimeout(function() { el.style.display = 'none'; }, 3000);
            }
        }
    });
    
    socket.on('user_stop_typing', function(data) {
        if (data.room === 'group_' + currentGroupId) {
            var el = document.getElementById('group-typing');
            if (el) el.style.display = 'none';
        }
    });
    
    initWebRTCSocketHandlers();
    initVoiceButton();

    handleResize();
    
    loadFriends();
    loadFriendRequests();
    
    // 加载新功能
    loadStats();
    setupMessageLongPress();
    addImageButtons();
    addLocationButton();
    if (isSeniorMode) {
        document.documentElement.classList.add('senior-mode');
    }
    
    // 注册 Service Worker + 推送订阅
    registerServiceWorker();
    
    setInterval(() => {
        loadFriendRequests();
        if (currentFriendId && isConnected) {
            loadMessages(currentFriendId);
        }
    }, 30000);
    
    setInterval(() => {
        if (!isConnected) {
            showSyncStatus('正在尝试建立连接...', true);
        }
    }, 5000);
}

// ===================================================================
// ===== 以下为新增功能函数 =====
// ===================================================================

// ===== 1. 群组功能 =====

// 载入群列表
function loadGroups() {
    fetch('/api/groups/' + currentUser.id)
        .then(r => r.json())
        .then(groups => {
            groupsList = groups;
            var el = document.getElementById('groups-list');
            if (!el) return;
            el.innerHTML = '';
            groups.forEach(function(g) {
                var div = document.createElement('div');
                div.className = 'friend-item' + (currentGroupId === g.id ? ' active' : '');
                div.onclick = function() { openGroupChat(g.id); };
                div.innerHTML = '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<div class="group-avatar">' +
                    '<span>' + (g.name ? g.name.charAt(0).toUpperCase() : 'G') + '</span></div>' +
                    '<div style="flex:1"><div class="friend-name">' + escapeHtml(g.name) + '</div>' +
                    '<div class="last-message">' + (g.member_count || 0) + ' 位成员</div></div></div>';
                el.appendChild(div);
            });
        });
}

function showCreateGroupModal() {
    document.getElementById('create-group-modal').style.display = 'flex';
}
function closeCreateGroupModal() {
    document.getElementById('create-group-modal').style.display = 'none';
}

function createGroup() {
    var name = document.getElementById('create-group-name').value.trim();
    var desc = document.getElementById('create-group-desc').value.trim();
    if (!name) { alert('请输入群名称'); return; }
    showLoading();
    fetch('/api/groups/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: name, description: desc, created_by: currentUser.id})
    }).then(r => r.json()).then(data => {
        hideLoading();
        if (data.error) { alert(data.error); return; }
        closeCreateGroupModal();
        document.getElementById('create-group-name').value = '';
        document.getElementById('create-group-desc').value = '';
        loadGroups();
        switchTab('groups');
    }).catch(function() { hideLoading(); alert('创建失败'); });
}

function openGroupChat(groupId) {
    currentGroupId = groupId;
    currentFriendId = null;
    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('group-chat-window').style.display = 'flex';

    var group = groupsList.find(function(g) { return g.id === groupId; });
    if (group) {
        document.getElementById('group-chat-name').textContent = group.name;
        document.getElementById('group-chat-avatar-initial').textContent = group.name.charAt(0).toUpperCase();
    }

    document.querySelectorAll('#groups-list .friend-item').forEach(function(el) { el.classList.remove('active'); });
    loadGroupMessages();
    loadGroupMembers();
    loadTodoList();

    if (socket && socket.connected) {
        socket.emit('join_group', {group_id: groupId, user_id: currentUser.id});
    }

    closeChat();
}

function closeGroupChat() {
    currentGroupId = null;
    document.getElementById('group-chat-window').style.display = 'none';
    document.getElementById('no-chat-selected').style.display = 'flex';
}

function loadGroupMessages() {
    if (!currentGroupId) return;
    var container = document.getElementById('group-messages-container');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--wechat-text-light);">加载中...</div>';

    fetch('/api/group_messages/' + currentGroupId)
        .then(r => r.json())
        .then(messages => {
            container.innerHTML = '';
            messages.forEach(function(msg) {
                appendGroupMessage(msg);
            });
            container.scrollTop = container.scrollHeight;
        })
        .catch(function() {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--wechat-text-light);">加载失败</div>';
        });
}

function appendGroupMessage(msg) {
    var container = document.getElementById('group-messages-container');
    if (!container) return;

    if (msg.recalled) {
        var recallDiv = document.createElement('div');
        recallDiv.className = 'recall-notice';
        recallDiv.textContent = msg.sender_name + ' 撤回了一条消息';
        container.appendChild(recallDiv);
        return;
    }

    var div = document.createElement('div');
    div.className = 'message ' + (msg.sender_id === currentUser.id ? 'sent' : 'received');

    var senderName = document.createElement('div');
    senderName.style.cssText = 'font-size:11px;color:var(--wechat-text-light);margin-bottom:2px;';
    senderName.textContent = msg.sender_name;

    var contentDiv = document.createElement('div');
    contentDiv.className = 'msg-bubble';

    if (msg.sender_id !== currentUser.id) {
        contentDiv.appendChild(senderName);
    }

    var bubble = document.createElement('div');
    bubble.className = 'msg-content';

    if (msg.msg_type === 'text') {
        var html = escapeHtml(msg.content);
        html = html.replace(/@(\d+)/g, '<span class="mention-highlight">@$1</span>');
        bubble.innerHTML = html;
    } else if (msg.msg_type === 'image') {
        var img = document.createElement('img');
        img.className = 'msg-image';
        img.src = msg.content;
        img.onclick = function(e) {
            e.stopPropagation();
            previewImage(msg.content);
        };
        bubble.appendChild(img);
    } else if (msg.msg_type === 'voice') {
        bubble.innerHTML = '<div class="voice-msg-content" onclick="playVoice(this,\'' + escapeHtml(msg.voice_url || '') + '\')">' +
            '<span class="voice-play-icon">▶</span><div class="voice-wave"><span></span><span></span><span></span><span></span><span></span></div>' +
            '<span class="voice-duration">' + Math.round(msg.voice_duration || 0) + '"</span></div>';
    } else {
        bubble.textContent = msg.content;
    }

    contentDiv.appendChild(bubble);

    var timeDiv = document.createElement('div');
    timeDiv.className = 'msg-time';
    timeDiv.textContent = formatTime(msg.timestamp);
    contentDiv.appendChild(timeDiv);

    div.appendChild(contentDiv);
    container.appendChild(div);

    container.scrollTop = container.scrollHeight;
}

function sendGroupMessage() {
    var input = document.getElementById('group-message-input');
    var content = input.value.trim();
    if (!content || !currentGroupId || !socket) return;

    socket.emit('send_group_message', {
        group_id: currentGroupId,
        sender_id: currentUser.id,
        content: content,
        msg_type: 'text'
    });
    input.value = '';
}

function handleGroupKeyPress(e) {
    if (e.key === 'Enter') sendGroupMessage();
}

var groupTypingTimer = null;
function handleGroupTyping() {
    if (!socket || !currentGroupId) return;
    socket.emit('typing', {room: 'group_' + currentGroupId, user_id: currentUser.id, username: currentUser.username});
    if (groupTypingTimer) clearTimeout(groupTypingTimer);
    groupTypingTimer = setTimeout(function() {
        if (socket) socket.emit('stop_typing', {room: 'group_' + currentGroupId, user_id: currentUser.id, username: currentUser.username});
    }, 2000);
}

function openGroupProfile() {
    if (!currentGroupId) return;
    var group = groupsList.find(function(g) { return g.id === currentGroupId; });
    if (!group) return;
    document.getElementById('group-profile-name').value = group.name || '';
    document.getElementById('group-profile-desc').value = group.description || '';

    document.getElementById('announcement-text').textContent = group.announcement || '暂无公告';
    document.getElementById('announcement-text').style.display = 'block';
    document.getElementById('announcement-edit').style.display = 'none';
    document.getElementById('save-announcement-btn').style.display = 'none';

    loadGroupMembers();
    document.getElementById('group-profile-modal').style.display = 'flex';
}

function closeGroupProfile() {
    document.getElementById('group-profile-modal').style.display = 'none';
}

function loadGroupMembers() {
    if (!currentGroupId) return;
    fetch('/api/groups/' + currentGroupId + '/members')
        .then(r => r.json())
        .then(members => {
            currentGroupMembers = members;
            var el = document.getElementById('group-members-list');
            if (!el) return;
            el.innerHTML = '';
            var currentMember = members.find(function(m) { return m.user_id === currentUser.id; });
            var isAdmin = currentMember && (currentMember.role === 'owner' || currentMember.role === 'admin');

            members.forEach(function(m) {
                var div = document.createElement('div');
                div.className = 'group-member-item';
                div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--wechat-border);';

                var avatar = document.createElement('div');
                avatar.style.cssText = 'width:36px;height:36px;border-radius:50%;background:#07c160;color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;';
                avatar.textContent = m.username ? m.username.charAt(0).toUpperCase() : '?';

                var info = document.createElement('div');
                info.style.cssText = 'flex:1;';
                info.innerHTML = '<div style="font-size:14px;">' + escapeHtml(m.username) +
                    ' <span class="role-badge" style="font-size:11px;padding:2px 6px;border-radius:4px;' +
                    (m.role === 'owner' ? 'color:#d4a017;background:rgba(212,160,23,0.1);' :
                     m.role === 'admin' ? 'color:#07c160;background:rgba(7,193,96,0.1);' :
                     'color:var(--wechat-text-light);background:rgba(0,0,0,0.05);') + '">' +
                    (m.role === 'owner' ? '群主' : m.role === 'admin' ? '管理员' : '成员') + '</span></div>';

                div.appendChild(avatar);
                div.appendChild(info);

                if (isAdmin && m.user_id !== currentUser.id && currentMember.role === 'owner' ||
                    (isAdmin && m.user_id !== currentUser.id && m.role !== 'owner')) {
                    var removeBtn = document.createElement('button');
                    removeBtn.className = 'remove-member-btn';
                    removeBtn.style.cssText = 'padding:4px 8px;background:rgba(244,67,54,0.1);color:#f44336;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
                    removeBtn.textContent = '移除';
                    removeBtn.onclick = function() { removeGroupMember(m.user_id); };
                    div.appendChild(removeBtn);

                    if (m.role === 'member' && currentMember.role === 'owner') {
                        var setAdminBtn = document.createElement('button');
                        setAdminBtn.style.cssText = 'padding:4px 8px;background:rgba(7,193,96,0.1);color:#07c160;border:none;border-radius:4px;cursor:pointer;font-size:12px;margin-left:4px;';
                        setAdminBtn.textContent = '设为管理';
                        setAdminBtn.onclick = function() { setGroupMemberRole(m.user_id, 'admin'); };
                        div.appendChild(setAdminBtn);
                    }
                }

                el.appendChild(div);
            });
        });
}

function removeGroupMember(userId) {
    if (!confirm('确定移除该成员？')) return;
    fetch('/api/groups/' + currentGroupId + '/remove_member', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_id: userId, admin_id: currentUser.id})
    }).then(r => r.json()).then(function(data) {
        if (data.error) { alert(data.error); return; }
        loadGroupMembers();
    });
}

function setGroupMemberRole(userId, role) {
    fetch('/api/groups/' + currentGroupId + '/set_role', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_id: userId, role: role, admin_id: currentUser.id})
    }).then(r => r.json()).then(function(data) {
        if (data.error) { alert(data.error); return; }
        loadGroupMembers();
    });
}

function editAnnouncement() {
    var textEl = document.getElementById('announcement-text');
    var editEl = document.getElementById('announcement-edit');
    var saveBtn = document.getElementById('save-announcement-btn');
    textEl.style.display = 'none';
    editEl.value = textEl.textContent === '暂无公告' ? '' : textEl.textContent;
    editEl.style.display = 'block';
    saveBtn.style.display = 'inline-block';
}

function saveAnnouncement() {
    var content = document.getElementById('announcement-edit').value.trim();
    if (!content) { alert('公告不能为空'); return; }
    fetch('/api/groups/' + currentGroupId + '/announcement', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content: content, user_id: currentUser.id})
    }).then(r => r.json()).then(function(data) {
        if (data.error) { alert(data.error); return; }
        document.getElementById('announcement-text').textContent = content;
        document.getElementById('announcement-text').style.display = 'block';
        document.getElementById('announcement-edit').style.display = 'none';
        document.getElementById('save-announcement-btn').style.display = 'none';
        var g = groupsList.find(function(x) { return x.id === currentGroupId; });
        if (g) g.announcement = content;
    });
}

function leaveGroup() {
    if (!confirm('确定退出该群聊？')) return;
    fetch('/api/groups/' + currentGroupId + '/leave', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_id: currentUser.id})
    }).then(r => r.json()).then(function(data) {
        if (data.error) { alert(data.error); return; }
        closeGroupProfile();
        closeGroupChat();
        loadGroups();
    });
}

// ===== 2. 图片发送 =====

function sendImage() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { alert('图片不能超过 10MB'); return; }

        if (currentGroupId) {
            var formData = new FormData();
            formData.append('image', file);
            formData.append('sender_id', currentUser.id);
            formData.append('group_id', currentGroupId);

            fetch('/api/upload_image', {
                method: 'POST',
                body: formData
            }).then(r => r.json()).then(function(data) {
                if (data.url && socket) {
                    socket.emit('send_group_message', {
                        group_id: currentGroupId,
                        sender_id: currentUser.id,
                        content: data.url,
                        msg_type: 'image'
                    });
                }
            });
        } else if (currentFriendId) {
            var formData = new FormData();
            formData.append('image', file);
            formData.append('sender_id', currentUser.id);

            fetch('/api/upload_image', {
                method: 'POST',
                body: formData
            }).then(r => r.json()).then(function(data) {
                if (data.url && socket) {
                    socket.emit('send_message', {
                        sender_id: currentUser.id,
                        receiver_id: currentFriendId,
                        content: data.url,
                        msg_type: 'image'
                    });
                }
            });
        }
    };
    input.click();
}

function previewImage(url) {
    var modal = document.getElementById('image-preview-modal');
    var img = document.getElementById('preview-image');
    if (modal && img) {
        img.src = url;
        modal.style.display = 'flex';
    }
}
function closeImagePreview() {
    var modal = document.getElementById('image-preview-modal');
    if (modal) modal.style.display = 'none';
}

// ===== 3. 图片按钮添加到输入框 =====

function addImageButtons() {
    var inputArea = document.querySelector('#chat-window .message-input');
    if (inputArea) {
        // 移除旧的按钮（防重复）
        var oldBtn = inputArea.querySelector('#img-btn');
        if (oldBtn) oldBtn.remove();
        var imgBtn = document.createElement('button');
        imgBtn.id = 'img-btn';
        imgBtn.className = 'voice-input-btn';
        imgBtn.textContent = '🖼️';
        imgBtn.title = '发送图片';
        imgBtn.onclick = sendImage;
        imgBtn.style.fontSize = '16px';
        inputArea.insertBefore(imgBtn, inputArea.firstChild);
    }
    var groupInputArea = document.querySelector('#group-chat-window .message-input');
    if (groupInputArea) {
        var oldGBtn = groupInputArea.querySelector('#group-img-btn');
        if (oldGBtn) oldGBtn.remove();
        var gImgBtn = document.createElement('button');
        gImgBtn.id = 'group-img-btn';
        gImgBtn.className = 'voice-input-btn';
        gImgBtn.textContent = '🖼️';
        gImgBtn.title = '发送图片';
        gImgBtn.onclick = sendImage;
        gImgBtn.style.fontSize = '16px';
        groupInputArea.insertBefore(gImgBtn, groupInputArea.firstChild);
    }
}

// ===== 4. 多选 & 转发 =====

function setupMessageLongPress() {
    document.addEventListener('touchstart', function(e) {
        var msgEl = e.target.closest('.message');
        if (!msgEl) return;
        var timer = setTimeout(function() {
            enterMultiSelectMode(msgEl);
        }, 600);
        msgEl._longPressTimer = timer;
    }, {passive: true});

    document.addEventListener('touchend', function(e) {
        var msgEl = e.target.closest('.message');
        if (msgEl && msgEl._longPressTimer) {
            clearTimeout(msgEl._longPressTimer);
            delete msgEl._longPressTimer;
        }
    }, {passive: true});
}

function enterMultiSelectMode(el) {
    isMultiSelectMode = true;
    selectedMessages = [];
    document.querySelectorAll('.message').forEach(function(m) {
        m.classList.add('selectable');
        var cb = document.createElement('div');
        cb.className = 'checkbox';
        cb.textContent = '✓';
        m.insertBefore(cb, m.firstChild);
    });
    document.getElementById('multi-select-bar').style.display = 'flex';
    toggleMessageSelect(el);
}

function toggleMessageSelect(el) {
    if (!isMultiSelectMode) return;
    el.classList.toggle('selected');
    var msgId = el.dataset.msgId;
    if (!msgId) return;
    var idx = selectedMessages.indexOf(msgId);
    if (idx >= 0) {
        selectedMessages.splice(idx, 1);
    } else {
        selectedMessages.push(msgId);
    }
    document.getElementById('selected-count').textContent = '已选择 ' + selectedMessages.length + ' 条';
}

function cancelMultiSelect() {
    isMultiSelectMode = false;
    selectedMessages = [];
    document.querySelectorAll('.message').forEach(function(m) {
        m.classList.remove('selectable', 'selected');
        var cb = m.querySelector('.checkbox');
        if (cb) cb.remove();
    });
    document.getElementById('multi-select-bar').style.display = 'none';
}

function deleteSelected() {
    if (selectedMessages.length === 0) return;
    if (!confirm('确定删除选中的 ' + selectedMessages.length + ' 条消息？（仅本地删除）')) return;
    selectedMessages.forEach(function(id) {
        var el = document.querySelector('.message[data-msg-id="' + id + '"]');
        if (el) el.remove();
    });
    cancelMultiSelect();
}

function forwardSelected() {
    if (selectedMessages.length === 0) return;
    var modal = document.getElementById('forward-modal');
    var friendsListEl = document.getElementById('forward-friends-list');
    var groupsListEl = document.getElementById('forward-groups-list');

    friendsListEl.innerHTML = '<h4 style="font-size:13px;color:var(--wechat-text-secondary);margin:8px 0;">好友</h4>';
    groupsListEl.innerHTML = '<h4 style="font-size:13px;color:var(--wechat-text-secondary);margin:8px 0;">群聊</h4>';

    // 从服务器加载好友列表
    fetch('/api/friends/' + currentUser.id)
        .then(function(r) { return r.json(); })
        .then(function(friends) {
            friends.forEach(function(f) {
                var div = document.createElement('div');
                div.className = 'friend-item';
                div.style.cssText = 'padding:10px 12px;display:flex;align-items:center;gap:10px;';
                div.innerHTML = '<div style="width:36px;height:36px;border-radius:50%;background:#07c160;color:white;display:flex;align-items:center;justify-content:center;font-size:14px;">' +
                    f.username.charAt(0).toUpperCase() + '</div><span>' + escapeHtml(f.username) + '</span>';
                div.onclick = function() { doForward('friend', f.id, f.username); };
                friendsListEl.appendChild(div);
            });
        })
        .catch(function() {
            friendsListEl.innerHTML += '<p style="color:var(--wechat-text-light);padding:10px;text-align:center;">加载好友失败</p>';
        });

    // 使用已有的群组数据
    groupsList.forEach(function(g) {
        var div = document.createElement('div');
        div.className = 'friend-item';
        div.style.cssText = 'padding:10px 12px;display:flex;align-items:center;gap:10px;';
        div.innerHTML = '<div style="width:36px;height:36px;border-radius:50%;background:#07c160;color:white;display:flex;align-items:center;justify-content:center;font-size:14px;">' +
            g.name.charAt(0).toUpperCase() + '</div><span>' + escapeHtml(g.name) + '</span>';
        div.onclick = function() { doForward('group', g.id, g.name); };
        groupsListEl.appendChild(div);
    });

    modal.style.display = 'flex';
}

function closeForwardModal() {
    document.getElementById('forward-modal').style.display = 'none';
}

function doForward(type, targetId, targetName) {
    if (!confirm('转发 ' + selectedMessages.length + ' 条消息给 ' + targetName + '？')) return;
    var contents = [];
    selectedMessages.forEach(function(id) {
        var el = document.querySelector('.message[data-msg-id="' + id + '"]');
        if (el) {
            var bubble = el.querySelector('.msg-content');
            if (bubble) contents.push(bubble.textContent || bubble.innerText);
        }
    });

    if (contents.length === 0) { closeForwardModal(); cancelMultiSelect(); return; }

    var text = '📨 转发消息:\n' + contents.join('\n---\n');

    if (type === 'friend') {
        if (socket) {
            socket.emit('send_message', {
                sender_id: currentUser.id,
                receiver_id: targetId,
                content: text,
                msg_type: 'text'
            });
        }
    } else if (type === 'group') {
        if (socket) {
            socket.emit('send_group_message', {
                group_id: targetId,
                sender_id: currentUser.id,
                content: text,
                msg_type: 'text'
            });
        }
    }

    closeForwardModal();
    cancelMultiSelect();
    alert('已转发 ' + contents.length + ' 条消息');
}

// ===== 5. 输入状态提示 =====

var friendTypingTimer = null;
function handleFriendTyping() {
    if (!socket || !currentFriendId) return;
    socket.emit('typing', {room: String(currentFriendId), user_id: currentUser.id, username: currentUser.username});
    if (friendTypingTimer) clearTimeout(friendTypingTimer);
    friendTypingTimer = setTimeout(function() {
        if (socket) socket.emit('stop_typing', {room: String(currentFriendId), user_id: currentUser.id, username: currentUser.username});
    }, 2000);
}

// ===== 6. 老年模式 =====

function toggleSeniorMode() {
    isSeniorMode = !isSeniorMode;
    localStorage.setItem('seniorMode', isSeniorMode);
    document.documentElement.classList.toggle('senior-mode', isSeniorMode);
}

function togglePushNotifications() {
    if (!('Notification' in window)) {
        showToast('⚠️ 此浏览器不支持推送通知');
        return;
    }
    if (Notification.permission === 'granted') {
        showToast('✅ 推送通知已开启');
        // 手动发起一次注册
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(function(reg) {
                subscribePush(reg);
            });
        }
    } else if (Notification.permission === 'denied') {
        showToast('⚠️ 通知被拒绝，请在浏览器设置中开启');
    } else {
        Notification.requestPermission().then(function(permission) {
            if (permission === 'granted') {
                showToast('✅ 推送通知已开启');
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.ready.then(function(reg) {
                        subscribePush(reg);
                    });
                }
            } else {
                showToast('⚠️ 通知权限被拒绝');
            }
        });
    }
}

function showToast(msg) {
    var existing = document.getElementById('toast-msg');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'toast-msg';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;z-index:9999;max-width:80%;text-align:center;white-space:nowrap;transition:opacity 0.3s;';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() {
        el.style.opacity = '0';
        setTimeout(function() { el.remove(); }, 300);
    }, 2500);
}

// ===== 7. 聊天导出 =====

function exportChat() {
    if (!currentUser) return;
    showLoading();
    fetch('/api/export/chat/' + currentUser.id)
        .then(r => r.json())
        .then(function(data) {
            hideLoading();
            var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'family-chat-export-' + currentUser.username + '-' + new Date().toISOString().slice(0,10) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        })
        .catch(function() { hideLoading(); alert('导出失败'); });
}

// ===== 8. 访问统计 =====

function loadStats() {
    fetch('/api/stats')
        .then(r => r.json())
        .then(function(data) {
            var el = document.getElementById('stats-badge');
            if (el) {
                el.textContent = '访问 ' + (data.visits || 0) + ' · 防护 ' + (data.attacks || 0);
            }
        })
        .catch(function() {});
}

// ===== 9. 离线检测 =====

window.addEventListener('online', function() {
    document.getElementById('offline-banner').classList.remove('active');
});
window.addEventListener('offline', function() {
    document.getElementById('offline-banner').classList.add('active');
});

// ===== 10. 购物清单 / 待办事项 (群组功能) =====

function toggleTodoSection() {
    todoSectionVisible = !todoSectionVisible;
    var list = document.getElementById('todo-list');
    if (list) list.style.display = todoSectionVisible ? 'block' : 'none';
    var btn = document.querySelector('#todo-section .action-btn');
    if (btn) btn.textContent = todoSectionVisible ? '收起 ▲' : '展开 ▼';
}

function loadTodoList() {
    if (!currentGroupId) return;
    fetch('/api/todo/' + currentGroupId)
        .then(r => r.json())
        .then(function(lists) {
            renderTodoList(lists);
        })
        .catch(function() {});
}

function renderTodoList(lists) {
    var el = document.getElementById('todo-list');
    if (!el) return;

    if (!lists || lists.length === 0) {
        fetch('/api/todo/create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({group_id: currentGroupId, title: '共享清单', user_id: currentUser.id})
        }).then(r => r.json()).then(function(data) {
            if (data.id) loadTodoList();
        });
        el.innerHTML = '<p style="color:var(--wechat-text-light);font-size:13px;text-align:center;padding:12px;">正在创建清单...</p>';
        return;
    }

    el.innerHTML = '';
    lists.forEach(function(list) {
        var items = list.items || [];
        var section = document.createElement('div');
        section.innerHTML = '<div style="font-size:13px;font-weight:500;color:var(--wechat-text-secondary);margin:8px 0;">' +
            escapeHtml(list.title) + '</div>';

        items.forEach(function(item) {
            var itemDiv = document.createElement('div');
            itemDiv.className = 'todo-item';

            var cb = document.createElement('div');
            cb.className = 'todo-checkbox' + (item.done ? ' done' : '');
            cb.textContent = item.done ? '✓' : '';
            cb.onclick = function() { toggleTodoItem(item.id); };

            var text = document.createElement('span');
            text.className = 'todo-text' + (item.done ? ' done' : '');
            text.textContent = item.content;

            var del = document.createElement('button');
            del.className = 'todo-delete';
            del.textContent = '×';
            del.onclick = function() { deleteTodoItem(item.id); };

            itemDiv.appendChild(cb);
            itemDiv.appendChild(text);
            itemDiv.appendChild(del);
            section.appendChild(itemDiv);
        });

        el.appendChild(section);
    });
}

function addTodoItem() {
    var input = document.getElementById('todo-input');
    var content = input.value.trim();
    if (!content || !currentGroupId) return;

    fetch('/api/todo/item/add', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({todo_list_id: currentGroupId, content: content, user_id: currentUser.id})
    }).then(r => r.json()).then(function(data) {
        if (!data.error) {
            input.value = '';
            loadTodoList();
        }
    });
}

function toggleTodoItem(itemId) {
    fetch('/api/todo/item/toggle', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({item_id: itemId, user_id: currentUser.id})
    }).then(function() { loadTodoList(); });
}

function deleteTodoItem(itemId) {
    fetch('/api/todo/item/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({item_id: itemId})
    }).then(function() { loadTodoList(); });
}

// ===== 11. 工具函数 =====

function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) {
        d = new Date(ts);
    }
    if (isNaN(d.getTime())) return '';
    var h = d.getHours().toString().padStart(2, '0');
    var m = d.getMinutes().toString().padStart(2, '0');
    return h + ':' + m;
}

// ===== 12. 位置分享 =====

function sendLocation() {
    if (!navigator.geolocation) {
        alert('当前设备不支持定位功能');
        return;
    }
    showLoading();
    navigator.geolocation.getCurrentPosition(function(pos) {
        hideLoading();
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        var mapUrl = 'https://map.baidu.com?lat=' + lat + '&lng=' + lng;
        var content = '📍 [位置] 查看地图: ' + mapUrl;

        if (currentGroupId && socket) {
            socket.emit('send_group_message', {
                group_id: currentGroupId,
                sender_id: currentUser.id,
                content: content,
                msg_type: 'text'
            });
        } else if (currentFriendId && socket) {
            socket.emit('send_message', {
                sender_id: currentUser.id,
                receiver_id: currentFriendId,
                content: content,
                msg_type: 'text'
            });
        }
    }, function(err) {
        hideLoading();
        alert('获取位置失败: ' + err.message);
    }, {enableHighAccuracy: false, timeout: 10000});
}

function addLocationButton() {
    var inputAreas = document.querySelectorAll('.message-input');
    inputAreas.forEach(function(area) {
        // 移除旧的按钮（防重复）
        var oldLoc = area.querySelector('#loc-btn');
        if (oldLoc) oldLoc.remove();
        var locBtn = document.createElement('button');
        locBtn.id = 'loc-btn';
        locBtn.className = 'voice-input-btn';
        locBtn.textContent = '📍';
        locBtn.title = '发送位置';
        locBtn.onclick = sendLocation;
        locBtn.style.fontSize = '16px';
        area.insertBefore(locBtn, area.querySelector('.voice-input-btn'));
    });
}

// ===== 13. Android 原生图片选择回调 =====
// 当用户在 Android 原生端通过相册或相机选择图片后，此函数被调用
function handleAndroidImage(dataUrl) {
    console.log('handleAndroidImage called, length:', dataUrl.length);
    // 将 base64 图片上传到服务器
    var byteString = atob(dataUrl.split(',')[1]);
    var mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0];
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    var blob = new Blob([ab], {type: mimeType});
    var formData = new FormData();
    formData.append('image', blob, 'android_image_' + Date.now() + '.jpg');
    formData.append('sender_id', currentUser.id);
    if (currentGroupId) formData.append('group_id', currentGroupId);
    
    showLoading();
    fetch('/api/upload_image', {
        method: 'POST',
        body: formData
    }).then(function(r) { return r.json(); }).then(function(data) {
        hideLoading();
        if (data.url && socket) {
            if (currentGroupId) {
                socket.emit('send_group_message', {
                    group_id: currentGroupId,
                    sender_id: currentUser.id,
                    content: data.url,
                    msg_type: 'image'
                });
            } else if (currentFriendId) {
                socket.emit('send_message', {
                    sender_id: currentUser.id,
                    receiver_id: currentFriendId,
                    content: data.url,
                    msg_type: 'image'
                });
            }
        }
    }).catch(function() { hideLoading(); alert('图片上传失败'); });
}

// ===== PWA: Service Worker 注册 + 推送订阅 =====
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.log('[PWA] Service Worker 不支持');
        return;
    }
    // 延迟注册，避免阻塞首次渲染
    setTimeout(function() {
        navigator.serviceWorker.register('/static/sw.js', {scope: '/'})
            .then(function(reg) {
                console.log('[PWA] Service Worker 注册成功:', reg.scope);
                // 等待激活后再订阅推送
                if (reg.active) {
                    subscribePush(reg);
                } else {
                    reg.addEventListener('activate', function() {
                        subscribePush(reg);
                    });
                }
                // 检测更新
                reg.addEventListener('updatefound', function() {
                    var newWorker = reg.installing;
                    newWorker.addEventListener('statechange', function() {
                        if (newWorker.state === 'activated') {
                            console.log('[PWA] 新版本已激活');
                            showToast('🔄 新版本已就绪，刷新后生效');
                        }
                    });
                });
            })
            .catch(function(err) {
                console.log('[PWA] Service Worker 注册失败:', err);
            });
    }, 1000);
}

function subscribePush(reg) {
    if (!('PushManager' in window)) {
        console.log('[PWA] Push API 不支持');
        return;
    }
    if (!currentUser || !currentUser.id) return;

    // 先获取 VAPID 公钥
    fetch('/api/push/vapid-public-key')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.public_key) return;
            var applicationServerKey = urlBase64ToUint8Array(data.public_key);
            return reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });
        })
        .then(function(sub) {
            if (!sub) return;
            // 发送到后端保存
            fetch('/api/push/subscribe', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: currentUser.id,
                    subscription: sub.toJSON()
                })
            }).then(function(r) { return r.json(); }).then(function(resp) {
                if (resp.success) console.log('[PWA] 推送订阅成功');
            });
        })
        .catch(function(err) {
            // 用户拒绝权限或出错，静默处理
            if (err.name === 'NotAllowedError') {
                console.log('[PWA] 通知权限被拒绝');
            } else if (err.name === 'AbortError') {
                console.log('[PWA] 推送订阅被中止（HTTP 环境常见）');
            } else {
                console.log('[PWA] 推送订阅失败:', err.message);
            }
        });
}

// 工具：将 Base64 URL-Safe 字符串转为 Uint8Array（Push API 需要）
function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var output = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) {
        output[i] = rawData.charCodeAt(i);
    }
    return output;
}

// ===== 初始化：在 DOM 就绪后执行额外的初始化 =====
// 按钮重复问题已通过防重复 ID 机制解决，底部不再需要独立调用

document.addEventListener('DOMContentLoaded', function() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        
        try {
            if (window.AndroidBridge && window.AndroidBridge.setUserId) {
                window.AndroidBridge.setUserId(currentUser.id);
                console.log('AndroidBridge.setUserId called on auto-login:', currentUser.id);
            }
        } catch (e) {
            console.log('AndroidBridge not available:', e);
        }
        
        initChat();
    }
    
    document.getElementById('profile-modal').addEventListener('click', function(e) {
        if (e.target === this) closeProfile();
    });
    document.getElementById('friend-profile-modal').addEventListener('click', function(e) {
        if (e.target === this) closeFriendProfile();
    });

    window.addEventListener('resize', function() {
        handleResize();
    });

    if (isMobile() && !currentFriendId) {
        const sidebar = document.querySelector('.sidebar');
        const chatArea = document.querySelector('.chat-area');
        if (sidebar) sidebar.style.display = 'flex';
        if (chatArea) chatArea.style.display = 'none';
    }
});