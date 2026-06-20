from flask import Flask, render_template, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta, timezone
import os
import logging
import json
import base64
import io
import time
import re
import subprocess
import glob
import uuid

app = Flask(__name__)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'family-chat-secret-key-2024')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///family_chat.db').replace('postgres://', 'postgresql://')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True, 'pool_recycle': 300}
app.config['UPLOAD_FOLDER'] = os.environ.get('UPLOAD_FOLDER', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads'))
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20MB (支持语音文件)

# ---------------- 日志分级配置 ----------------
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] [%(name)s] %(message)s'
)
logger = logging.getLogger(__name__)
# 降低 werkzeug 和 socketio 的日志噪音
logging.getLogger('werkzeug').setLevel(logging.WARNING)
logging.getLogger('socketio').setLevel(logging.WARNING)
logging.getLogger('engineio').setLevel(logging.WARNING)

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
db = SQLAlchemy(app)
migrate = Migrate(app, db)


# ---------------- 请求追踪中间件 ----------------
@app.before_request
def attach_request_id():
    request._request_id = request.headers.get('X-Request-ID', uuid.uuid4().hex[:12])
    request._start_time = time.time()


@app.after_request
def log_request(response):
    elapsed = time.time() - getattr(request, '_start_time', time.time())
    req_id = getattr(request, '_request_id', '-')
    level = logging.WARNING if response.status_code >= 400 else logging.DEBUG
    logger.log(level, '[%s] %s %s -> %s (%.0fms)',
               req_id, request.method, request.path, response.status_code, elapsed * 1000)
    return response


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    avatar = db.Column(db.Text, default='')
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
    recalled = db.Column(db.Boolean, default=False)


class Blacklist(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    blocked_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# ===== 新增模型：群组 =====
class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, default='')
    avatar = db.Column(db.Text, default='')
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    announcement = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class GroupMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    role = db.Column(db.String(20), default='member')
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint('group_id', 'user_id'),)


class GroupMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    msg_type = db.Column(db.String(10), default='text')
    voice_url = db.Column(db.String(255), default='')
    voice_duration = db.Column(db.Float, default=0.0)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    recalled = db.Column(db.Boolean, default=False)
    reply_to = db.Column(db.Integer, nullable=True)
    mentions = db.Column(db.Text, default='')


