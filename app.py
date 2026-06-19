from flask import Flask, render_template, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os
import logging

app = Flask(__name__)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'family-chat-secret-key-2024')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///family_chat.db').replace('postgres://', 'postgresql://')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True, 'pool_recycle': 300}
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20MB (支持语音文件)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
db = SQLAlchemy(app)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    avatar = db.Column(db.String(200), default='')
    bio = db.Column(db.String(500), default='这个人很懒，什么都没写~')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    sent_requests = db.relationship('FriendRequest', foreign_keys='FriendRequest.sender_id', backref='sender', lazy='dynamic')
    received_requests = db.relationship('FriendRequest', foreign_keys='FriendRequest.receiver_id', backref='receiver', lazy='dynamic')
    
    friendships_1 = db.relationship('Friendship', foreign_keys='Friendship.user1_id', backref='user1', lazy='dynamic')
    friendships_2 = db.relationship('Friendship', foreign_keys='Friendship.user2_id', backref='user2', lazy='dynamic')
    
    messages_sent = db.relationship('Message', foreign_keys='Message.sender_id', backref='sender_msg', lazy='dynamic')
    messages_received = db.relationship('Message', foreign_keys='Message.receiver_id', backref='receiver_msg', lazy='dynamic')
    
    blocked_list = db.relationship('Blacklist', foreign_keys='Blacklist.user_id', backref='user', lazy='dynamic')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class FriendRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Friendship(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user1_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    user2_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    msg_type = db.Column(db.String(10), default='text')
    voice_url = db.Column(db.String(255), default='')
    voice_duration = db.Column(db.Float, default=0.0)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    read = db.Column(db.Boolean, default=False)


class Blacklist(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    blocked_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/static/manifest.json')
def manifest():
    return send_file('static/manifest.json', mimetype='application/manifest+json')


@app.route('/static/sw.js')
def service_worker():
    return send_file('static/sw.js', mimetype='application/javascript')


ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'webm', 'mp3', 'ogg', 'wav', 'amr'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/api/apk/info')
def apk_info():
    apk_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'family-chat.apk')
    if not os.path.exists(apk_path):
        return jsonify({'available': False, 'message': '暂无安装包，请稍后重试'}), 200
    apk_size = os.path.getsize(apk_path)
    apk_mtime = datetime.fromtimestamp(os.path.getmtime(apk_path))
    return jsonify({
        'available': True,
        'version': 'v2.0.0',
        'size_mb': round(apk_size / (1024 * 1024), 1),
        'size_bytes': apk_size,
        'updated_at': apk_mtime.isoformat(),
        'download_url': '/api/apk/download',
        'install_tip': '下载完成后点击APK文件安装（如提示"未知来源"请允许安装）'
    }), 200


@app.route('/api/apk/download')
def download_apk():
    apk_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'family-chat.apk')
    if not os.path.exists(apk_path):
        return jsonify({'error': '安装包暂不可用'}), 404
    logger.info(f'APK download requested: {apk_path}')
    return send_file(apk_path, as_attachment=True, download_name='family-chat.apk', mimetype='application/vnd.android.package-archive')


@app.route('/api/avatar/upload/<int:user_id>', methods=['POST'])
def upload_avatar(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    
    if 'avatar' not in request.files:
        return jsonify({'error': '没有上传文件'}), 400
    
    file = request.files['avatar']
    if file.filename == '':
        return jsonify({'error': '未选择文件'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': '不支持的图片格式'}), 400
    
    ext = file.filename.rsplit('.', 1)[1].lower()
    filename = f'avatar_{user_id}_{int(datetime.utcnow().timestamp())}.{ext}'
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    avatar_url = f'/static/uploads/{filename}'
    user.avatar = avatar_url
    db.session.commit()
    
    return jsonify({'message': '头像上传成功', 'avatar_url': avatar_url}), 200


@app.route('/api/voice/upload', methods=['POST'])
def upload_voice():
    if 'audio' not in request.files:
        return jsonify({'error': '没有上传文件'}), 400
    sender_id = request.form.get('sender_id', type=int)
    if not sender_id:
        return jsonify({'error': '缺少发送者ID'}), 400
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': '未选择文件'}), 400
    ext = 'webm'
    filename = f'voice_{sender_id}_{int(datetime.utcnow().timestamp())}.{ext}'
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    voice_url = f'/static/uploads/{filename}'
    logger.info(f'Voice file saved: {filename}')
    return jsonify({'url': voice_url, 'duration': 0}), 200


@app.route('/api/avatar/<int:user_id>')
def get_avatar(user_id):
    user = User.query.get(user_id)
    if user and user.avatar:
        avatar_path = os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(user.avatar))
        if os.path.exists(avatar_path):
            return send_file(avatar_path, mimetype='image/jpeg')
    return '', 204


@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'error': '用户名和密码不能为空'}), 400
    
    if User.query.filter_by(username=username).first():
        return jsonify({'error': '用户名已存在'}), 400
    
    user = User(username=username)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    
    return jsonify({'message': '注册成功', 'user_id': user.id, 'username': user.username}), 201


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'error': '用户名和密码不能为空'}), 400
    
    user = User.query.filter_by(username=username).first()
    
    if not user or not user.check_password(password):
        return jsonify({'error': '用户名或密码错误'}), 401
    
    return jsonify({
        'message': '登录成功',
        'user_id': user.id,
        'username': user.username,
        'bio': user.bio,
        'avatar': user.avatar,
        'created_at': user.created_at.isoformat()
    }), 200


