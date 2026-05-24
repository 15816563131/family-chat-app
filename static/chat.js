let socket;
let currentUser = null;
let currentFriendId = null;
let currentFriendInfo = null;
let receivedMessages = {};
let isConnected = false;
let reconnectTimer = null;
let lastMessageCheckTime = Date.now();
let currentTab = 'friends';

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
            
            // 触发登录成功事件，用于请求通知权限
            try {
                const loginEvent = new Event('userLoggedIn');
                window.dispatchEvent(loginEvent);
                console.log('登录成功事件已触发');
            } catch (e) {
                console.log('触发登录事件失败:', e);
            }
            
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
                <div class="friend-name">${friend.username}${unreadBadge}</div>
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
    if (currentFriendId) {
        loadMessages(currentFriendId);
    }
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
    
    unreadMessages[friend.id] = 0;
    loadFriends();
    
    loadMessages(friend.id);
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
    
    const avatarText = (message.sender_name || 'U').charAt(0).toUpperCase();
    
    messageElement.innerHTML = `
        <div class="message-avatar">${avatarText}</div>
        <div class="message-content-wrapper">
            <div class="message-content">
                ${message.content}
            </div>
            <div class="message-time">${message.is_temporary ? '发送中...' : time}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
}

const displayedMessageIds = new Set();
const unreadMessages = {};

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
        
        // 显示系统通知
        if (typeof showNotification === 'function') {
            const senderName = '好友消息';
            showNotification('家庭聊天 - ' + senderName, message.content);
        }
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
    
    loadFriends();
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
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function getAvatarInitial(username) {
    return username ? username.charAt(0).toUpperCase() : '?';
}

function updateUserAvatar() {
    const avatarInitial = getAvatarInitial(currentUser.username);
    const avatarElements = document.querySelectorAll('#user-avatar, #profile-avatar');
    avatarElements.forEach(el => {
        if (el) el.textContent = avatarInitial;
    });
    const initialElement = document.getElementById('user-avatar-initial');
    if (initialElement) initialElement.textContent = avatarInitial;
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
        
        document.getElementById('profile-avatar-initial').textContent = getAvatarInitial(user.username);
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
        document.getElementById('friend-profile-avatar').textContent = getAvatarInitial(user.username);
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
                <span class="contact-item-name">${friend.username}</span>
                <button class="contact-btn" onclick="selectFriendFromContacts(${friend.id}, '${friend.username}')">发起聊天</button>
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
                <span class="blacklist-item-name">${item.blocked_user_name}</span>
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

function initChat() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
    document.getElementById('current-user').textContent = `欢迎, ${currentUser.username}`;
    
    updateUserAvatar();
    
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    
    function updateConnectionStatus(status, text) {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.style.color = status;
            statusElement.textContent = text;
        }
    }
    
    function showSyncStatus(message, isError = false) {
        console.log(message);
    }
    
    socket.on('connect', () => {
        console.log('✅ 已连接到服务器');
        isConnected = true;
        updateConnectionStatus('#4CAF50', '● 已连接');
        showSyncStatus('连接成功，开始同步消息...');
        socket.emit('join', { user_id: currentUser.id });
        
        if (currentFriendId) {
            loadMessages(currentFriendId);
        }
        loadFriends();
    });
    
    socket.on('disconnect', (reason) => {
        console.log('❌ 与服务器断开连接:', reason);
        isConnected = false;
        updateConnectionStatus('#FF5722', '● 已断开');
        showSyncStatus('连接断开，正在尝试重新连接...', true);
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log('🔄 重连成功');
        isConnected = true;
        updateConnectionStatus('#4CAF50', '● 已连接');
        showSyncStatus('已重连，正在同步...');
        socket.emit('join', { user_id: currentUser.id });
        
        if (currentFriendId) {
            loadMessages(currentFriendId);
        }
        loadFriends();
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`🔄 正在尝试重连... (第${attemptNumber}次)`);
        updateConnectionStatus('#FFC107', '● 重连中');
    });
    
    socket.on('reconnect_error', (error) => {
        console.log('❌ 重连失败:', error);
        showSyncStatus('重连失败，继续尝试...', true);
    });
    
    socket.on('receive_message', (message) => {
        console.log('📨 收到消息:', message);
        handleReceivedMessage(message);
    });
    
    socket.on('connect_error', (error) => {
        console.log('❌ 连接错误:', error);
        isConnected = false;
        updateConnectionStatus('#FF5722', '● 连接错误');
        showSyncStatus('连接错误，请检查网络', true);
    });
    
    loadFriends();
    loadFriendRequests();
    
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

async function selectFriend(friend) {
    currentFriendId = friend.id;
    currentFriendInfo = friend;
    
    document.querySelectorAll('.friend-item').forEach(item => {
        item.classList.remove('active');
    });
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
    
    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('chat-window').style.display = 'flex';
    document.getElementById('chat-with-username').textContent = friend.username;
    document.getElementById('friend-avatar-initial').textContent = getAvatarInitial(friend.username);
    
    unreadMessages[friend.id] = 0;
    loadFriends();
    
    loadMessages(friend.id);
}

window.onload = function() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        initChat();
    }
    
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    document.getElementById('profile-modal').addEventListener('click', function(e) {
        if (e.target === this) closeProfile();
    });
    document.getElementById('friend-profile-modal').addEventListener('click', function(e) {
        if (e.target === this) closeFriendProfile();
    });
};
