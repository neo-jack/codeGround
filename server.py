"""Read-only public source snapshots; visitor code never runs in this process."""
import argparse
import os
from concurrent.futures import ThreadPoolExecutor
import io
import json
import mimetypes
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

MAX_ARCHIVE = 12 * 1024 * 1024
MAX_SOURCE = 4 * 1024 * 1024
MAX_FILE = 512 * 1024
EXTENSIONS = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.yaml', '.yml'}


def safe_project_path(value, virtual=False):
    if not isinstance(value, str) or not value or '\\' in value:
        return False
    parts = value.split('/')
    return all(p and p not in {'.', '..', '__proto__', 'constructor', 'prototype'} and
               (not p.startswith('.') or (virtual and i == 0 and p == '.codeground'))
               for i, p in enumerate(parts))


def load_projects(path):
    config = json.loads(Path(path).read_text(encoding='utf-8'))
    projects = config['projects']
    if config['defaultProject'] not in projects or not projects:
        raise ValueError('Default project missing')
    routes = {}
    for key, project in projects.items():
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,40}', key):
            raise ValueError('Invalid project id')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', project['repository']):
            raise ValueError('Only fixed GitHub repositories are supported')
        branch = project['branch']
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', branch) or '..' in branch or branch.endswith('/'):
            raise ValueError('Invalid branch')
        for value in [project['entryHtml'], project['defaultFile'], *project['includeRoots'], *project['includeFiles']]:
            if not safe_project_path(value):
                raise ValueError('Invalid source boundary')
        runtime = project.get('runtime', {})
        if runtime.get('root', '.') != '.' and not safe_project_path(runtime['root']):
            raise ValueError('Invalid runtime root')
        if any(not safe_project_path(p, True) for p in runtime.get('virtualFiles', {})):
            raise ValueError('Invalid virtual file')
        for alias in runtime.get('aliases', []):
            if not isinstance(alias['find'], str) or not safe_project_path(alias['replacement'], True):
                raise ValueError('Invalid module alias')
        for route in ['/codeground/' + key, *project.get('routes', [])]:
            if not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+', route) or route == '/codeground':
                raise ValueError('Invalid route')
            if any(route == old or route.startswith(old + '/') or old.startswith(route + '/') for old in routes):
                raise ValueError('Duplicate or overlapping route')
            routes[route] = key
    return config, routes


CONFIG, ROUTES = load_projects(Path(os.environ.get('CODEGROUND_PROJECTS_FILE') or Path(__file__).with_name('projects.json')))
DEFAULT_PROJECT = CONFIG['projects'][CONFIG['defaultProject']]


def allowed_path(name, project=None):
    project = project or DEFAULT_PROJECT
    parts = name.split('/')
    if not name or '\\' in name or any(not p or p in {'.', '..', '__proto__', 'constructor', 'prototype'} or p.startswith('.') for p in parts):
        return False
    if any(p.lower() in {'node_modules', 'dist', 'res', 'secrets', 'credentials', 'private'} for p in parts):
        return False
    if any(re.search(r'(?:secret|credential|password|token|\.env)', p, re.I) for p in parts):
        return False
    if parts[-1] == 'AGENTS.md':
        return False
    return name in project['includeFiles'] or (len(parts) > 1 and any(name.startswith(root + '/') for root in project['includeRoots']) and PurePosixPath(name).suffix in EXTENSIONS)


def unpack_source(data, project=None):
    project = project or DEFAULT_PROJECT
    if len(data) > MAX_ARCHIVE:
        raise ValueError('Archive exceeds limit')
    files, total, count = {}, 0, 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            count += 1
            if count > 10000:
                raise ValueError('Too many archive entries')
            if member.name.startswith('/') or '\\' in member.name or '..' in member.name.split('/'):
                raise ValueError('Unsafe archive path')
            if not member.isfile():
                continue
            _, separator, name = member.name.partition('/')
            if not separator or not allowed_path(name, project):
                continue
            if member.size > MAX_FILE or total + member.size > MAX_SOURCE or len(files) >= 500:
                raise ValueError('Source exceeds limit')
            if name in files:
                raise ValueError('Duplicate file')
            content = archive.extractfile(member).read(MAX_FILE + 1)
            if b'\0' in content:
                continue
            files[name] = content.decode('utf-8-sig')
            total += len(content)
    if project['entryHtml'] not in files or project['defaultFile'] not in files:
        raise ValueError('Demo entry missing')
    return files


