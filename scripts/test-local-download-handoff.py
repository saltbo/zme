"""Exercise Agent handoff with a real local file server and a stub system opener."""

import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import sys
from threading import Thread
import unittest
from unittest.mock import patch


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "handoff", Path(__file__).resolve().parents[1] / "skills/use-zme/scripts/open_local_download.py"
)
handoff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handoff)
TORRENT = b"d4:infod4:name4:testee"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if "redirect" in self.path:
            self.send_response(302)
            self.send_header("Location", "https://private-tracker.test/file")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-bittorrent")
        self.end_headers()
        self.wfile.write(TORRENT)

    def log_message(self, *args):
        pass


class LocalHandoffTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def source(self, token="token"):
        return {"kind": "file", "mediaType": "application/x-bittorrent", "href": f"{self.origin}/api/downloads/{token}/content", "filename": "中文电影.torrent"}

    def test_magnet_uses_system_association_with_a_literal_argument(self):
        magnet = "magnet:?xt=urn:btih:test&dn=$(never-run)"
        with patch.object(handoff.platform, "system", return_value="Darwin"), patch.object(handoff.subprocess, "run") as run:
            handoff.handoff({"kind": "magnet", "href": magnet}, self.origin, Path("unused"))
            run.assert_called_once_with(["open", magnet], check=True)

    def test_torrent_is_saved_and_the_actual_file_is_opened_without_overwriting(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(handoff, "system_open") as opener:
            destination = Path(directory)
            existing = destination / "中文电影.torrent"
            existing.write_bytes(b"existing")
            handoff.handoff(self.source(), self.origin, destination)
            opened = Path(opener.call_args.args[0])
            self.assertEqual(opened.read_bytes(), TORRENT)
            self.assertEqual(existing.read_bytes(), b"existing")
            self.assertEqual(opened.name, "中文电影.torrent")

    def test_save_only_does_not_open_a_client(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(handoff, "system_open") as opener:
            handoff.handoff(self.source(), self.origin, Path(directory), save_only=True)
            opener.assert_not_called()
            self.assertEqual(next(Path(directory).glob("*/*.torrent")).read_bytes(), TORRENT)

    def test_rejects_untrusted_file_origins_and_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            for override in ({"href": "https://private-tracker.test/file"}, {"filename": "../file.torrent"}):
                with self.assertRaises(ValueError):
                    handoff.handoff({**self.source(), **override}, self.origin, Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_rejects_redirects_and_removes_incomplete_files(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(handoff, "system_open") as opener:
            with self.assertRaises(ValueError):
                handoff.handoff(self.source("redirect"), self.origin, Path(directory))
            opener.assert_not_called()
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
