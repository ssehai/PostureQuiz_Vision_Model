"""게임 실행용 로컬 서버.

python3 -m http.server 와 같지만, 브라우저가 파일을 캐시하지 않게 한다.
(캐시를 쓰면 코드를 고친 뒤 새로고침해도 일부 파일만 새로 받아서 게임이 멈출 수 있다)

사용법:  python3 serve.py        → http://localhost:8000
        python3 serve.py 9000   → 다른 포트
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'게임 주소: http://localhost:{port}  (끄려면 Ctrl+C)')
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