class GroupAnnouncement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# ===== 新增模型：共享购物清单 =====
class TodoList(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class TodoItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    todo_list_id = db.Column(db.Integer, db.ForeignKey('todo_list.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.String(500), nullable=False)
    done = db.Column(db.Boolean, default=False)
    done_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# ===== 新增模型：访问日志（反攻击 + 统计）=====
class VisitLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ip = db.Column(db.String(45), nullable=False)
    user_agent = db.Column(db.Text, default='')
    path = db.Column(db.String(500), default='')
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)


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
    
    ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
    if ext not in ('png', 'jpg', 'jpeg', 'gif', 'webp'):
        return jsonify({'error': '不支持的图片格式'}), 400
    
    # 读取文件并转为 base64，直接存数据库（Railway 文件系统是临时的）
    file_bytes = file.read()
    b64 = base64.b64encode(file_bytes).decode('utf-8')
    mime_type = f'image/{ext}' if ext != 'jpg' else 'image/jpeg'
    data_url = f'data:{mime_type};base64,{b64}'
    
    user.avatar = data_url
    db.session.commit()
    
    return jsonify({'message': '头像上传成功', 'avatar_url': data_url}), 200


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


@app.route('/api/upload_image', methods=['POST'])
def upload_image():
    """上传图片，返回可访问的 URL"""
    if 'image' not in request.files:
        return jsonify({'error': '没有上传文件'}), 400
    sender_id = request.form.get('sender_id', type=int)
    if not sender_id:
        return jsonify({'error': '缺少发送者ID'}), 400
    
    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': '未选择文件'}), 400
    
    ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
    if ext not in ('png', 'jpg', 'jpeg', 'gif', 'webp'):
        return jsonify({'error': '不支持的图片格式'}), 400
    
    filename = f'img_{sender_id}_{int(datetime.utcnow().timestamp())}.{ext}'
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    image_url = f'/static/uploads/{filename}'
    logger.info(f'Image saved: {filename}')
    return jsonify({'url': image_url, 'message': '上传成功'}), 200


@app.route('/api/avatar/<int:user_id>')
def get_avatar(user_id):
    user = User.query.get(user_id)
    if user and user.avatar:
        return jsonify({'avatar': user.avatar}), 200
    return jsonify({'avatar': None}), 200


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
        
        existing_friendship = Friendship.query.filter(
            ((Friendship.user1_id == friend_request.sender_id) & (Friendship.user2_id == receiver_id)) |
            ((Friendship.user1_id == receiver_id) & (Friendship.user2_id == friend_request.sender_id))
        ).first()
        if existing_friendship:
            return jsonify({'error': '你们已经是好友了'}), 400
        
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
            'is_mine': msg.sender_id == user_id,
            'recalled': msg.recalled or False
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


# ===== 新增：群组 API =====

@app.route('/api/groups/create', methods=['POST'])
def create_group():
    data = request.json
    name = data.get('name')
    description = data.get('description', '')
    created_by = data.get('created_by')

    if not name or not created_by:
        return jsonify({'error': '群名称和创建者不能为空'}), 400

    user = User.query.get(created_by)
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    group = Group(name=name, description=description, created_by=created_by)
    db.session.add(group)
    db.session.flush()

    owner = GroupMember(group_id=group.id, user_id=created_by, role='owner')
    db.session.add(owner)
    db.session.commit()

    return jsonify({'message': '群组创建成功', 'group_id': group.id, 'group_name': group.name}), 201


@app.route('/api/groups/<int:group_id>/add_member', methods=['POST'])
def add_group_member(group_id):
    data = request.json
    user_id = data.get('user_id')
    role = data.get('role', 'member')

    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    existing = GroupMember.query.filter_by(group_id=group_id, user_id=user_id).first()
    if existing:
        return jsonify({'error': '该用户已是群成员'}), 400

    member = GroupMember(group_id=group_id, user_id=user_id, role=role)
    db.session.add(member)
    db.session.commit()

    return jsonify({'message': '添加成员成功', 'user_id': user_id, 'role': role}), 200


@app.route('/api/groups/<int:group_id>/remove_member', methods=['POST'])
def remove_group_member(group_id):
    data = request.json
    user_id = data.get('user_id')
    admin_id = data.get('admin_id')

    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    admin_member = GroupMember.query.filter_by(group_id=group_id, user_id=admin_id).first()
    if not admin_member or admin_member.role not in ('owner', 'admin'):
        return jsonify({'error': '无权限操作'}), 403

    member = GroupMember.query.filter_by(group_id=group_id, user_id=user_id).first()
    if not member:
        return jsonify({'error': '该用户不是群成员'}), 400

    if member.role == 'owner':
        return jsonify({'error': '不能移除群主'}), 400

    db.session.delete(member)
    db.session.commit()

    return jsonify({'message': '成员已移除'}), 200


@app.route('/api/groups/<int:group_id>/set_role', methods=['POST'])
def set_group_role(group_id):
    data = request.json
    target_user_id = data.get('user_id')
    new_role = data.get('role')
    operator_id = data.get('operator_id')

    if new_role not in ('owner', 'admin', 'member'):
        return jsonify({'error': '无效的角色'}), 400

    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    operator = GroupMember.query.filter_by(group_id=group_id, user_id=operator_id).first()
    if not operator or operator.role not in ('owner', 'admin'):
        return jsonify({'error': '无权限操作'}), 403

    target = GroupMember.query.filter_by(group_id=group_id, user_id=target_user_id).first()
    if not target:
        return jsonify({'error': '该用户不是群成员'}), 400

    # 只有群主可以设置 owner 角色
    if new_role == 'owner' and operator.role != 'owner':
        return jsonify({'error': '只有群主可以转让群主身份'}), 403
    if operator.role != 'owner' and target.role == 'owner':
        return jsonify({'error': '不能修改群主的角色'}), 403

    target.role = new_role
    db.session.commit()

    return jsonify({'message': '角色设置成功', 'user_id': target_user_id, 'role': new_role}), 200


@app.route('/api/groups/<int:user_id>', methods=['GET'])
def list_user_groups(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    memberships = GroupMember.query.filter_by(user_id=user_id).all()
    result = []
    for membership in memberships:
        group = Group.query.get(membership.group_id)
        if group:
            member_count = GroupMember.query.filter_by(group_id=group.id).count()
            result.append({
                'id': group.id,
                'name': group.name,
                'description': group.description,
                'avatar': group.avatar,
                'announcement': group.announcement,
                'role': membership.role,
                'member_count': member_count,
                'created_at': group.created_at.isoformat()
            })

    return jsonify(result), 200


@app.route('/api/groups/<int:group_id>/members', methods=['GET'])
def list_group_members(group_id):
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    memberships = GroupMember.query.filter_by(group_id=group_id).all()
    result = []
    for membership in memberships:
        user = User.query.get(membership.user_id)
        if user:
            result.append({
                'id': membership.id,
                'user_id': user.id,
                'username': user.username,
                'avatar': user.avatar,
                'role': membership.role,
                'joined_at': membership.joined_at.isoformat()
            })

    return jsonify(result), 200


@app.route('/api/groups/<int:group_id>/announcement', methods=['POST'])
def set_group_announcement(group_id):
    data = request.json
    content = data.get('content')
    user_id = data.get('user_id')

    if content is None:
        return jsonify({'error': '公告内容不能为空'}), 400

    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    member = GroupMember.query.filter_by(group_id=group_id, user_id=user_id).first()
    if not member or member.role not in ('owner', 'admin'):
        return jsonify({'error': '无权限操作'}), 403

    announcement = GroupAnnouncement(group_id=group_id, created_by=user_id, content=content)
    db.session.add(announcement)
    group.announcement = content
    db.session.commit()

    return jsonify({'message': '公告设置成功'}), 200


@app.route('/api/groups/<int:group_id>/leave', methods=['POST'])
def leave_group(group_id):
    data = request.json
    user_id = data.get('user_id')

    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    member = GroupMember.query.filter_by(group_id=group_id, user_id=user_id).first()
    if not member:
        return jsonify({'error': '你不是群成员'}), 400

    if member.role == 'owner':
        return jsonify({'error': '群主不能退出群组，请先转让群主身份'}), 400

    db.session.delete(member)
    db.session.commit()

    return jsonify({'message': '已退出群组'}), 200


# ===== 新增：群组消息历史 API =====

@app.route('/api/group_messages/<int:group_id>', methods=['GET'])
def get_group_messages(group_id):
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    messages = GroupMessage.query.filter_by(group_id=group_id).order_by(GroupMessage.timestamp.asc()).all()
    result = []
    for msg in messages:
        sender = User.query.get(msg.sender_id)
        item = {
            'id': msg.id,
            'group_id': msg.group_id,
            'sender_id': msg.sender_id,
            'sender_name': sender.username if sender else 'Unknown',
            'content': msg.content,
            'msg_type': msg.msg_type or 'text',
            'timestamp': msg.timestamp.isoformat(),
            'recalled': msg.recalled or False,
            'reply_to': msg.reply_to,
            'mentions': json.loads(msg.mentions) if msg.mentions else []
        }
        if msg.voice_url:
            item['voice_url'] = msg.voice_url
            item['voice_duration'] = msg.voice_duration or 0
        result.append(item)

    return jsonify(result), 200


# ===== 新增：购物清单 API =====

@app.route('/api/todo/create', methods=['POST'])
def create_todo_list():
    data = request.json
    group_id = data.get('group_id')
    title = data.get('title')
    user_id = data.get('user_id')

    if not group_id or not title or not user_id:
        return jsonify({'error': '参数不完整'}), 400

    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    todo_list = TodoList(group_id=group_id, title=title, created_by=user_id)
    db.session.add(todo_list)
    db.session.commit()

    return jsonify({'message': '清单创建成功', 'todo_list_id': todo_list.id, 'title': title}), 201


@app.route('/api/todo/<int:group_id>', methods=['GET'])
def get_todo_lists(group_id):
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '群组不存在'}), 404

    todo_lists = TodoList.query.filter_by(group_id=group_id).order_by(TodoList.created_at.desc()).all()
    result = []
    for tl in todo_lists:
        items = TodoItem.query.filter_by(todo_list_id=tl.id).order_by(TodoItem.created_at.asc()).all()
        item_list = []
        for item in items:
            user = User.query.get(item.user_id)
            item_list.append({
                'id': item.id,
                'content': item.content,
                'done': item.done,
                'done_at': item.done_at.isoformat() if item.done_at else None,
                'user_id': item.user_id,
                'username': user.username if user else 'Unknown',
                'created_at': item.created_at.isoformat()
            })
        creator = User.query.get(tl.created_by)
        result.append({
            'id': tl.id,
            'title': tl.title,
            'created_by': tl.created_by,
            'creator_name': creator.username if creator else 'Unknown',
            'created_at': tl.created_at.isoformat(),
            'items': item_list
        })

    return jsonify(result), 200


@app.route('/api/todo/item/add', methods=['POST'])
def add_todo_item():
    data = request.json
    todo_list_id = data.get('todo_list_id')
    content = data.get('content')
    user_id = data.get('user_id')

    if not todo_list_id or not content or not user_id:
        return jsonify({'error': '参数不完整'}), 400

    todo_list = TodoList.query.get(todo_list_id)
    if not todo_list:
        return jsonify({'error': '清单不存在'}), 404

    item = TodoItem(todo_list_id=todo_list_id, content=content, user_id=user_id)
    db.session.add(item)
    db.session.commit()

    return jsonify({'message': '添加成功', 'item_id': item.id}), 201


@app.route('/api/todo/item/toggle', methods=['POST'])
def toggle_todo_item():
    data = request.json
    item_id = data.get('item_id')
    user_id = data.get('user_id')

    if not item_id:
        return jsonify({'error': '参数不完整'}), 400

    item = TodoItem.query.get(item_id)
    if not item:
        return jsonify({'error': '待办项不存在'}), 404

    item.done = not item.done
    item.done_at = datetime.utcnow() if item.done else None
    db.session.commit()

    return jsonify({'message': '状态已切换', 'done': item.done}), 200


@app.route('/api/todo/item/delete', methods=['POST'])
def delete_todo_item():
    data = request.json
    item_id = data.get('item_id')

    if not item_id:
        return jsonify({'error': '参数不完整'}), 400

    item = TodoItem.query.get(item_id)
    if not item:
        return jsonify({'error': '待办项不存在'}), 404

    db.session.delete(item)
    db.session.commit()

    return jsonify({'message': '删除成功'}), 200


# ===== 新增：导出用户聊天记录 =====

@app.route('/api/export/chat/<int:user_id>')
def export_user_chat(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    # 私聊消息
    private_messages = Message.query.filter(
        (Message.sender_id == user_id) | (Message.receiver_id == user_id)
    ).order_by(Message.timestamp.asc()).all()

    # 群聊消息
    memberships = GroupMember.query.filter_by(user_id=user_id).all()
    group_ids = [m.group_id for m in memberships]
    group_messages = GroupMessage.query.filter(
        GroupMessage.group_id.in_(group_ids),
        GroupMessage.sender_id == user_id
    ).order_by(GroupMessage.timestamp.asc()).all() if group_ids else []

    data = {
        'user': {'id': user.id, 'username': user.username, 'bio': user.bio},
        'export_time': datetime.utcnow().isoformat(),
        'private_messages': [],
        'group_messages': []
    }

    for msg in private_messages:
        sender = User.query.get(msg.sender_id)
        receiver = User.query.get(msg.receiver_id)
        data['private_messages'].append({
            'id': msg.id,
            'sender_id': msg.sender_id,
            'sender_name': sender.username if sender else 'Unknown',
            'receiver_id': msg.receiver_id,
            'receiver_name': receiver.username if receiver else 'Unknown',
            'content': msg.content,
            'msg_type': msg.msg_type or 'text',
            'timestamp': msg.timestamp.isoformat(),
            'recalled': msg.recalled or False
        })

    for msg in group_messages:
        group = Group.query.get(msg.group_id)
        sender = User.query.get(msg.sender_id)
        data['group_messages'].append({
            'id': msg.id,
            'group_id': msg.group_id,
            'group_name': group.name if group else 'Unknown',
            'sender_id': msg.sender_id,
            'sender_name': sender.username if sender else 'Unknown',
            'content': msg.content,
            'msg_type': msg.msg_type or 'text',
            'timestamp': msg.timestamp.isoformat(),
            'recalled': msg.recalled or False
        })

    buf = io.BytesIO()
    buf.write(json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))
    buf.seek(0)

    return send_file(
        buf,
        as_attachment=True,
        download_name=f'chat_export_{user.username}_{datetime.utcnow().strftime("%Y%m%d")}.json',
        mimetype='application/json'
    )


# ===== 新增：访问统计 API =====

attack_count = 0

@app.route('/api/stats')
def get_stats():
    total_visits = VisitLog.query.count()
    return jsonify({
        'total_visits': total_visits,
        'attack_count': attack_count
    }), 200


socketio.on('connect')
def handle_connect(auth=None):
    client_ip = request.remote_addr or 'unknown'
    user_agent = request.headers.get('User-Agent', 'unknown')[:80]
    logger.info('[SOCKET] Client connected — IP=%s UA=%s', client_ip, user_agent)


socketio.on('disconnect')
def handle_disconnect():
    client_ip = getattr(request, 'remote_addr', 'unknown')
    # 在 disconnect 事件中，request 可能已被销毁
    reason = getattr(request, '_disconnect_reason', 'unknown')
    logger.warning('[SOCKET] Client disconnected — IP=%s reason=%s', client_ip, reason)


# 捕获 SocketIO 连接错误
@socketio.on_error()
def handle_socket_error(e):
    client_ip = getattr(request, 'remote_addr', 'unknown')
    logger.error('[SOCKET] Error from %s: %s', client_ip, str(e))


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
            'is_mine': False,
            'recalled': False
        }
        
        emit('receive_message', message_data, room=str(receiver_id))
        
        message_data['is_mine'] = True
        emit('receive_message', message_data, room=str(sender_id))
        
    except Exception as e:
        logger.error(f'Sending message failed: {e}')
        db.session.rollback()


