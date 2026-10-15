"""Hand a ZME local download source to the current device's system association."""

import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("ZME file responses must not redirect to another source.")


def system_open(value):
    system = platform.system()
    if system == "Windows":
        os.startfile(value)
    else:
        subprocess.run(["open" if system == "Darwin" else "xdg-open", value], check=True)


def handoff(source, origin, directory, save_only=False):
    uri = source["href"]
    parsed = urlsplit(uri)
    if source["kind"] == "magnet":
        if parsed.scheme != "magnet" or not parsed.query:
            raise ValueError("Invalid magnet source.")
        if save_only:
            raise ValueError("A magnet source has no file to save.")
        system_open(uri)
        return "System open requested for magnet source."

    expected = urlsplit(origin)
    if (
        source["kind"] != "file"
        or expected.scheme not in ("http", "https")
        or (parsed.scheme, parsed.netloc) != (expected.scheme, expected.netloc)
        or parsed.username is not None
        or not parsed.path.startswith("/api/downloads/")
        or not parsed.path.endswith("/content")
    ):
        raise ValueError("File source must be the returned ZME content URL.")
    filename = source["filename"]
    if not filename or filename in (".", "..") or any(c in filename for c in ('/', '\\', '\0', '\r', '\n')):
        raise ValueError("Invalid local filename.")
    if source.get("mediaType") == "application/x-bittorrent" and not filename.lower().endswith(".torrent"):
        raise ValueError("Torrent source must have a .torrent filename.")

    directory.mkdir(parents=True, exist_ok=True)
    # A private subdirectory preserves the suggested filename without overwriting existing downloads.
    path = Path(tempfile.mkdtemp(prefix="zme-", dir=directory)) / filename
    try:
        with build_opener(NoRedirect).open(Request(uri), timeout=60) as response, path.open("xb") as output:
            while chunk := response.read(64 * 1024):
                output.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        path.parent.rmdir()
        raise
    if not save_only:
        system_open(str(path.resolve()))
    return f"File saved: {path}" + ("; system open requested." if not save_only else "")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="JSON resource returned by createDownload")
    parser.add_argument("--origin", required=True, help="Discovered ZME origin")
    parser.add_argument("--directory", type=Path, default=Path.home() / "Downloads")
    parser.add_argument("--save-only", action="store_true")
    args = parser.parse_args()
    try:
        source = json.loads(args.source.read_text())
        print(handoff(source, args.origin, args.directory, args.save_only))
    except Exception as error:
        # HTTP exceptions may embed the bearer URL; do not include their raw text.
        parser.exit(1, f"Local download handoff failed ({type(error).__name__}).\n")


if __name__ == "__main__":
    main()
