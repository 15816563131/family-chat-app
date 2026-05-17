import requests
import socketio
import time
import sys

BASE_URL = 'http://localhost:8080'

def test_chat_system():
    print("=" * 50)
    print("开始自动化测试...")
    print("=" * 50)
    
    print("\n1. 注册用户 family1...")
    response = requests.post(f'{BASE_URL}/api/register', json={
        'username': 'family1',
        'password': 'password123'
    })
    if response.status_code == 201:
        print("   ✓ family1 注册成功")
        family1_id = response.json()['user_id']
    elif response.status_code == 400 and '已存在' in response.json().get('error', ''):
        print("   ✓ family1 已存在,使用现有账号")
        login_response = requests.post(f'{BASE_URL}/api/login', json={
            'username': 'family1',
            'password': 'password123'
        })
        family1_id = login_response.json()['user_id']
    else:
        print(f"   ✗ family1 注册失败: {response.json()}")
        return False
    
    print("\n2. 注册用户 family2...")
    response = requests.post(f'{BASE_URL}/api/register', json={
        'username': 'family2',
        'password': 'password123'
    })
    if response.status_code == 201:
        print("   ✓ family2 注册成功")
        family2_id = response.json()['user_id']
    elif response.status_code == 400 and '已存在' in response.json().get('error', ''):
        print("   ✓ family2 已存在,使用现有账号")
        login_response = requests.post(f'{BASE_URL}/api/login', json={
            'username': 'family2',
            'password': 'password123'
        })
        family2_id = login_response.json()['user_id']
    else:
        print(f"   ✗ family2 注册失败: {response.json()}")
        return False
    
    print("\n3. family1 搜索 family2...")
    response = requests.get(f'{BASE_URL}/api/search', params={
        'username': 'family2',
        'user_id': family1_id
    })
    users = response.json()
    if len(users) > 0:
        print("   ✓ 找到 family2")
        family2_search = [u for u in users if u['username'] == 'family2']
        if family2_search:
            family2_id = family2_search[0]['id']
    else:
        print("   ✗ 未找到 family2")
        return False
    
    print("\n4. family1 发送好友请求给 family2...")
    response = requests.post(f'{BASE_URL}/api/friend_request', json={
        'sender_id': family1_id,
        'receiver_id': family2_id
    })
    if response.status_code == 200:
        print("   ✓ 好友请求已发送")
    elif response.status_code == 400:
        try:
            error_msg = response.json().get('error', '')
            if '已经是好友' in error_msg:
                print("   ✓ 已经是好友了")
            else:
                print(f"   ⚠ 发送失败: {error_msg}")
        except:
            print(f"   ⚠ 发送失败(非JSON响应)")
    else:
        print(f"   ⚠ 发送失败: 状态码 {response.status_code}")
    
    print("\n5. family2 查看并批准好友请求...")
    response = requests.get(f'{BASE_URL}/api/friend_requests/{family2_id}')
    requests_list = response.json()
    
    if len(requests_list) > 0:
        family1_request = [r for r in requests_list if r['sender_id'] == family1_id]
        if family1_request:
            request_id = family1_request[0]['id']
            response = requests.post(f'{BASE_URL}/api/friend_request/action', json={
                'request_id': request_id,
                'action': 'accept',
                'receiver_id': family2_id
            })
            if response.status_code == 200:
                print("   ✓ 已批准好友请求")
            else:
                print(f"   ✗ 批准失败: {response.json()}")
                return False
        else:
            print("   ✗ 未找到 family1 的请求")
            return False
    else:
        print("   ✗ 没有待处理的好友请求")
        return False
    
    print("\n6. family1 确认好友列表...")
    time.sleep(0.5)
    response = requests.get(f'{BASE_URL}/api/friends/{family1_id}')
    friends = response.json()
    
    family2_in_list = [f for f in friends if f['id'] == family2_id]
    if family2_in_list:
        print("   ✓ family2 已在好友列表中")
    else:
        print("   ✗ family2 不在好友列表中")
        return False
    
    print("\n7. 使用 WebSocket 发送消息...")
    socket_client = socketio.Client()
    message_received = {'event': False, 'content': None}
    
    @socket_client.on('receive_message')
    def on_receive_message(data):
        print(f"   收到消息: {data['content']}")
        message_received['event'] = True
        message_received['content'] = data['content']
    
    try:
        socket_client.connect(BASE_URL)
        print("   ✓ WebSocket 连接成功")
        
        socket_client.emit('join', {'user_id': family2_id})
        print("   ✓ family2 已加入房间")
        
        time.sleep(0.5)
        
        socket_client.emit('send_message', {
            'sender_id': family1_id,
            'receiver_id': family2_id,
            'content': 'Hello, 家人！'
        })
        print("   ✓ 消息已发送: 'Hello, 家人！'")
        
        time.sleep(2)
        
        if message_received['event'] and message_received['content'] == 'Hello, 家人！':
            print("   ✓ 消息接收成功并验证通过")
        else:
            print("   ✗ 消息未正确接收")
            return False
        
        socket_client.disconnect()
        
    except Exception as e:
        print(f"   ✗ WebSocket 测试失败: {e}")
        return False
    
    print("\n" + "=" * 50)
    print("✓ ALL TESTS PASSED")
    print("=" * 50)
    print("\n所有测试通过！家庭聊天软件功能正常。")
    
    return True

if __name__ == '__main__':
    try:
        success = test_chat_system()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ 测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