@socketio.on('recall_message')
def handle_recall_message(data):
    try:
        message_id = data.get('message_id')
        user_id = data.get('user_id')
        if not message_id or not user_id:
            return
        
        message = Message.query.get(int(message_id))
        if not message:
            return
        
        # 只有发送者才能撤回
        if int(message.sender_id) != int(user_id):
            logger.warning(f'User {user_id} attempted to recall message {message_id} not owned')
            return
        
        # 只能撤回2分钟内发送的消息
        if datetime.utcnow() - message.timestamp > timedelta(minutes=2):
            logger.warning(f'Message {message_id} too old to recall')
            return
        
        message.recalled = True
        message.content = '[撤回的消息]'
        db.session.commit()
        
        recall_data = {
            'message_id': message.id,
            'sender_id': message.sender_id,
            'receiver_id': message.receiver_id,
            'timestamp': datetime.utcnow().isoformat()
        }
        emit('message_recalled', recall_data, room=str(message.receiver_id))
        emit('message_recalled', recall_data, room=str(message.sender_id))
        logger.info(f'Message {message.id} recalled by user {user_id}')
        
    except Exception as e:
        logger.error(f'Recall message failed: {e}')
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


# ===== 新增：群组消息 SocketIO =====

@socketio.on('join_group')
def on_join_group(data):
    group_id = data.get('group_id')
    user_id = data.get('user_id')
    if group_id and user_id:
        room = f'group_{group_id}'
        join_room(room)
        logger.info(f'User {user_id} joined group room {room}')


