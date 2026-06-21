"""小脚本：检查路由注册情况"""
import sys
sys.path.insert(0, r'D:\0')

from app import app

print("=== view_functions 键 ===")
for key in sorted(app.view_functions.keys()):
    func = app.view_functions[key]
    print(f"  {key}: {func}")

print()
print("=== 路由规则 ===")
for rule in app.url_map.iter_rules():
    print(f"  {rule.rule} -> {rule.endpoint}")

print()
print(f"send_static_file: {app.send_static_file}")
print(f"'static' in view_functions: {'static' in app.view_functions}")