class SourceStore:
    def __init__(self, project=None):
        self.project = project or DEFAULT_PROJECT
        self.lock = threading.Lock()
        self.sha = None
        self.files = None

    def latest(self):
        # No shell, no request-supplied URL, ref, path or Git credentials.
        with self.lock:
            result = subprocess.run(
                ['git', '-c', 'credential.helper=', 'ls-remote', 'https://github.com/' + self.project['repository'] + '.git', 'refs/heads/' + self.project['branch']],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=18, check=True,
                env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'GIT_TERMINAL_PROMPT': '0', 'HOME': '/tmp'},
            )
            sha = result.stdout.decode().split()[0]
            if not re.fullmatch('[0-9a-f]{40}', sha):
                raise ValueError('Invalid commit')
            if sha != self.sha:
                request = urllib.request.Request(
                    'https://codeload.github.com/' + self.project['repository'] + '/tar.gz/' + sha,
                    headers={'User-Agent': 'codeground-public-snapshots'},
                )
                with urllib.request.urlopen(request, timeout=25) as response:
                    data = response.read(MAX_ARCHIVE + 1)
                files = unpack_source(data, self.project)
                self.sha, self.files = sha, files
            return {'repository': self.project['repository'], 'branch': self.project['branch'], 'commit': self.sha, 'files': self.files, 'project': self.project}


STORES = {key: SourceStore(project) for key, project in CONFIG['projects'].items()}
STORE = STORES[CONFIG['defaultProject']]
STATIC = Path(__file__).resolve().parent / 'dist'


class Handler(BaseHTTPRequestHandler):
    server_version = 'Codeground'

    def log_message(self, fmt, *args):
        # Do not log attacker-controlled paths, credentials or source contents.
        pass

    def reply(self, status, data=b'', content_type='application/json; charset=utf-8', extra=None, cache='no-store'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Referrer-Policy', 'no-referrer')
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == '/healthz':
            return self.reply(200, b'{"ok":true}')
        if path in {'/codeground', '/codeground/'}:
            return self.reply(308, extra={'Location': '/codeground/' + CONFIG['defaultProject'] + '/'})
        route = next((r for r in ROUTES if path == r or path.startswith(r + '/')), None)
        if route is None:
            return self.reply(404, b'{"error":"Not found"}')
        if path == route:
            return self.reply(308, extra={'Location': route + '/'})
        if path == route + '/api/source':
            if parsed.query:
                return self.reply(400, b'{"error":"Unsupported parameters"}')
            if not self.server.source_slots.acquire(blocking=False):
                return self.reply(429, b'{"error":"Please retry shortly"}', extra={'Retry-After': '5'})
            try:
                data = json.dumps(STORES[ROUTES[route]].latest(), ensure_ascii=False).encode('utf-8')
                return self.reply(200, data)
            except Exception:
                return self.reply(502, json.dumps({'error': '暂时无法读取 GitHub 最新源码，请稍后重试。'}).encode('utf-8'))
            finally:
                self.server.source_slots.release()
        if path == route + '/':
            relative = 'index.html'
        elif path.startswith(route + '/assets/'):
            relative = path[len(route) + 1:]
        else:
            return self.reply(404, b'{"error":"Not found"}')
        file = STATIC / relative
        if any(p in {'..', '.'} or p.startswith('.') for p in relative.split('/')) or not file.is_file() or STATIC not in file.resolve().parents:
            return self.reply(404, b'{"error":"Not found"}')
        content_type = mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
        if file.suffix == '.js':
            content_type = 'application/javascript'
        cache = 'public, max-age=31536000, immutable' if relative.startswith('assets/') else 'no-store'
        return self.reply(200, file.read_bytes(), content_type, cache=cache)

    def do_HEAD(self):
        return self.do_GET()

    def read_only(self):
        self.close_connection = True
        self.reply(405, b'{"error":"Read only"}', extra={'Allow': 'GET, HEAD'})

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = read_only


class Server(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, address, handler):
        super().__init__(address, handler)
        self.source_slots = threading.BoundedSemaphore(3)
        self.request_slots = threading.BoundedSemaphore(32)
        self.pool = ThreadPoolExecutor(max_workers=12)

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        self.pool.submit(self.bounded_request, request, client_address)

    def bounded_request(self, request, client_address):
        try:
            self.process_request_thread(request, client_address)
        finally:
            self.request_slots.release()

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(60)
        return request, address

    def server_close(self):
        super().server_close()
        self.pool.shutdown(wait=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8091)
    args = parser.parse_args()
    Server((args.host, args.port), Handler).serve_forever()
