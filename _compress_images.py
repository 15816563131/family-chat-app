"""批量压缩所有静态 PNG 到更小体积：
   - 大尺寸图片压缩为 JPG（质量70~85）
   - 头像类的压缩到更小尺寸（128x128以内）
   - 保存为同名图片
"""
from PIL import Image, ImageOps
import os

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')

def compress_to_jpg(src, max_dim, quality=75):
    """把src图片压缩保存为jpg（覆盖同名png）。"""
    try:
        im = Image.open(src)
        # 去掉alpha通道 -> 白底
        if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
            bg = Image.new('RGB', im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert('RGB')

        # 按比例缩放到max_dim
        w, h = im.size
        if max(w, h) > max_dim:
            ratio = max_dim / max(w, h)
            im = im.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

        # 同名jpg替换
        jpg_path = os.path.splitext(src)[0] + '.jpg'
        im.save(jpg_path, 'JPEG', quality=quality, optimize=True, progressive=True)

        # 删除原始png
        if jpg_path != src:
            try:
                os.remove(src)
            except:
                pass

        size_before = os.path.getsize(src) if os.path.exists(src) else os.path.getsize(jpg_path)
        size_after = os.path.getsize(jpg_path)
        print(f"  {os.path.basename(src)}: {size_before//1024}KB -> {size_after//1024}KB ({quality}% 质量)")
        return jpg_path
    except Exception as e:
        print(f"  失败 {src}: {e}")
        return None


# 定义每个文件的目标尺寸
targets = {
    'login-bg.png':            (1280, 80),  # 背景图稍大但低质量
    'call-avatar.png':         (320, 75),
    'chat-bg.png':            (512, 60),   # 被替换为CSS，这里也压缩
    'default-avatar-self.png': (128, 80),
    'default-avatar-friend.png': (128, 80),
    'app-logo.png':            (192, 80),
    'loading.png':             (96, 75),
    'empty-state.png':         (160, 80),
}

print("开始压缩图片...")
for fname, (size, q) in targets.items():
    src = os.path.join(STATIC, fname)
    if not os.path.exists(src):
        print(f"  跳过 {fname} (不存在)")
        continue
    compress_to_jpg(src, size, q)

print("\n压缩完成！")