@socketio.on('leave_group')
def on_leave_group(data):
    group_id = data.get('group_id')
    user_id = data.get('user_id')
    if group_id and user_id:
        room = f'group_{group_id}'
        leave_room(room)


@socketio.on('send_group_message')
def handle_send_group_message(data):
    try:
        group_id = data.get('group_id')
        sender_id = data.get('sender_id')
        content = data.get('content')
        msg_type = data.get('msg_type', 'text')
        voice_url = data.get('voice_url', '')
        voice_duration = data.get('voice_duration', 0)
        reply_to = data.get('reply_to')

        if not group_id or not sender_id:
            return

        if msg_type == 'text' and not content:
            return

        # 检查发送者是否为群成员
        member = GroupMember.query.filter_by(group_id=group_id, user_id=sender_id).first()
        if not member:
            emit('message_failed', {'error': '你不是群成员'}, room=str(sender_id))
            return

        # 解析 @mentions
        mention_ids = []
        if content:
            mention_ids = re.findall(r'@(\d+)', content)

        message = GroupMessage(
            group_id=group_id,
            sender_id=sender_id,
            content=content,
            msg_type=msg_type,
            reply_to=reply_to,
            mentions=json.dumps(mention_ids)
        )
        if voice_url:
            message.voice_url = voice_url
            message.voice_duration = float(voice_duration) if voice_duration else 0.0
        db.session.add(message)
        db.session.commit()

        sender = User.query.get(sender_id)

        message_data = {
            'id': message.id,
            'group_id': group_id,
            'sender_id': sender_id,
            'sender_name': sender.username if sender else 'Unknown',
            'content': content,
            'msg_type': msg_type,
            'voice_url': voice_url,
            'voice_duration': voice_duration,
            'mentions': mention_ids,
            'reply_to': reply_to,
            'timestamp': message.timestamp.isoformat(),
            'recalled': False
        }

        room = f'group_{group_id}'
        emit('receive_group_message', message_data, room=room)

    except Exception as e:
        logger.error(f'Sending group message failed: {e}')
        db.session.rollback()


