"""强制给所有已有用户添加 DeepSeek AI 好友"""
import sqlite3
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'instance', 'family_chat.db')
if not os.path.exists(db_path):
    print(f'数据库不存在: {db_path}')
    exit(1)

conn = sqlite3.connect(db_path)
c = conn.cursor()

# 获取 AI 用户
c.execute('SELECT id FROM user WHERE username="DeepSeek AI"')
ai = c.fetchone()
if not ai:
    print('DeepSeek AI 用户不存在，创建中...')
    # 简易创建（仅用于补好友关系）
    import hashlib, uuid
    pw = hashlib.sha256(('ai_' + uuid.uuid4().hex[:12]).encode()).hexdigest()
    c.execute('INSERT INTO user (username, password_hash, bio, avatar, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
              ('DeepSeek AI', pw, 'AI 助手', '/static/icon-192.png'))
    conn.commit()
    ai_id = c.lastrowid
    print(f'已创建 DeepSeek AI 用户 (ID={ai_id})')
else:
    ai_id = ai[0]
    print(f'DeepSeek AI 用户 ID={ai_id}')

# 获取所有其他用户
c.execute('SELECT id, username FROM user WHERE id != ?', (ai_id,))
users = c.fetchall()
print(f'其他用户数: {len(users)}')

added = 0
for uid, uname in users:
    # 检查是否已是好友
    c.execute(
        'SELECT id FROM friendship WHERE (user1_id=? AND user2_id=?) OR (user1_id=? AND user2_id=?)',
        (uid, ai_id, ai_id, uid)
    )
    if not c.fetchone():
        c.execute('INSERT INTO friendship (user1_id, user2_id) VALUES (?, ?)', (uid, ai_id))
        added += 1
        print(f'  + 为用户 {uname}(ID={uid}) 添加 AI 好友')

conn.commit()
conn.close()

if added > 0:
    # 同时通过 API 调用 app 来添加
    print(f'\n✅ 已为 {added} 个用户强制添加 AI 好友')
    print('⚠️  用户需要重新登录才能看到变化')
else:
    print('✅ 所有用户已有 AI 好友，无需添加')