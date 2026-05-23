let socket;
let currentUser = null;
let currentFriendId = null;
let receivedMessages = {};

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
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    
    if (!username || !password) {
        showMessage('请填写所有字段');
        return;
    }
    
    if (password !== passwordConfirm) {
        showMessage('两次密码输入不一致');
        return;
    }
    
    if (password.length < 6) {
        showMessage('密码长度至少为6位');
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
            setTimeout(() => {
                showLogin();
                document.getElementById('login-username').value = username;
            }, 1000);
        } else {
            showMessage(data.error || '注册失败');
        }
    } catch (error) {
        showMessage('网络错误，请重试');
        console.error('注册错误:', error);
    }
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        showMessage('请输入用户名和密码');
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
            initChat();
        } else {
            showMessage(data.error || '登录失败');
        }
    } catch (error) {
        showMessage('网络错误，请重试');
        console.error('登录错误:', error);
    }
}

function logout() {
    if (socket) {
        socket.emit('leave', { user_id: currentUser.id });
        socket.disconnect();
    }
    currentUser = null;
    currentFriendId = null;
    receivedMessages = {};
    localStorage.removeItem('currentUser');
    
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
    showLogin();
}

function initChat() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
    document.getElementById('current-user').textContent = `欢迎, ${currentUser.username}`;
    
    socket = io('http://' + window.location.host, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000
    });
    
    function updateConnectionStatus(status, text) {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.style.color = status;
            statusElement.textContent = text;
        }
    }
    
    socket.on('connect', () => {
        console.log('已连接到服务器');
        updateConnectionStatus('#4CAF50', '● 已连接');
        socket.emit('join', { user_id: currentUser.id });
    });
    
    socket.on('disconnect', () => {
        console.log('与服务器断开连接');
        updateConnectionStatus('#FF5722', '● 已断开');
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log('重连成功');
        updateConnectionStatus('#4CAF50', '● 已连接');
    });
    
    socket.on('reconnect_attempt', () => {
        console.log('正在尝试重连...');
        updateConnectionStatus('#FFC107', '● 重连中');
    });
    
    socket.on('receive_message', (message) => {
        handleReceivedMessage(message);
    });
    
    loadFriends();
    loadFriendRequests();
    
    setInterval(() => {
        loadFriendRequests();
    }, 5000);
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
            friendElement.onclick = () => selectFriend(friend);
            
            friendElement.innerHTML = `
                <div class="friend-name">${friend.username}</div>
                <div class="last-message">${friend.last_message || '暂无消息'}</div>
            `;
            
            friendsList.appendChild(friendElement);
        });
    } catch (error) {
        console.error('加载好友列表失败:', error);
    }
}

async function loadFriendRequests() {
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
                    <span>${req.sender_username}</span>
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
                <span>${user.username}</span>
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
}

function toggleFriendRequests() {
    const list = document.getElementById('friend-requests-list');
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

async function selectFriend(friend) {
    currentFriendId = friend.id;
    
    document.querySelectorAll('.friend-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('chat-window').style.display = 'flex';
    document.getElementById('chat-with-username').textContent = friend.username;
    
    loadMessages(friend.id);
}

async function loadMessages(friendId) {
    try {
        const response = await fetch(`/api/messages/${currentUser.id}/${friendId}`);
        const messages = await response.json();
        
        const messagesContainer = document.getElementById('messages-container');
        messagesContainer.innerHTML = '';
        displayedMessageIds.clear(); // 清除已显示消息集合
        
        messages.forEach(message => {
            displayedMessageIds.add(message.id);
            addMessageToUI(message);
        });
        
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        console.error('加载消息失败:', error);
    }
}

function addMessageToUI(message) {
    const messagesContainer = document.getElementById('messages-container');
    
    // 检查是否已经有相同ID的消息
    if (message.id && document.querySelector(`[data-message-id="${message.id}"]`)) {
        return; // 消息已存在，不重复添加
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message ' + (message.is_mine ? 'sent' : 'received');
    // 给消息添加 data-id 属性
    if (message.id) {
        messageElement.dataset.messageId = message.id;
    }
    // 如果是临时消息，添加标记
    if (message.is_temporary) {
        messageElement.dataset.temporary = 'true';
        messageElement.dataset.tempContent = message.content;
        messageElement.dataset.tempTimestamp = message.timestamp;
    }
    
    const time = new Date(message.timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageElement.innerHTML = `
        <div class="message-content">
            <div>${message.content}</div>
            <div class="message-time">${time}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
}

// 用来避免重复显示的消息ID集合
const displayedMessageIds = new Set();

function handleReceivedMessage(message) {
    // 避免重复显示消息
    if (message.id && displayedMessageIds.has(message.id)) {
        return;
    }
    
    if (message.id) {
        displayedMessageIds.add(message.id);
    }
    
    // 如果是自己的消息，尝试移除对应的临时消息
    if (message.is_mine) {
        const tempMessages = document.querySelectorAll('[data-temporary="true"]');
        for (let temp of tempMessages) {
            if (temp.dataset.tempContent === message.content) {
                temp.remove();
                break;
            }
        }
    }
    
    // 只有当消息来自当前聊天的好友时才显示
    if (message.sender_id === currentFriendId || message.receiver_id === currentFriendId) {
        addMessageToUI(message);
        const messagesContainer = document.getElementById('messages-container');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    if (!receivedMessages[message.sender_id]) {
        receivedMessages[message.sender_id] = [];
    }
    receivedMessages[message.sender_id].push(message);
    
    loadFriends();
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentFriendId) {
        return;
    }
    
    // 立即在发送方显示消息，优化用户体验
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
    
    // 发送到服务器
    try {
        socket.emit('send_message', {
            sender_id: currentUser.id,
            receiver_id: currentFriendId,
            content: content
        });
    } catch (error) {
        console.error('发送消息失败:', error);
        alert('发送消息失败，请检查网络连接');
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

window.onload = function() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        initChat();
    }
};