@socketio.on('recall_group_message')
def handle_recall_group_message(data):
    try:
        message_id = data.get('message_id')
        user_id = data.get('user_id')
        group_id = data.get('group_id')

        if not message_id or not user_id or not group_id:
            return

        message = GroupMessage.query.get(int(message_id))
        if not message:
            return

        # 只有发送者才能撤回
        if int(message.sender_id) != int(user_id):
            logger.warning(f'User {user_id} attempted to recall group message {message_id} not owned')
            return

        # 只能撤回2分钟内发送的消息
        if datetime.utcnow() - message.timestamp > timedelta(minutes=2):
            logger.warning(f'Group message {message_id} too old to recall')
            return

        message.recalled = True
        message.content = '[撤回的消息]'
        db.session.commit()

        recall_data = {
            'message_id': message.id,
            'group_id': group_id,
            'sender_id': message.sender_id,
            'timestamp': datetime.utcnow().isoformat()
        }
        room = f'group_{group_id}'
        emit('group_message_recalled', recall_data, room=room)
        logger.info(f'Group message {message.id} recalled by user {user_id}')

    except Exception as e:
        logger.error(f'Recall group message failed: {e}')
        db.session.rollback()


# ===== 新增：输入状态指示器 =====

@socketio.on('typing')
def handle_typing(data):
    room = data.get('room')
    user_id = data.get('user_id')
    username = data.get('username')
    if room and user_id:
        emit('user_typing', {
            'user_id': user_id,
            'username': username
        }, room=room, include_self=False)


