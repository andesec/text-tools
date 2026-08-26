#!/usr/bin/env python3
"""
Development HTTP Server for Dylen Text Tools.
Serves files with no-cache headers to ensure immediate reflection of changes in the browser.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def run(port=8000):
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, NoCacheHTTPRequestHandler)
    print(f"Starting Dylen Text Tools development server at http://localhost:{port}/ (no-cache enabled)...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run(port)