@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    
    return jsonify({
        'id': user.id,
        'username': user.username,
        'bio': user.bio,
        'avatar': user.avatar,
        'created_at': user.created_at.isoformat()
    }), 200


@app.route('/api/user/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    data = request.json
    user = User.query.get(user_id)
    
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    
    if data.get('username'):
        user.username = data['username']
    if data.get('bio') is not None:
        user.bio = data['bio']
    if data.get('avatar') is not None:
        user.avatar = data['avatar']
    if data.get('password'):
        user.set_password(data['password'])
    
    db.session.commit()
    return jsonify({'message': '更新成功', 'user': {
        'id': user.id,
        'username': user.username,
        'bio': user.bio,
        'avatar': user.avatar
    }}), 200


@app.route('/api/search', methods=['GET'])
def search_users():
    username = request.args.get('username')
    current_user_id = request.args.get('user_id', type=int)
    
    if not username:
        return jsonify([])
    
    users = User.query.filter(User.username.contains(username), User.id != current_user_id).all()
    
    result = []
    for u in users:
        is_friend = Friendship.query.filter(
            ((Friendship.user1_id == current_user_id) & (Friendship.user2_id == u.id)) |
            ((Friendship.user1_id == u.id) & (Friendship.user2_id == current_user_id))
        ).first()
        
        is_blocked = Blacklist.query.filter_by(user_id=current_user_id, blocked_user_id=u.id).first()
        
        result.append({
            'id': u.id,
            'username': u.username,
            'avatar': u.avatar,
            'is_friend': bool(is_friend),
            'is_blocked': bool(is_blocked)
        })
    
    return jsonify(result)


@app.route('/api/friend_request', methods=['POST'])
def send_friend_request():
    data = request.json
    sender_id = data.get('sender_id')
    receiver_id = data.get('receiver_id')
    
    if sender_id == receiver_id:
        return jsonify({'error': '不能添加自己为好友'}), 400
    
    existing_friendship = Friendship.query.filter(
        ((Friendship.user1_id == sender_id) & (Friendship.user2_id == receiver_id)) |
        ((Friendship.user1_id == receiver_id) & (Friendship.user2_id == sender_id))
    ).first()
    
    if existing_friendship:
        return jsonify({'error': '你们已经是好友了'}), 400
    
    existing_request = FriendRequest.query.filter(
        FriendRequest.sender_id == sender_id,
        FriendRequest.receiver_id == receiver_id,
        FriendRequest.status == 'pending'
    ).first()
    
    if existing_request:
        return jsonify({'error': '已经发送过好友请求了'}), 400
    
    friend_request = FriendRequest(sender_id=sender_id, receiver_id=receiver_id)
    db.session.add(friend_request)
    db.session.commit()
    
    return jsonify({'message': '好友请求已发送'}), 200


@app.route('/api/friend_requests/<int:user_id>', methods=['GET'])
def get_friend_requests(user_id):
    requests = FriendRequest.query.filter_by(receiver_id=user_id, status='pending').all()
    result = []
    for req in requests:
        sender = User.query.get(req.sender_id)
        if sender:
            result.append({
                'id': req.id,
                'sender_id': sender.id,
                'sender_username': sender.username,
                'sender_avatar': sender.avatar
            })
    return jsonify(result)


@app.route('/api/friend_request/action', methods=['POST'])
def handle_friend_request():
    data = request.json
    request_id = data.get('request_id')
    action = data.get('action')
    receiver_id = data.get('receiver_id')
    
    friend_request = FriendRequest.query.get(request_id)
    if not friend_request:
        return jsonify({'error': '请求不存在'}), 404
    
    if friend_request.receiver_id != receiver_id:
        return jsonify({'error': '无权限操作'}), 403
    
    if action == 'accept':
        friend_request.status = 'accepted'
        
        friendship = Friendship(user1_id=friend_request.sender_id, user2_id=receiver_id)
        db.session.add(friendship)
        db.session.commit()
        
        return jsonify({'message': '已同意好友请求'})
    elif action == 'reject':
        friend_request.status = 'rejected'
        db.session.commit()
        return jsonify({'message': '已拒绝好友请求'})
    else:
        return jsonify({'error': '无效的操作'}), 400


@app.route('/api/friends/<int:user_id>', methods=['GET'])
def get_friends(user_id):
    friendships = Friendship.query.filter(
        (Friendship.user1_id == user_id) | (Friendship.user2_id == user_id)
    ).all()
    
    friends = []
    for friendship in friendships:
        friend_id = friendship.user2_id if friendship.user1_id == user_id else friendship.user1_id
        friend = User.query.get(friend_id)
        if friend:
            last_message = Message.query.filter(
                ((Message.sender_id == user_id) & (Message.receiver_id == friend_id)) |
                ((Message.sender_id == friend_id) & (Message.receiver_id == user_id))
            ).order_by(Message.timestamp.desc()).first()
            
            friends.append({
                'id': friend.id,
                'username': friend.username,
                'avatar': friend.avatar,
                'last_message': last_message.content if last_message else None,
                'last_message_time': last_message.timestamp.isoformat() if last_message else None
            })
    
    return jsonify(friends)


@app.route('/api/friend/delete', methods=['POST'])
def delete_friend():
    data = request.json
    user_id = data.get('user_id')
    friend_id = data.get('friend_id')
    
    friendship = Friendship.query.filter(
        ((Friendship.user1_id == user_id) & (Friendship.user2_id == friend_id)) |
        ((Friendship.user1_id == friend_id) & (Friendship.user2_id == user_id))
    ).first()
    
    if not friendship:
        return jsonify({'error': '不是好友关系'}), 400
    
    db.session.delete(friendship)
    db.session.commit()
    
    return jsonify({'message': '已删除好友'}), 200


@app.route('/api/blacklist/<int:user_id>', methods=['GET'])
def get_blacklist(user_id):
    blacklist = Blacklist.query.filter_by(user_id=user_id).all()
    result = []
    for item in blacklist:
        blocked_user = User.query.get(item.blocked_user_id)
        if blocked_user:
            result.append({
                'id': item.id,
                'blocked_user_id': blocked_user.id,
                'blocked_user_name': blocked_user.username,
                'blocked_user_avatar': blocked_user.avatar,
                'created_at': item.created_at.isoformat()
            })
    return jsonify(result)


@app.route('/api/blacklist/add', methods=['POST'])
def add_to_blacklist():
    data = request.json
    user_id = data.get('user_id')
    blocked_user_id = data.get('blocked_user_id')
    
    if user_id == blocked_user_id:
        return jsonify({'error': '不能拉黑自己'}), 400
    
    existing = Blacklist.query.filter_by(user_id=user_id, blocked_user_id=blocked_user_id).first()
    if existing:
        return jsonify({'error': '已经拉黑了'}), 400
    
    blacklist_item = Blacklist(user_id=user_id, blocked_user_id=blocked_user_id)
    db.session.add(blacklist_item)
    db.session.commit()
    
    return jsonify({'message': '已加入黑名单'}), 200


@app.route('/api/blacklist/remove', methods=['POST'])
def remove_from_blacklist():
    data = request.json
    user_id = data.get('user_id')
    blocked_user_id = data.get('blocked_user_id')
    
    blacklist_item = Blacklist.query.filter_by(user_id=user_id, blocked_user_id=blocked_user_id).first()
    if not blacklist_item:
        return jsonify({'error': '未在黑名单中'}), 400
    
    db.session.delete(blacklist_item)
    db.session.commit()
    
    return jsonify({'message': '已从黑名单移除'}), 200


@app.route('/api/messages/<int:user_id>/<int:friend_id>', methods=['GET'])
def get_messages(user_id, friend_id):
    messages = Message.query.filter(
        ((Message.sender_id == user_id) & (Message.receiver_id == friend_id)) |
        ((Message.sender_id == friend_id) & (Message.receiver_id == user_id))
    ).order_by(Message.timestamp.asc()).all()
    
    result = []
    for msg in messages:
        sender = User.query.get(msg.sender_id)
        item = {
            'id': msg.id,
            'sender_id': msg.sender_id,
            'receiver_id': msg.receiver_id,
            'sender_name': sender.username if sender else 'Unknown',
            'content': msg.content,
            'msg_type': msg.msg_type or 'text',
            'timestamp': msg.timestamp.isoformat(),
            'is_mine': msg.sender_id == user_id
        }
        if msg.voice_url:
            item['voice_url'] = msg.voice_url
            item['voice_duration'] = msg.voice_duration or 0
        result.append(item)
    
    return jsonify(result)


@app.route('/api/recent_messages/<int:user_id>', methods=['GET'])
def get_recent_messages(user_id):
    since = request.args.get('since', type=float, default=0)
    if since > 0:
        since_date = datetime.fromtimestamp(since / 1000)
        messages = Message.query.filter(
            Message.receiver_id == user_id,
            Message.timestamp > since_date
        ).order_by(Message.timestamp.asc()).all()
    else:
        messages = []
    
    result = []
    for msg in messages:
        sender = User.query.get(msg.sender_id)
        item = {
            'id': msg.id,
            'sender_id': msg.sender_id,
            'sender_name': sender.username if sender else 'Unknown',
            'content': msg.content,
            'msg_type': msg.msg_type or 'text',
            'timestamp': msg.timestamp.timestamp() * 1000
        }
        if msg.voice_url:
            item['voice_url'] = msg.voice_url
            item['voice_duration'] = msg.voice_duration or 0
        result.append(item)
    return jsonify(result)


@socketio.on('connect')
def handle_connect():
    logger.info('Client connected')


@socketio.on('disconnect')
def handle_disconnect():
    logger.info('Client disconnected')


@socketio.on('join')
def on_join(data):
    user_id = data.get('user_id')
    if user_id:
        join_room(str(user_id))
        logger.info(f'User {user_id} joined room {user_id}')


@socketio.on('leave')
def on_leave(data):
    user_id = data.get('user_id')
    if user_id:
        leave_room(str(user_id))


@socketio.on('send_message')
def handle_send_message(data):
    try:
        sender_id = data.get('sender_id')
        receiver_id = data.get('receiver_id')
        content = data.get('content')
        msg_type = data.get('msg_type', 'text')
        voice_url = data.get('voice_url', '')
        voice_duration = data.get('voice_duration', 0)
        
        if not sender_id or not receiver_id:
            return
        
        if msg_type == 'text' and not content:
            return
        
        is_blocked = Blacklist.query.filter_by(user_id=receiver_id, blocked_user_id=sender_id).first()
        if is_blocked:
            emit('message_failed', {'error': '对方已拉黑你'}, room=str(sender_id))
            return
        
        message = Message(
            sender_id=sender_id,
            receiver_id=receiver_id,
            content=content,
            msg_type=msg_type
        )
        if voice_url:
            message.voice_url = voice_url
            message.voice_duration = float(voice_duration) if voice_duration else 0.0
        db.session.add(message)
        db.session.commit()
        
        sender = User.query.get(sender_id)
        
        message_data = {
            'id': message.id,
            'sender_id': sender_id,
            'receiver_id': receiver_id,
            'sender_name': sender.username if sender else 'Unknown',
            'content': content,
            'msg_type': msg_type,
            'voice_url': voice_url,
            'voice_duration': voice_duration,
            'timestamp': message.timestamp.isoformat(),
            'is_mine': False
        }
        
        emit('receive_message', message_data, room=str(receiver_id))
        
        message_data['is_mine'] = True
        emit('receive_message', message_data, room=str(sender_id))
        
    except Exception as e:
        logger.error(f'Sending message failed: {e}')
        db.session.rollback()


@socketio.on('webrtc_offer')
def handle_webrtc_offer(data):
    target = data.get('to')
    if target and data.get('sdp'):
        emit('webrtc_offer', {
            'from': data.get('from'),
            'sdp': data.get('sdp'),
            'call_type': data.get('call_type', 'video')
        }, room=str(target))

@socketio.on('webrtc_answer')
def handle_webrtc_answer(data):
    target = data.get('to')
    if target and data.get('sdp'):
        emit('webrtc_answer', {
            'from': data.get('from'),
            'sdp': data.get('sdp')
        }, room=str(target))

@socketio.on('webrtc_ice_candidate')
def handle_webrtc_ice(data):
    target = data.get('to')
    if target and data.get('candidate'):
        emit('webrtc_ice_candidate', {
            'from': data.get('from'),
            'candidate': data.get('candidate')
        }, room=str(target))

@socketio.on('webrtc_reject')
def handle_webrtc_reject(data):
    target = data.get('to')
    if target:
        emit('webrtc_reject', {'from': data.get('from')}, room=str(target))

@socketio.on('webrtc_end_call')
def handle_webrtc_end_call(data):
    target = data.get('to')
    if target:
        emit('webrtc_end_call', {'from': data.get('from')}, room=str(target))

@socketio.on('webrtc_busy')
def handle_webrtc_busy(data):
    target = data.get('to')
    if target:
        emit('webrtc_busy', {'from': data.get('from')}, room=str(target))


# ===== 数据导出接口（用于迁移到 Render） =====
EXPORT_TOKEN = os.environ.get('EXPORT_TOKEN', 'export-secret-123')

def verify_export_token():
    """验证导出接口的访问令牌"""
    from flask import request as req
    return req.args.get('token') == EXPORT_TOKEN


@app.route('/api/export/users')
def export_users():
    if not verify_export_token():
        return jsonify({'error': '无权限'}), 403
    users = User.query.all()
    result = []
    for u in users:
        result.append({
            'id': u.id, 'username': u.username,
            'password_hash': u.password_hash,
            'avatar': u.avatar, 'bio': u.bio,
            'created_at': u.created_at.isoformat() if u.created_at else None
        })
    return jsonify(result)


@app.route('/api/export/friendships')
def export_friendships():
    if not verify_export_token():
        return jsonify({'error': '无权限'}), 403
    data = Friendship.query.all()
    result = [{'id': f.id, 'user1_id': f.user1_id, 'user2_id': f.user2_id,
               'created_at': f.created_at.isoformat() if f.created_at else None} for f in data]
    return jsonify(result)


@app.route('/api/export/friend_requests')
def export_friend_requests():
    if not verify_export_token():
        return jsonify({'error': '无权限'}), 403
    data = FriendRequest.query.all()
    result = [{'id': r.id, 'sender_id': r.sender_id, 'receiver_id': r.receiver_id,
               'status': r.status,
               'created_at': r.created_at.isoformat() if r.created_at else None} for r in data]
    return jsonify(result)


@app.route('/api/export/blacklist')
def export_blacklist():
    if not verify_export_token():
        return jsonify({'error': '无权限'}), 403
    data = Blacklist.query.all()
    result = [{'id': b.id, 'user_id': b.user_id, 'blocked_user_id': b.blocked_user_id,
               'created_at': b.created_at.isoformat() if b.created_at else None} for b in data]
    return jsonify(result)


@app.route('/api/export/messages')
def export_messages():
    if not verify_export_token():
        return jsonify({'error': '无权限'}), 403
    msgs = Message.query.order_by(Message.timestamp.asc()).all()
    result = []
    for m in msgs:
        result.append({
            'id': m.id, 'sender_id': m.sender_id, 'receiver_id': m.receiver_id,
            'content': m.content, 'msg_type': m.msg_type or 'text',
            'voice_url': m.voice_url or '', 'voice_duration': m.voice_duration or 0,
            'timestamp': m.timestamp.isoformat() if m.timestamp else None,
            'read': m.read
        })
    return jsonify(result)


def init_database():
    """在所有环境中初始化数据库，支持 Gunicorn（Render）和直接运行"""
    with app.app_context():
        db.create_all()
        # 兼容旧 SQLite 数据库：检查并添加缺失列
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(db.engine)
            dialect = inspector.dialect.name
            cols = [col['name'] for col in inspector.get_columns('message')]
            if 'voice_url' not in cols:
                if dialect == 'sqlite':
                    db.session.execute(text('ALTER TABLE message ADD COLUMN voice_url VARCHAR(255) DEFAULT ""'))
                else:
                    db.session.execute(text('ALTER TABLE message ADD COLUMN voice_url VARCHAR(255) DEFAULT \'\''))
                db.session.commit()
                logger.info('Added voice_url column')
            if 'voice_duration' not in cols:
                if dialect == 'sqlite':
                    db.session.execute(text('ALTER TABLE message ADD COLUMN voice_duration FLOAT DEFAULT 0.0'))
                else:
                    db.session.execute(text('ALTER TABLE message ADD COLUMN voice_duration FLOAT DEFAULT 0'))
                db.session.commit()
                logger.info('Added voice_duration column')
        except Exception as e:
            logger.warning(f'DB column check skipped: {e}')


# 启动时初始化数据库（支持 Gunicorn 和直接运行两种方式）
init_database()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    
    logger.info('=' * 50)
    logger.info('Family chat app starting...')
    logger.info(f'Access URL: http://localhost:{port}')
    logger.info('=' * 50)
    
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