@socketio.on('stop_typing')
def handle_stop_typing(data):
    room = data.get('room')
    user_id = data.get('user_id')
    if room and user_id:
        emit('user_stop_typing', {
            'user_id': user_id
        }, room=room, include_self=False)


# ===== 原有的数据导出接口（用于迁移到 Render） =====
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


# ===== 新增：反攻击中间件 =====

request_counts = {}

@app.before_request
def log_and_rate_limit():
    ip = request.remote_addr or 'unknown'
    now = time.time()

    # 清理过期记录
    if ip not in request_counts:
        request_counts[ip] = []
    request_counts[ip] = [t for t in request_counts[ip] if now - t < 60]

    # 频率限制：同一 IP 每分钟超过 100 次请求则返回 429
    if len(request_counts[ip]) >= 100:
        global attack_count
        attack_count += 1
        logger.warning(f'Rate limit exceeded for IP: {ip}')
        return jsonify({'error': '请求过于频繁，请稍后再试', 'retry_after': 60}), 429

    request_counts[ip].append(now)

    # 记录访问日志
    try:
        visit = VisitLog(
            ip=ip,
            user_agent=request.user_agent.string if request.user_agent else '',
            path=request.path,
            timestamp=datetime.utcnow()
        )
        db.session.add(visit)
        db.session.commit()
    except Exception as e:
        logger.error(f'Failed to log visit: {e}')
        db.session.rollback()


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


