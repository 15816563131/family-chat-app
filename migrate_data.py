"""
FamilyChat 数据迁移脚本
将当前 Railway SQLite 数据导出，转移到 Render PostgreSQL

使用方法：
1. 部署到 Render 后，先确保新站点能正常访问
2. 运行本脚本: python migrate_data.py
   - 默认从当前 Railway 导出 -> 生成SQL文件
   - 可导入到 Render PostgreSQL

环境变量：
  SOURCE_URL:   旧数据库 URL（默认读取 Railway 的 DATABASE_URL）
  TARGET_URL:   新数据库 URL（Render 的 PostgreSQL URL）
  EXPORT_TOKEN: 导出 API 的访问令牌
"""

import json
import os
import sys
import urllib.request
import urllib.parse

EXPORT_TOKEN = os.environ.get('EXPORT_TOKEN', 'export-secret-123')
RAILWAY_SITE = "https://family-chat-app-production-93b6.up.railway.app"


def fetch_export(endpoint):
    """从站点导出接口获取数据"""
    url = f"{RAILWAY_SITE}/api/{endpoint}?token={EXPORT_TOKEN}"
    try:
        resp = urllib.request.urlopen(url, timeout=30)
        return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  ⚠ 获取 {endpoint} 失败: {e}")
        return []


def main():
    print("=" * 60)
    print("FamilyChat 数据迁移工具")
    print("=" * 60)
    print()
    print(f"源站点: {RAILWAY_SITE}")
    print()

    # 1. 获取用户数据
    print("📥 正在从 Railway 导出数据...")
    print("  导出用户表...")
    users = fetch_export("export/users")
    print(f"    找到 {len(users)} 个用户")

    print("  导出好友关系表...")
    friendships = fetch_export("export/friendships")
    print(f"    找到 {len(friendships)} 条好友关系")

    print("  导出好友请求表...")
    friend_requests = fetch_export("export/friend_requests")
    print(f"    找到 {len(friend_requests)} 条好友请求")

    print("  导出黑名单...")
    blacklist = fetch_export("export/blacklist")
    print(f"    找到 {len(blacklist)} 条黑名单记录")

    print("  导出消息表...")
    messages = fetch_export("export/messages")
    print(f"    找到 {len(messages)} 条消息")

    # 2. 生成 SQL 文件
    print()
    print("📝 正在生成 SQL 文件...")

    sql_lines = [
        "-- FamilyChat 数据库迁移 SQL",
        f"-- 导出时间: {__import__('datetime').datetime.now().isoformat()}",
        f"-- 数据量: {len(users)}用户, {len(messages)}消息",
        "",
        "BEGIN;",
        "",
        "-- 清空旧数据（避免主键冲突）",
        "DELETE FROM message;",
        "DELETE FROM blacklist;",
        "DELETE FROM friend_request;",
        "DELETE FROM friendship;",
        "DELETE FROM \"user\";",
        "",
    ]

    # 插入用户
    for u in users:
        sql_lines.append(
            f"INSERT INTO \"user\" (id, username, password_hash, avatar, bio, created_at) "
            f"VALUES ({u['id']}, {json.dumps(u['username'])}, {json.dumps(u['password_hash'])}, "
            f"{json.dumps(u.get('avatar', ''))}, {json.dumps(u.get('bio', '这个人很懒，什么都没写~'))}, "
            f"{json.dumps(u.get('created_at', '2024-01-01T00:00:00'))});"
        )

    sql_lines.append("")

    # 插入好友关系
    for f in friendships:
        sql_lines.append(
            f"INSERT INTO friendship (id, user1_id, user2_id, created_at) "
            f"VALUES ({f['id']}, {f['user1_id']}, {f['user2_id']}, {json.dumps(f.get('created_at', '2024-01-01T00:00:00'))});"
        )

    sql_lines.append("")

    # 插入好友请求
    for r in friend_requests:
        sql_lines.append(
            f"INSERT INTO friend_request (id, sender_id, receiver_id, status, created_at) "
            f"VALUES ({r['id']}, {r['sender_id']}, {r['receiver_id']}, "
            f"{json.dumps(r.get('status', 'pending'))}, {json.dumps(r.get('created_at', '2024-01-01T00:00:00'))});"
        )

    sql_lines.append("")

    # 插入黑名单
    for b in blacklist:
        sql_lines.append(
            f"INSERT INTO blacklist (id, user_id, blocked_user_id, created_at) "
            f"VALUES ({b['id']}, {b['user_id']}, {b['blocked_user_id']}, {json.dumps(b.get('created_at', '2024-01-01T00:00:00'))});"
        )

    sql_lines.append("")

    # 插入消息
    for m in messages:
        voice_url = m.get('voice_url', '')
        voice_duration = m.get('voice_duration', 0)
        sql_lines.append(
            f"INSERT INTO message (id, sender_id, receiver_id, content, msg_type, "
            f"voice_url, voice_duration, timestamp, read) "
            f"VALUES ({m['id']}, {m['sender_id']}, {m['receiver_id']}, "
            f"{json.dumps(m['content'])}, {json.dumps(m.get('msg_type', 'text'))}, "
            f"{json.dumps(voice_url)}, {voice_duration}, "
            f"{json.dumps(m.get('timestamp', '2024-01-01T00:00:00'))}, "
            f"{'true' if m.get('read', False) else 'false'});"
        )

    sql_lines.append("")
    sql_lines.append(
        "-- 重置序列为主键最大值 + 1 （PostgreSQL 序列重置）"
    )
    sql_lines.append("SELECT setval('user_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM \"user\"));")
    sql_lines.append("SELECT setval('message_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM message));")
    sql_lines.append("SELECT setval('friendship_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM friendship));")
    sql_lines.append("SELECT setval('friend_request_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM friend_request));")
    sql_lines.append("SELECT setval('blacklist_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM blacklist));")

    sql_lines.append("")
    sql_lines.append("COMMIT;")

    sql_content = "\n".join(sql_lines)

    # 保存 SQL 文件
    sql_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migration_data.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(sql_content)
    print(f"  ✅ SQL 文件已生成: {sql_path}")
    print(f"     文件大小: {len(sql_content) / 1024:.1f} KB")

    # 3. 输出导入指南
    print()
    print("=" * 60)
    print("✅ 导出完成！导入指南：")
    print("=" * 60)
    print()
    print("将 SQL 导入 Render PostgreSQL：")
    print()
    print("  方法一（推荐）- 使用 Render Shell：")
    print("    1. 登录 Render 控制台")
    print("    2. 进入 Database → Connect → Shell")
    print("    3. 粘贴以下命令并执行：")
    print()
    print(f"    \\i 'migration_data.sql'")
    print()
    print("  方法二 - 使用 psql 命令行：")
    print(f"    psql \"RENDER_PG_URL\" < migration_data.sql")
    print()
    print("需要我把数据迁移过去吗？告诉我一声就行。")
    print("=" * 60)


if __name__ == '__main__':
    main()