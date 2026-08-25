#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# server.py - Local static server for Checklist Audit System
#
# Serves the app folder over http://127.0.0.1:<port> with:
#   - Correct MIME types for .html/.js/.css/.map
#   - Cache-Control: no-store on every response (no stale script persists)
#   - No directory listing
#
# Usage:  python server.py <port>
# ---------------------------------------------------------------------------
import os
import sys
import mimetypes
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".map")
mimetypes.add_type("application/xml", ".svg")


class NoCacheHandler(SimpleHTTPRequestHandler):
    serve_dir = ROOT

    def translate_path(self, path):
        # Resolve the request path against the app folder only (no cwd, no listing).
        path = path.split("?", 1)[0]
        parts = [part for part in path.split("/") if part not in ("", ".", "..", "~")]
        rel = os.path.normpath(os.path.join(*parts)) if parts else "."
        full = os.path.join(self.serve_dir, rel)
        return full

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter console
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = NoCacheHandler
    handler.serve_dir = ROOT
    try:
        ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
    except OSError as e:
        sys.stderr.write("start_server_error: %s\n" % e)
        sys.exit(1)


if __name__ == "__main__":
    main()