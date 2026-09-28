import io
import json
import tarfile
import threading
import unittest
import tempfile
from pathlib import Path
import urllib.error
import urllib.request
from unittest.mock import patch
import server


def archive(extra=()):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        for name, content, kind in [('repo/demos/index.html', '<div></div>', tarfile.REGTYPE), ('repo/demos/main.tsx', 'export {}', tarfile.REGTYPE), *extra]:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.linkname = '/etc/passwd' if kind == tarfile.SYMTYPE else ''
            data = content.encode()
            entry.size = len(data) if kind == tarfile.REGTYPE else 0
            tar.addfile(entry, io.BytesIO(data) if kind == tarfile.REGTYPE else None)
    return buffer.getvalue()


class BoundaryTests(unittest.TestCase):
    def test_generic_project_boundary_and_entry(self):
        project = {'entryHtml': 'index.html', 'defaultFile': 'src/main.ts', 'includeRoots': ['src'], 'includeFiles': ['index.html']}
        data = archive([('repo/index.html', '<div></div>', tarfile.REGTYPE), ('repo/src/main.ts', 'export {}', tarfile.REGTYPE)])
        self.assertEqual(set(server.unpack_source(data, project)), {'index.html', 'src/main.ts'})
        self.assertFalse(server.allowed_path('demos/main.tsx', project))

    def test_registry_rejects_urls_traversal_and_overlapping_routes(self):
        from copy import deepcopy
        cases = []
        for key, value in [('repository', 'https://attacker.example/a'), ('entryHtml', '../private'), ('branch', 'main..secret'), ('routes', ['/React/nested', '/React'])]:
            config = deepcopy(server.CONFIG)
            config['projects']['react'][key] = value
            cases.append(config)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'projects.json'
            for config in cases:
                path.write_text(json.dumps(config), encoding='utf-8')
                with self.assertRaises(ValueError):
                    server.load_projects(path)

    def test_archive_whitelist_excludes_private_and_dependencies(self):
        data = archive([(path, 'hidden', tarfile.REGTYPE) for path in ['repo/.env', 'repo/.git/config', 'repo/packages/react/node_modules/a.js', 'repo/deploy/key.json', 'repo/script/credentials.json', 'repo/playground/server.py']])
        self.assertEqual(set(server.unpack_source(data)), {'demos/index.html', 'demos/main.tsx'})

    def test_traversal_is_rejected_and_links_are_not_followed(self):
        with self.assertRaises(ValueError):
            server.unpack_source(archive([('repo/demos/../../etc/passwd', 'bad', tarfile.REGTYPE)]))
        files = server.unpack_source(archive([('repo/demos/private.ts', '', tarfile.SYMTYPE)]))
        self.assertNotIn('demos/private.ts', files)

    def test_oversized_files_and_duplicates_rejected(self):
        for extra in [[('repo/demos/huge.ts', 'x' * (server.MAX_FILE + 1), tarfile.REGTYPE)], [('repo/demos/main.tsx', 'duplicate', tarfile.REGTYPE)]]:
            with self.assertRaises(ValueError):
                server.unpack_source(archive(extra))

    def test_http_is_read_only_and_fixed_to_source(self):
        srv = server.Server(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(srv.server_port)
        try:
            with patch.object(server.STORE, 'latest', return_value={'commit': 'a' * 40, 'files': {}}):
                response = urllib.request.urlopen(base + '/React/api/source')
                self.assertEqual(response.headers['Cross-Origin-Opener-Policy'], 'same-origin')
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertEqual(json.load(response)['commit'], 'a' * 40)
                self.assertEqual(json.load(urllib.request.urlopen(base + '/codeground/react/api/source'))['commit'], 'a' * 40)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(base + '/codeground/not-configured/api/source')
                self.assertEqual(error.exception.code, 404)
                for path, method, expected in [('/React/api/source', 'POST', 405), ('/React/api/source?url=file:///etc/passwd', 'GET', 400), ('/React/../../etc/passwd', 'GET', 404), ('/React/server.py', 'GET', 404), ('/React/.git/config', 'GET', 404)]:
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(urllib.request.Request(base + path, method=method))
                    self.assertEqual(error.exception.code, expected)
            with patch.object(server.STORE, 'latest', side_effect=RuntimeError('offline')):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(base + '/React/api/source')
                self.assertEqual(error.exception.code, 502)
        finally:
            srv.shutdown()
            srv.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
