from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os

app = Flask(__name__)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'family-chat-secret-key-2024')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///family_chat.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
db = SQLAlchemy(app)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    sent_requests = db.relationship('FriendRequest', foreign_keys='FriendRequest.sender_id', backref='sender', lazy='dynamic')
    received_requests = db.relationship('FriendRequest', foreign_keys='FriendRequest.receiver_id', backref='receiver', lazy='dynamic')
    
    friendships_1 = db.relationship('Friendship', foreign_keys='Friendship.user1_id', backref='user1', lazy='dynamic')
    friendships_2 = db.relationship('Friendship', foreign_keys='Friendship.user2_id', backref='user2', lazy='dynamic')
    
    messages_sent = db.relationship('Message', foreign_keys='Message.sender_id', backref='sender_msg', lazy='dynamic')
    messages_received = db.relationship('Message', foreign_keys='Message.receiver_id', backref='receiver_msg', lazy='dynamic')

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
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    read = db.Column(db.Boolean, default=False)


@app.route('/')
def index():
    return render_template('index.html')


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
    
    return jsonify({'message': '登录成功', 'user_id': user.id, 'username': user.username}), 200


@app.route('/api/search', methods=['GET'])
def search_users():
    username = request.args.get('username')
    current_user_id = request.args.get('user_id', type=int)
    
    if not username:
        return jsonify([])
    
    users = User.query.filter(User.username.contains(username), User.id != current_user_id).all()
    return jsonify([{'id': u.id, 'username': u.username} for u in users])


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
                'sender_username': sender.username
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
                'last_message': last_message.content if last_message else None,
                'last_message_time': last_message.timestamp.isoformat() if last_message else None
            })
    
    return jsonify(friends)


@app.route('/api/messages/<int:user_id>/<int:friend_id>', methods=['GET'])
def get_messages(user_id, friend_id):
    messages = Message.query.filter(
        ((Message.sender_id == user_id) & (Message.receiver_id == friend_id)) |
        ((Message.sender_id == friend_id) & (Message.receiver_id == user_id))
    ).order_by(Message.timestamp.asc()).all()
    
    result = []
    for msg in messages:
        result.append({
            'id': msg.id,
            'sender_id': msg.sender_id,
            'receiver_id': msg.receiver_id,
            'content': msg.content,
            'timestamp': msg.timestamp.isoformat(),
            'is_mine': msg.sender_id == user_id
        })
    
    return jsonify(result)


@socketio.on('connect')
def handle_connect():
    print('Client connected')


@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')


@socketio.on('join')
def on_join(data):
    user_id = data.get('user_id')
    if user_id:
        join_room(str(user_id))
        print(f'User {user_id} joined room {user_id}')


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
        
        if not sender_id or not receiver_id or not content:
            return
        
        message = Message(sender_id=sender_id, receiver_id=receiver_id, content=content)
        db.session.add(message)
        db.session.commit()
        
        message_data = {
            'id': message.id,
            'sender_id': sender_id,
            'receiver_id': receiver_id,
            'content': content,
            'timestamp': message.timestamp.isoformat(),
            'is_mine': False
        }
        
        emit('receive_message', message_data, room=str(receiver_id))
        
        message_data['is_mine'] = True
        emit('receive_message', message_data, room=str(sender_id))
        
    except Exception as e:
        print(f'sending message failed: {e}')
        db.session.rollback()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    
    with app.app_context():
        db.create_all()
    
    print('=' * 50)
    print('family chat app start...')
    print(f'access url: http://localhost:{port}')
    print('=' * 50)
    
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