# ===== 新增：CLI 备份命令 =====

@app.cli.command('backup')
def backup_command():
    """备份 SQLite 数据库到 /data/backup/ 目录，保留最近 7 天的备份"""
    backup_dir = '/data/backup'
    os.makedirs(backup_dir, exist_ok=True)

    # 获取数据库文件路径
    db_uri = app.config['SQLALCHEMY_DATABASE_URI']
    db_path = db_uri.replace('sqlite:///', '', 1)
    if not os.path.isabs(db_path):
        db_path = os.path.join(app.root_path, db_path)

    if not os.path.exists(db_path):
        print(f'Error: Database file not found at {db_path}')
        return

    today = datetime.now().strftime('%Y%m%d')
    backup_path = os.path.join(backup_dir, f'family_chat_{today}.db')
    temp_path = backup_path + '.tmp'

    try:
        # 使用 sqlite3 的 .backup 命令进行安全备份
        result = subprocess.run(
            ['sqlite3', db_path, f'.backup "{temp_path}"'],
            shell=True,
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f'Backup failed: {result.stderr}')
            return

        # 原子替换（先写临时文件再重命名，防止备份文件损坏）
        if os.path.exists(backup_path):
            os.remove(backup_path)
        os.rename(temp_path, backup_path)
        print(f'Backup completed: {backup_path}')

        # 清理旧备份，保留最近 7 天
        all_backups = sorted(glob.glob(os.path.join(backup_dir, 'family_chat_*.db')))
        for old_backup in all_backups[:-7]:
            os.remove(old_backup)
            print(f'Removed old backup: {old_backup}')

    except Exception as e:
        print(f'Backup failed: {e}')
        if os.path.exists(temp_path):
            os.remove(temp_path)


def init_database():
    """使用 Flask-Migrate 管理 schema 版本，自动创建/升级数据库"""
    with app.app_context():
        try:
            # 首次部署自动创建所有表（无 migration 目录时）
            from sqlalchemy import inspect
            inspector = inspect(db.engine)
            if not inspector.has_table('user'):
                db.create_all()
                logger.info('[DB] Initial database created with all tables')
            else:
                # 已有旧表：尝试执行未应用的 migration（如果有 migration 目录）
                try:
                    from flask_migrate import upgrade
                    upgrade(directory='migrations')
                    logger.info('[DB] Migration upgrade completed')
                except Exception as migrate_err:
                    # 无 migration 目录时不阻塞启动
                    logger.info('[DB] No migration directory found, using models as-is: %s', migrate_err)
                    db.create_all()  # 补建表中不存在的模型
        except Exception as e:
            logger.error('[DB] Database init error: %s', e)


# 启动时初始化数据库（支持 Gunicorn 和直接运行两种方式）
init_database()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    
    logger.info('=' * 50)
    logger.info('Family chat app starting...')
    logger.info(f'Access URL: http://localhost:{port}')
    logger.info('=' * 50)
    
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)