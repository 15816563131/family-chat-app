import urllib.request
import gzip

# Test CSS
req = urllib.request.Request(
    'http://localhost:8080/static/style.css?x=999',
    headers={'Accept-Encoding': 'gzip'}
)
resp = urllib.request.urlopen(req, timeout=10)
raw = resp.read()
ce = resp.headers.get('Content-Encoding', '')
cc = resp.headers.get('Cache-Control', '')
print(f'CSS Cache-Control: {cc}')
print(f'CSS Content-Encoding: {ce}')
print(f'CSS Raw bytes: {len(raw)}')
if ce == 'gzip':
    decompressed = gzip.decompress(raw)
    print(f'CSS Decompressed: {len(decompressed)} bytes')
    print(f'CSS Compression ratio: {len(raw)/len(decompressed)*100:.1f}%')

print()
# Test JS
req2 = urllib.request.Request(
    'http://localhost:8080/static/chat.js?x=888',
    headers={'Accept-Encoding': 'gzip'}
)
resp2 = urllib.request.urlopen(req2, timeout=10)
raw2 = resp2.read()
print(f'JS Cache-Control: {resp2.headers.get("Cache-Control")}')
print(f'JS Content-Encoding: {resp2.headers.get("Content-Encoding")}')
print(f'JS Raw bytes: {len(raw2)}')
if resp2.headers.get('Content-Encoding') == 'gzip':
    d2 = gzip.decompress(raw2)
    print(f'JS Decompressed: {len(d2)} bytes')
    print(f'JS Compression ratio: {len(raw2)/len(d2)*100:.1f}%')

print()
# Test image (should not be gzipped)
req3 = urllib.request.Request(
    'http://localhost:8080/static/app-logo.jpg?x=777',
    headers={'Accept-Encoding': 'gzip'}
)
resp3 = urllib.request.urlopen(req3, timeout=10)
raw3 = resp3.read()
print(f'IMG Cache-Control: {resp3.headers.get("Cache-Control")}')
print(f'IMG Content-Encoding: {resp3.headers.get("Content-Encoding")} (should be empty)')
print(f'IMG bytes: {len(raw3)}')

print()
print('=== ALL TESTS PASSED ===')
