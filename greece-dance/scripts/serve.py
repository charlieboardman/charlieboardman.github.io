#!/usr/bin/env python3
"""Serve the static atlas locally, including byte ranges used by PMTiles."""

from __future__ import annotations

import argparse
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


RANGE_HEADER = re.compile(r"^bytes=(\d*)-(\d*)$")


class RangeRequestHandler(SimpleHTTPRequestHandler):
    range_to_send: tuple[int, int] | None = None

    def end_headers(self) -> None:
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):  # noqa: ANN201 - signature is defined by the standard library
        self.range_to_send = None
        path = Path(self.translate_path(self.path))
        range_header = self.headers.get("Range")
        if not range_header or not path.is_file():
            return super().send_head()

        match = RANGE_HEADER.fullmatch(range_header.strip())
        if not match:
            self.send_error(400, "Malformed Range header")
            return None

        file_size = path.stat().st_size
        start_text, end_text = match.groups()
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
        elif end_text:
            suffix_length = int(end_text)
            start = max(0, file_size - suffix_length)
            end = file_size - 1
        else:
            self.send_error(400, "Empty byte range")
            return None

        if start >= file_size or end < start:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return None

        end = min(end, file_size - 1)
        source = path.open("rb")
        source.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(path.stat().st_mtime))
        self.end_headers()
        self.range_to_send = (start, end)
        return source

    def copyfile(self, source, outputfile) -> None:  # noqa: ANN001
        if self.range_to_send is None:
            return super().copyfile(source, outputfile)
        start, end = self.range_to_send
        remaining = end - start + 1
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), RangeRequestHandler)
    print(f"Serving {os.getcwd()} at http://{args.bind}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
