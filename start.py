#!/usr/bin/env python3
"""本地预览服务器。"""
import http.server
import os
import sys
import webbrowser

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass


try:
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
except OSError as error:
    print('')
    print('无法启动：端口 %d 已被占用。' % PORT)
    print('请先关闭之前打开的 SeedCount 黑色命令行窗口，再重新双击启动。')
    print('')
    input('按回车键关闭...')
    raise SystemExit(1) from error

print('SeedCount 已启动：')
print('  http://localhost:%d/' % PORT)
print('按 Ctrl+C 停止')
try:
    webbrowser.open('http://localhost:%d/' % PORT)
except Exception:
    pass
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
