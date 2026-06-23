#!/usr/bin/env python3
"""모든 응답에 캐시 금지 헤더를 붙이는 정적 파일 서버.
브라우저/프리뷰가 항상 최신 파일을 받도록 강제한다."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
